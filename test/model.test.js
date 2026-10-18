// -----------------------------------------------------------------------------
// The pure parts: the answers of P1 Monitor, the capabilities, the index
// guard, the device and its states, the address, the /data store.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { normalizeConfig, parseAddress } from '../src/config.js';
import {
  FEATURE,
  buildDevice,
  capabilitiesOfDevice,
  ids,
  indexStates,
  liveStates,
} from '../src/devices.js';
import { IndexGuard, indexOfTariffs } from '../src/guard.js';
import { createFileStore } from '../src/store.js';
import {
  bringsNew,
  capabilitiesOf,
  mergeCapabilities,
  num,
  parsePhases,
  parsePrices,
  parseSmartmeter,
  parseWater,
  tariffOf,
} from '../src/p1monitor/model.js';
import {
  CONFIGURATION,
  SMARTMETER,
  STATUS,
  STATUS_3P,
  WATER,
  meterWith,
} from './fixtures/p1monitor.js';

const MINUTE = 60_000;
const key = (f) => f.external_id.split(':').at(-1);

test('numbers: numbers and numeric strings, nothing else', () => {
  assert.equal(num(1.5), 1.5);
  assert.equal(num('0.863'), 0.863);
  assert.equal(num(' 229 '), 229);
  assert.equal(num('-1.2'), -1.2);
  for (const value of [null, undefined, '', 'abc', '1,5', true, NaN, Infinity, {}, []]) {
    assert.equal(num(value), undefined, String(value));
  }
});

test('the smart meter page: powers, indexes per tariff, gas, tariff code', () => {
  const meter = parseSmartmeter(SMARTMETER);
  assert.equal(meter.power, 935);
  assert.equal(meter.injectionPower, 0);
  assert.deepEqual(meter.consumption, {
    low: 5436.256,
    high: 2996.141,
    total: 5436.256 + 2996.141,
  });
  assert.equal(meter.injection.total, 4408.947 + 1575.502);
  assert.equal(meter.gas, 2289.967);
  assert.equal(meter.tariff, 1);
  assert.equal(meter.timestamp, 1633130812);
  assert.deepEqual(parseSmartmeter([]), { empty: true });
  for (const answer of [{}, [{}], [{ hello: 1 }], 'x', null, [null]]) {
    assert.equal(parseSmartmeter(answer), undefined);
  }
});

test('tariff code: P is high (2), D is low (1), anything else unknown', () => {
  assert.equal(tariffOf('P'), 2);
  assert.equal(tariffOf('d'), 1);
  for (const code of ['', 'X', null, 1, undefined]) {
    assert.equal(tariffOf(code), undefined);
  }
});

test('an index is never a partial sum, never 0', () => {
  // One tariff missing: no total at all (the other alone would read as a drop).
  const half = parseSmartmeter(meterWith({ CONSUMPTION_KWH_HIGH: null }));
  assert.equal(half.consumption.high, undefined);
  assert.equal(half.consumption.total, undefined);
  const zero = parseSmartmeter(meterWith({ CONSUMPTION_KWH_HIGH: 0, CONSUMPTION_KWH_LOW: 0 }));
  assert.equal(zero.consumption.total, undefined);
  const text = parseSmartmeter(meterWith({ CONSUMPTION_KWH_LOW: 'n/a', CONSUMPTION_GAS_M3: 0 }));
  assert.equal(text.consumption.total, undefined);
  assert.equal(text.gas, undefined);
  const negative = parseSmartmeter(meterWith({ CONSUMPTION_W: -5 }));
  assert.equal(negative.power, undefined);
});

test('the status page: phases in W, V, A; only the phases that show something', () => {
  const single = parsePhases(STATUS);
  assert.deepEqual(single.phases, [
    { powerConsumed: 863, powerProduced: 0, current: 4, voltage: 229 },
  ]);
  const three = parsePhases(STATUS_3P);
  assert.equal(three.phases.length, 3);
  assert.equal(three.phases[1].powerProduced, 1250);
  assert.equal(three.phases[2].voltage, 230.1);
  assert.deepEqual(parsePhases([{ STATUS_ID: 1, STATUS: 'x' }]), undefined);
  assert.deepEqual(parsePhases({}), undefined);
  assert.deepEqual(parsePhases([{ STATUS_ID: 103, STATUS: '0.0' }]), { phases: [] });
});

test('the configuration page: the prices; out of range or missing ones dropped', () => {
  assert.deepEqual(parsePrices(CONFIGURATION), {
    consumptionLow: 0.22311,
    consumptionHigh: 0.24388,
    injectionLow: 0.22311,
    injectionHigh: 0.24388,
    gas: 0.86687,
  });
  assert.deepEqual(
    parsePrices([
      { CONFIGURATION_ID: 1, PARAMETER: '0' },
      { CONFIGURATION_ID: 2, PARAMETER: '5000' },
      { CONFIGURATION_ID: 15, PARAMETER: '' },
    ]),
    { consumptionLow: 0 },
  );
  assert.equal(parsePrices([]), undefined);
  assert.equal(parsePrices({}), undefined);
});

test('the water page: the total in m³, never the litres of the day', () => {
  assert.deepEqual(parseWater(WATER), { total: 1640.399 });
  assert.deepEqual(parseWater([]), { none: true });
  assert.deepEqual(parseWater([{ ...WATER[0], WATERMETER_CONSUMPTION_TOTAL_M3: 0 }]), {
    total: undefined,
  });
  assert.equal(parseWater([{ WATERMETER_CONSUMPTION_LITER: 12 }]), undefined);
});

test('capabilities: injection, gas, water only once they hold something; only growing', () => {
  const meter = parseSmartmeter(SMARTMETER);
  const caps = capabilitiesOf({
    meter,
    phases: parsePhases(STATUS),
    prices: parsePrices(CONFIGURATION),
    water: parseWater(WATER),
  });
  assert.deepEqual(caps, {
    power: true,
    consumption: true,
    injection: true,
    tariff: true,
    gas: true,
    water: true,
    phases: 1,
    prices: true,
    gasPrice: true,
  });
  const noSolar = capabilitiesOf({
    meter: parseSmartmeter(
      meterWith({
        PRODUCTION_KWH_LOW: 0,
        PRODUCTION_KWH_HIGH: 0,
        PRODUCTION_W: 0,
        CONSUMPTION_GAS_M3: 0,
      }),
    ),
  });
  assert.equal(noSolar.injection, false);
  assert.equal(noSolar.gas, false);
  assert.equal(noSolar.water, false);
  const merged = mergeCapabilities(caps, noSolar);
  assert.equal(merged.injection, true);
  assert.equal(merged.phases, 1);
  assert.equal(bringsNew(caps, merged), false);
  assert.equal(bringsNew(noSolar, merged), true);
  assert.equal(bringsNew(caps, { ...caps, phases: 3 }), true);
});

const fullCaps = () =>
  capabilitiesOf({
    meter: parseSmartmeter(SMARTMETER),
    phases: parsePhases(STATUS_3P),
    prices: parsePrices(CONFIGURATION),
    water: parseWater(WATER),
  });

test('the device: one index in the energy monitoring, everything else plain or volume', () => {
  const gladys = createFakeGladys({ selector: 'p1-monitor' });
  const built = buildDevice(gladys, fullCaps(), '192.168.1.40');
  assert.equal(built.external_id, 'ext:p1-monitor:p1monitor:meter');
  const byKey = Object.fromEntries(built.features.map((f) => [key(f), f]));
  // The only energy index: the consumption (low + high).
  assert.deepEqual(
    built.features
      .filter(
        (f) =>
          f.category === C.ENERGY_SENSOR &&
          [T.ENERGY_SENSOR.INDEX, T.ENERGY_SENSOR.ENERGY].includes(f.type),
      )
      .map(key),
    [FEATURE.CONSUMPTION_INDEX],
  );
  assert.equal(byKey.consumption_index.unit, U.KILOWATT_HOUR);
  for (const f of built.features) {
    assert.notEqual(f.type, T.ENERGY_SENSOR.DAILY_CONSUMPTION);
    assert.notEqual(f.type, T.ENERGY_SENSOR.THIRTY_MINUTES_CONSUMPTION);
    assert.ok(f.read_only, key(f));
  }
  // Gas and water: volume sensors, out of the energy monitoring.
  for (const k of ['gas', 'water']) {
    assert.equal(byKey[k].category, C.VOLUME_SENSOR);
    assert.equal(byKey[k].unit, U.CUBIC_METER);
  }
  // Injection, tariff indexes, prices: plain sensors, never billed.
  for (const k of [
    'injection_power',
    'injection_index',
    'injection_low',
    'injection_high',
    'consumption_low',
    'consumption_high',
    'price_consumption_low',
    'price_injection_high',
    'price_gas',
    'power_l1',
    'injection_power_l2',
  ]) {
    assert.equal(byKey[k].category, C.UNKNOWN, k);
    assert.equal(byKey[k].unit, undefined, k);
  }
  // The power taken is the only energy-sensor power.
  assert.deepEqual(
    built.features
      .filter((f) => f.category === C.ENERGY_SENSOR && f.type === T.ENERGY_SENSOR.POWER)
      .map(key),
    ['power'],
  );
  assert.equal(byKey.voltage_l3.unit, U.VOLT);
  assert.equal(byKey.current_l2.unit, U.AMPERE);
  assert.equal(byKey.voltage_l3.keep_history, false);
  assert.equal(byKey.tariff.type, T.SENSOR.INTEGER);
  // Every unit is one the core lists for the category.
  const allowed = {
    [C.ENERGY_SENSOR]: [U.WATT, U.VOLT, U.AMPERE, U.KILOWATT_HOUR],
    [C.VOLUME_SENSOR]: [U.CUBIC_METER],
    [C.UNKNOWN]: [undefined],
  };
  for (const f of built.features) {
    assert.ok(allowed[f.category].includes(f.unit), `${key(f)}: ${f.unit}`);
  }
});

test('the device without solar, gas nor water: no injection, gas or water feature', () => {
  const gladys = createFakeGladys({ selector: 'p1-monitor' });
  const caps = { ...fullCaps(), injection: false, gas: false, water: false };
  const keys = buildDevice(gladys, caps, 'x').features.map(key);
  for (const k of [
    'injection_power',
    'injection_index',
    'price_injection_low',
    'gas',
    'water',
    'price_gas',
  ]) {
    assert.ok(!keys.includes(k), k);
  }
  assert.ok(!keys.some((k) => k.startsWith('injection_power_l')));
});

test('a created device gives back its capabilities (the published one never shrinks)', () => {
  const gladys = createFakeGladys({ selector: 'p1-monitor' });
  const caps = fullCaps();
  const built = buildDevice(gladys, caps, 'x');
  assert.deepEqual(capabilitiesOfDevice(built), caps);
  assert.equal(capabilitiesOfDevice({ features: [] }), undefined);
  const again = buildDevice(gladys, capabilitiesOfDevice(built), 'x');
  assert.deepEqual(again.features.map(key), built.features.map(key));
});

test('one device per integration, whatever the address', () => {
  const gladys = createFakeGladys({ selector: 'p1-monitor' });
  assert.equal(ids(gladys).device, 'ext:p1-monitor:p1monitor:meter');
  const built = buildDevice(gladys, { power: true }, '192.168.1.41:8080');
  assert.equal(built.external_id, 'ext:p1-monitor:p1monitor:meter');
  assert.deepEqual(built.params, [{ name: 'address', value: '192.168.1.41:8080' }]);
});

test('a power above 100 kW is a glitch: undefined, per phase too', () => {
  const meter = parseSmartmeter(meterWith({ CONSUMPTION_W: 100_001, PRODUCTION_W: 250_000 }));
  assert.equal(meter.power, undefined);
  assert.equal(meter.injectionPower, undefined);
  assert.equal(parseSmartmeter(meterWith({ CONSUMPTION_W: 100_000 })).power, 100_000);
  const phases = parsePhases([
    { STATUS_ID: 74, STATUS: '100.5' },
    { STATUS_ID: 77, STATUS: '250' },
    { STATUS_ID: 103, STATUS: '230' },
  ]).phases;
  assert.equal(phases[0].powerConsumed, undefined);
  assert.equal(phases[0].powerProduced, undefined);
  assert.equal(phases[0].voltage, 230);
});

test('states: live values and indexes apart, rounded, counters never 0', () => {
  const gladys = createFakeGladys({ selector: 'p1-monitor' });
  const external = ids(gladys);
  const meter = parseSmartmeter(SMARTMETER);
  const phases = parsePhases(STATUS_3P).phases;
  const live = liveStates(external, meter, phases);
  assert.deepEqual(
    live.slice(0, 2).map((s) => [s.device_feature_external_id.split(':').at(-1), s.state]),
    [
      ['power', 935],
      ['injection_power', 0],
    ],
  );
  assert.equal(live.length, 2 + 3 * 4);
  const data = { meter, water: parseWater(WATER), prices: parsePrices(CONFIGURATION) };
  const held = indexStates(external, data, undefined);
  assert.ok(!held.some((s) => s.device_feature_external_id.endsWith(':consumption_index')));
  const index = indexStates(external, data, 8432.397);
  const byKey = Object.fromEntries(
    index.map((s) => [s.device_feature_external_id.split(':').at(-1), s.state]),
  );
  assert.equal(byKey.consumption_index, 8432.397);
  assert.equal(byKey.consumption_low, 5436.256);
  assert.equal(byKey.injection_index, 5984.449);
  assert.equal(byKey.gas, 2289.967);
  assert.equal(byKey.water, 1640.399);
  assert.equal(byKey.tariff, 1);
  assert.equal(byKey.price_gas, 0.86687);
  // Counters at 0 are never sent; a price at 0 is.
  const zero = {
    meter: parseSmartmeter(meterWith({ PRODUCTION_KWH_LOW: 0, PRODUCTION_KWH_HIGH: 0 })),
    prices: { injectionLow: 0 },
  };
  const keys = indexStates(external, zero, 0).map((s) =>
    s.device_feature_external_id.split(':').at(-1),
  );
  for (const k of ['consumption_index', 'injection_index', 'injection_low', 'injection_high']) {
    assert.ok(!keys.includes(k), k);
  }
  assert.ok(keys.includes('price_injection_low'));
});

// --- The index guard -------------------------------------------------------------------

test('index guard: never 0, a normal rise goes through', () => {
  const guard = new IndexGuard();
  assert.equal(guard.accept(0, 0), false, 'never 0, even as the first reference');
  assert.equal(guard.accept(1000, 0), true);
  assert.equal(guard.accept(1000.2, MINUTE), true);
  for (let i = 2; i < 200; i += 1) {
    assert.equal(guard.accept(0, i * MINUTE), false);
  }
  assert.equal(guard.accept(1000.3, 200 * MINUTE), true);
  assert.equal(new IndexGuard().accept(-1, 0), false);
  assert.equal(new IndexGuard().accept(NaN, 0), false);
  assert.equal(new IndexGuard({ value: 100, at: 0 }).accept(400, 24 * 60 * MINUTE), true);
});

test('index guard: a jump up is never confirmed by repetition, only by the user', () => {
  const guard = new IndexGuard({ value: 1000, at: 0 });
  for (let i = 1; i <= 500; i += 1) {
    assert.equal(guard.accept(6000 + i * 0.01, i * MINUTE), false);
  }
  assert.deepEqual(guard.held, {
    direction: 'up',
    from: 1000,
    to: 6005,
    threshold: 6000.01,
    at: 500 * MINUTE,
  });
  assert.deepEqual(guard.acceptHeld(), { direction: 'up', from: 1000, to: 6005 });
  assert.equal(guard.accept(6005.01, 501 * MINUTE), true);
  assert.equal(guard.held, undefined);
  const back = new IndexGuard({ value: 1000, at: 0 });
  back.accept(9000, MINUTE);
  assert.equal(back.accept(1000.1, 2 * MINUTE), true);
  assert.equal(back.held, undefined);
  back.acceptHeld();
  assert.equal(back.accept(9000, 3 * MINUTE), false, 'an old acceptance never covers a new jump');
});

test('index guard: a held jump is never covered by the margin growing over time', () => {
  const guard = new IndexGuard({ value: 2.5, at: 0 });
  assert.equal(guard.accept(12345, MINUTE), false);
  assert.equal(guard.accept(12345.5, 200 * 60 * MINUTE), false);
  assert.deepEqual(guard.held, {
    direction: 'up',
    from: 2.5,
    to: 12345.5,
    threshold: 12345,
    at: 200 * 60 * MINUTE,
  });
  assert.equal(guard.accept(2.6, 200 * 60 * MINUTE + MINUTE), true);
});

test('index guard: a drop is never confirmed by time; back up, nothing fictive is billed', () => {
  const guard = new IndexGuard({ value: 50_000, at: 0 });
  // A drop to 10 kWh, for a week: held all along.
  for (let i = 1; i <= 7 * 24 * 60; i += 60) {
    assert.equal(guard.accept(10 + i * 0.0001, i * MINUTE), false, `minute ${i}`);
  }
  assert.equal(guard.held.direction, 'down');
  assert.deepEqual(guard.last, { value: 50_000, at: 0 });
  // Back to the real value: it goes through, the hold ends; the reference
  // never went down, so no rise of 50,000 kWh is ever billed.
  assert.equal(guard.accept(50_001, 7 * 24 * 60 * MINUTE + MINUTE), true);
  assert.equal(guard.held, undefined);
});

test('index guard: a drop accepted by the user, then the values rise normally', () => {
  const guard = new IndexGuard({ value: 50_000, at: 0 });
  assert.equal(guard.accept(10, MINUTE), false);
  guard.acceptHeld();
  // The core skips the negative delta: nothing billed.
  assert.equal(guard.accept(10.01, 2 * MINUTE), true);
  assert.deepEqual(guard.last, { value: 10.01, at: 2 * MINUTE });
  assert.equal(guard.accept(10.5, 3 * MINUTE), true);
  // Back to the old value after the acceptance: a jump, held.
  assert.equal(guard.accept(50_000, 4 * MINUTE), false);
  assert.equal(guard.held.direction, 'up');
});

test('index guard: an acceptance of a drop never takes a jump', () => {
  const guard = new IndexGuard({ value: 1000, at: 0 });
  guard.accept(10, MINUTE);
  guard.acceptHeld();
  assert.equal(guard.accept(90_000, 2 * MINUTE), false);
  assert.equal(guard.held.direction, 'up');
  assert.equal(guard.accept(90_000, 3 * MINUTE), false);
});

test('index guard: a frozen reading never shrinks the margin of the next rise', () => {
  const guard = new IndexGuard({ value: 1000, at: 0 });
  // 3 hours of the same value, read every minute.
  for (let i = 1; i <= 180; i += 1) {
    assert.equal(guard.accept(1000, i * MINUTE), true);
  }
  assert.deepEqual(guard.last, { value: 1000, at: 0 }, 'the date of the value is kept');
  // +4 kWh after 3 hours: 1.3 kW on average, plausible.
  assert.equal(guard.accept(1004, 181 * MINUTE), true);
  assert.equal(guard.held, undefined);
});

test('index guard: its state survives a restart; same value, the oldest date', () => {
  const guard = new IndexGuard({ value: 1000, at: 0 });
  guard.accept(1050, MINUTE);
  const saved = JSON.parse(JSON.stringify(guard.state()));
  const again = new IndexGuard({ value: 900, at: -1000 * MINUTE }, saved);
  assert.deepEqual(again.last, { value: 1000, at: 0 });
  assert.equal(again.accept(1050.1, 60 * MINUTE), false, 'still held after the restart');
  again.acceptHeld();
  assert.equal(again.accept(1050.2, 61 * MINUTE), true);
  // A newer value in Gladys than in /data wins; the same value keeps its oldest date.
  assert.deepEqual(new IndexGuard({ value: 1100, at: 5 }, saved).last, { value: 1100, at: 5 });
  assert.deepEqual(new IndexGuard({ value: 1000, at: 50 }, saved).last, { value: 1000, at: 0 });
  assert.deepEqual(
    new IndexGuard({ value: 1000, at: -50 }, { last: { value: 1000, at: 10 } }).last,
    { value: 1000, at: -50 },
  );
});

test('index guard: an acceptance is bounded to the value shown and the margin since', () => {
  const guard = new IndexGuard({ value: 1000, at: 0 });
  assert.equal(guard.accept(1005, MINUTE), false);
  assert.deepEqual(guard.acceptHeld(), { direction: 'up', from: 1000, to: 1005 });
  // 5000 is not what the user saw: held again, nothing taken, acceptance dropped.
  assert.equal(guard.accept(5000, 2 * MINUTE), false);
  assert.deepEqual(guard.last, { value: 1000, at: 0 });
  assert.equal(guard.held.to, 5000);
  assert.equal(guard.accepted, undefined);
  assert.equal(guard.accept(5000.1, 3 * MINUTE), false, 'still held');
  // The value shown, plus what the home may draw meanwhile: taken.
  const fair = new IndexGuard({ value: 1000, at: 0 });
  fair.accept(1005, MINUTE);
  fair.acceptHeld();
  assert.equal(fair.accept(1005.5, 2 * MINUTE), true);
  // Below the value shown: not the jump accepted either.
  const below = new IndexGuard({ value: 1000, at: 0 });
  below.accept(1005, MINUTE);
  below.acceptHeld();
  assert.equal(below.accept(1004, 2 * MINUTE), false);
  // A drop: at most the value shown plus the margin.
  const drop = new IndexGuard({ value: 1000, at: 0 });
  drop.accept(10, MINUTE);
  drop.acceptHeld();
  assert.equal(drop.accept(900, 2 * MINUTE), false, 'not the drop shown');
  drop.accept(10, 3 * MINUTE);
  drop.acceptHeld();
  assert.equal(drop.accept(10.2, 4 * MINUTE), true);
  assert.equal(new IndexGuard({ value: 1, at: 0 }).acceptHeld(), undefined, 'nothing held');
});
test('index of the tariffs: both there; a register at 0 or dropping alone is no index', () => {
  assert.equal(indexOfTariffs(5000, 3000), 8000);
  assert.equal(indexOfTariffs(5000, 0), 5000, 'a single-tariff meter, no reference yet');
  for (const [low, high] of [
    [undefined, 3000],
    [5000, null],
    [NaN, 3000],
    [Infinity, 1],
    [-1, 3000],
    [0, 0],
  ]) {
    assert.equal(indexOfTariffs(low, high), undefined, `${low} ${high}`);
  }
  const ref = { low: 5000, high: 3000 };
  assert.equal(indexOfTariffs(5000.1, 3000, ref), 8000.1);
  assert.equal(indexOfTariffs(0, 3000.1, ref), undefined, 'a tariff above 0 falls to 0');
  assert.equal(indexOfTariffs(4000, 3000.1, ref), undefined, 'one tariff drops alone');
  assert.equal(indexOfTariffs(5000, 2999, ref), undefined, 'one tariff drops alone');
  assert.equal(indexOfTariffs(10, 5, ref), 15, 'both drop: a real drop, for the guard');
  assert.equal(indexOfTariffs(10, 0, ref), 10, 'both lower, one at 0: still a real drop');
  assert.equal(indexOfTariffs(5000.1, 0, { low: 5000, high: 0 }), 5000.1, 'single tariff');
});

// --- Configuration and store ---------------------------------------------------------

test('the address: IP, host name, port, pasted URL; never credentials', () => {
  assert.deepEqual(parseAddress(' 192.168.1.40 '), { address: '192.168.1.40' });
  assert.deepEqual(parseAddress('http://P1MON.local:8080/home.html'), {
    address: 'p1mon.local:8080',
  });
  assert.deepEqual(parseAddress('192.168.1.40:80'), { address: '192.168.1.40' });
  assert.deepEqual(parseAddress('fe80::1'), { address: '[fe80::1]' });
  assert.deepEqual(parseAddress(''), { address: '' });
  for (const bad of ['http://u:p@1.2.3.4', 'a b', '1.2.3.4:99999', '-x-']) {
    assert.deepEqual(parseAddress(bad), { error: 'invalid' }, bad);
  }
  assert.deepEqual(normalizeConfig({ address: 'u@x' }), { address: '', invalidAddress: true });
});

test('the /data store: written through a temporary file, read back, empty when absent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'p1-monitor-'));
  try {
    const store = createFileStore(join(dir, 'state.json'));
    assert.deepEqual(store.load(), {});
    await store.save({ a: { last: { value: 1, at: 2 }, jump: null } });
    assert.deepEqual(store.load(), { a: { last: { value: 1, at: 2 }, jump: null } });
    assert.deepEqual(createFileStore(join(dir, 'missing', 'x.json')).load(), {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and a fake P1 Monitor.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { P1MonitorApp } from '../src/app.js';
import {
  ACTIONS,
  NO_WATER_RETRY,
  POWER_INTERVAL,
  READING_STALE_AFTER,
  RETRY_MIN,
  SECONDARY_RETRY,
} from '../src/constants.js';
import { buildDevice } from '../src/devices.js';
import { createMemoryStore } from '../src/store.js';
import { P1MonitorClient } from '../src/p1monitor/client.js';
import {
  capabilitiesOf,
  parsePhases,
  parsePrices,
  parseSmartmeter,
  parseWater,
} from '../src/p1monitor/model.js';
import { createFetch, timeoutError } from './helpers/fakeFetch.js';
import { createFakeTimers } from './helpers/fakeTimers.js';
import {
  ADDRESS,
  CONFIGURATION,
  NOW,
  SMARTMETER,
  STATUS,
  WATER,
  json,
  meterWith,
  routes as p1Routes,
} from './fixtures/p1monitor.js';

const SELECTOR = 'p1-monitor';
const DEVICE = `ext:${SELECTOR}:p1monitor:meter`;
const F = (key) => `${DEVICE}:${key}`;
const CONFIG = { address: ADDRESS };
const MINUTE = 60_000;
const SMARTMETER_PATH = '/api/v1/smartmeter';
/** low + high of the fixture, as Gladys holds it (3 decimals). */
const INDEX = 8432.397;

function createLogger() {
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  return { lines, info: log, warn: log, error: log, debug: log };
}

/** The device as the user created it from the discovered one. */
function created(caps) {
  const gladys = createFakeGladys({ selector: SELECTOR });
  return buildDevice(
    gladys,
    caps ??
      capabilitiesOf({
        meter: parseSmartmeter(SMARTMETER),
        phases: parsePhases(STATUS),
        prices: parsePrices(CONFIGURATION),
        water: parseWater(WATER),
      }),
    ADDRESS,
  );
}

async function setup({
  config = CONFIG,
  routes = p1Routes(),
  devices = [],
  store = createMemoryStore(),
  now = NOW,
} = {}) {
  const fake = createFetch(routes);
  const gladys = createFakeGladys({ selector: SELECTOR, config, devices });
  await gladys.connect();
  const timers = createFakeTimers();
  const clock = { now };
  const logger = createLogger();
  const app = new P1MonitorApp({
    gladys,
    logger,
    now: () => clock.now,
    monotonic: () => clock.now,
    timers,
    store,
    clientFactory: (options) => new P1MonitorClient({ ...options, fetchImpl: fake.fetch }),
  });
  gladys.onDeviceCreated((device) => app.onDeviceCreated(device));
  gladys.onDeviceUpdated((device) => app.onDeviceUpdated(device));
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());
  /** The next 10-second tick (or `ms` later). */
  const tick = async (ms = POWER_INTERVAL) => {
    clock.now += ms;
    await timers.runIntervals();
  };
  return { app, gladys, timers, clock, logger, fake, tick };
}

const status = (gladys) => gladys.fake.connectionStatus;
const published = (gladys, key) =>
  gladys.fake.states.filter((s) => s.device_feature_external_id === F(key));
const indexes = (gladys) => published(gladys, 'consumption_index').map((s) => s.state);
const distinct = (values) => [...new Set(values)];

/** A meter answer that changes every call (a live P1 Monitor), with these fields. */
function liveMeter(routes, fields = {}) {
  let stamp = 0;
  routes[SMARTMETER_PATH] = () => json(meterWith(fields, (stamp += 10)));
}

test('no address, a wrong one: the status says so, nothing is called', async () => {
  for (const [config, pattern] of [
    [{}, /Saisissez l’adresse/],
    [{ address: 'http://admin:pw@1.2.3.4' }, /pas valide/],
  ]) {
    const { app, gladys, timers, fake } = await setup({ config });
    await app.start(config);
    await app.idle();
    assert.equal(status(gladys).connected, false);
    assert.match(status(gladys).message.fr, pattern);
    assert.equal(fake.calls.length, 0);
    assert.equal(timers.pending.size, 0);
    assert.match(String((await gladys.fake.action(ACTIONS.TEST)).data.message.fr), pattern);
  }
});

test('the device is discovered with what the P1 Monitor gives; no value before it is created', async () => {
  const { app, gladys } = await setup();
  await app.start(CONFIG);
  await app.idle();
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, DEVICE);
  assert.equal(device.name, 'P1 Monitor');
  const keys = device.features.map((f) => f.external_id.split(':').at(-1));
  for (const key of [
    'power',
    'injection_power',
    'consumption_index',
    'consumption_low',
    'injection_index',
    'tariff',
    'gas',
    'water',
    'voltage_l1',
    'price_consumption_high',
    'price_gas',
  ]) {
    assert.ok(keys.includes(key), key);
  }
  assert.ok(!keys.includes('voltage_l2'), 'a single-phase meter');
  assert.equal(gladys.fake.states.length, 0);
  assert.equal(status(gladys).connected, true);
  assert.match(status(gladys).message.fr, /Découverte/);
});

test('created device: power every 10 s, indexes once a minute, gas and water as volumes', async () => {
  const routes = p1Routes();
  const { app, gladys, tick } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(gladys.fake.lastState(F('power')), 935);
  assert.equal(gladys.fake.lastState(F('injection_power')), 0);
  assert.equal(gladys.fake.lastState(F('consumption_index')), INDEX);
  assert.equal(gladys.fake.lastState(F('consumption_high')), 2996.141);
  assert.equal(gladys.fake.lastState(F('injection_index')), 5984.449);
  assert.equal(gladys.fake.lastState(F('gas')), 2289.967);
  assert.equal(gladys.fake.lastState(F('water')), 1640.399);
  assert.equal(gladys.fake.lastState(F('voltage_l1')), 229);
  assert.equal(gladys.fake.lastState(F('power_l1')), 863);
  assert.equal(gladys.fake.lastState(F('tariff')), 1);
  assert.equal(gladys.fake.lastState(F('price_consumption_low')), 0.22311);
  assert.match(status(gladys).message.en, /Connected to the P1 Monitor \(192\.168\.1\.40\)\./);

  // 10 s later: a new power is sent, the new index waits for the minute.
  routes[SMARTMETER_PATH] = () =>
    json(meterWith({ CONSUMPTION_W: 500, CONSUMPTION_KWH_LOW: 5436.3, TARIFCODE: 'P' }));
  await tick();
  assert.equal(gladys.fake.lastState(F('power')), 500);
  assert.equal(gladys.fake.lastState(F('consumption_index')), INDEX);
  for (let i = 0; i < 5; i += 1) {
    await tick();
  }
  assert.equal(gladys.fake.lastState(F('consumption_index')), 8432.441);
  assert.equal(gladys.fake.lastState(F('tariff')), 2);
  // Never anything through the energy consumption endpoint (gas above all).
  assert.equal(gladys.fake.publishedEnergyConsumption.length, 0);
});

test('the injection never reaches the consumption index', async () => {
  const routes = p1Routes();
  const { app, gladys, tick } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  liveMeter(routes, { PRODUCTION_KWH_LOW: 1600, PRODUCTION_KWH_HIGH: 4500, PRODUCTION_W: 3000 });
  await tick(MINUTE);
  assert.deepEqual(distinct(indexes(gladys)), [INDEX]);
  assert.equal(gladys.fake.lastState(F('injection_index')), 6100);
  assert.equal(gladys.fake.lastState(F('injection_power')), 3000);
});

test('an index glitch (0, one tariff missing) never reaches Gladys', async () => {
  const routes = p1Routes();
  const { app, gladys, tick, logger } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  routes[SMARTMETER_PATH] = () =>
    json(meterWith({ CONSUMPTION_KWH_LOW: 0.001, CONSUMPTION_KWH_HIGH: 0 }));
  await tick(MINUTE);
  // Caught by the tariff check, before the guard: no index, no hold.
  assert.ok(!logger.lines.some((l) => /held back/.test(l)));
  assert.match(status(gladys).message.fr, /ne donne pas d’index/);
  liveMeter(routes, { CONSUMPTION_KWH_HIGH: null, CONSUMPTION_KWH_LOW: 0, CONSUMPTION_GAS_M3: 0 });
  for (let i = 0; i < 10; i += 1) {
    await tick(MINUTE);
  }
  assert.deepEqual(indexes(gladys), [INDEX]);
  assert.match(status(gladys).message.fr, /ne donne pas d’index/);
  // The tariff counters and gas are never sent at 0 either.
  assert.ok(!published(gladys, 'consumption_low').some((s) => s.state === 0));
  assert.ok(!published(gladys, 'gas').some((s) => s.state === 0));
});

/** The consumption the core would derive from the published index: the sum of its rises. */
const billed = (gladys) =>
  indexes(gladys).reduce(
    (acc, value) => ({ sum: acc.sum + Math.max(0, value - acc.prev), prev: value }),
    { sum: 0, prev: indexes(gladys)[0] },
  ).sum;

test('one tariff at 0 for more than an hour, then back: no fictive kWh', async () => {
  const routes = p1Routes();
  const { app, gladys, tick } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  liveMeter(routes, { CONSUMPTION_KWH_HIGH: 0 });
  for (let i = 0; i < 90; i += 1) {
    await tick(MINUTE);
  }
  assert.deepEqual(distinct(indexes(gladys)), [INDEX]);
  liveMeter(routes, { CONSUMPTION_KWH_LOW: 5436.356 });
  await tick(MINUTE);
  assert.equal(indexes(gladys).at(-1), 8432.497);
  assert.ok(Math.abs(billed(gladys) - 0.1) < 1e-6, `billed ${billed(gladys)}`);
});

test('a real drop is held for hours, never confirmed by time; back up, no fictive kWh', async () => {
  const routes = p1Routes();
  const { app, gladys, tick } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  // Both tariffs far lower (another meter, a reset), for 3 hours.
  liveMeter(routes, { CONSUMPTION_KWH_LOW: 3, CONSUMPTION_KWH_HIGH: 2 });
  for (let i = 0; i < 180; i += 1) {
    await tick(MINUTE);
  }
  assert.deepEqual(distinct(indexes(gladys)), [INDEX]);
  assert.match(status(gladys).message.fr, /a baissé de 8432.397 à 5 kWh/);
  // The real values come back: they go on from the reference, nothing billed in between.
  liveMeter(routes, { CONSUMPTION_KWH_LOW: 5436.3 });
  await tick(MINUTE);
  assert.equal(indexes(gladys).at(-1), 8432.441);
  assert.ok(billed(gladys) < 0.1, `billed ${billed(gladys)}`);
  assert.doesNotMatch(status(gladys).message.fr, /baissé/);
});

test('a drop accepted by a save: nothing billed, then the index rises normally', async () => {
  const routes = p1Routes();
  const { app, gladys, tick } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  liveMeter(routes, { CONSUMPTION_KWH_LOW: 3, CONSUMPTION_KWH_HIGH: 2 });
  await tick(MINUTE);
  await app.start(CONFIG, { fresh: true });
  await app.idle();
  assert.equal(indexes(gladys).at(-1), 5);
  liveMeter(routes, { CONSUMPTION_KWH_LOW: 3.5, CONSUMPTION_KWH_HIGH: 2 });
  await tick(MINUTE);
  assert.equal(indexes(gladys).at(-1), 5.5);
  assert.ok(Math.abs(billed(gladys) - 0.5) < 1e-6, `billed ${billed(gladys)}`);
});

test('a frozen reading for 3 hours, then +4 kWh: accepted, nothing held', async () => {
  const routes = p1Routes();
  const { app, gladys, tick } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  for (let i = 0; i < 180; i += 1) {
    await tick(MINUTE);
  }
  routes[SMARTMETER_PATH] = () => json(meterWith({ CONSUMPTION_KWH_LOW: 5440.256 }));
  await tick(MINUTE);
  assert.equal(indexes(gladys).at(-1), 8436.397);
  assert.doesNotMatch(status(gladys).message.fr, /sauté/);
});

test('a jump up is held until the user saves the configuration, then counted once', async () => {
  const routes = p1Routes();
  const { app, gladys, tick } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  liveMeter(routes, { CONSUMPTION_KWH_LOW: 10436.256 });
  for (let i = 0; i < 90; i += 1) {
    await tick(MINUTE);
  }
  // The last accepted value may be sent again (heartbeat), never the jump.
  assert.deepEqual(distinct(indexes(gladys)), [INDEX]);
  assert.match(status(gladys).message.fr, /sauté de 8432.397 à 13432.397 kWh/);
  assert.match(status(gladys).message.fr, /5000 kWh seront comptés d’un coup comme consommation/);
  assert.match(status(gladys).message.en, /save only if this energy was really consumed/);
  // A simple reconnection never accepts it.
  await app.start(CONFIG);
  await app.idle();
  assert.deepEqual(distinct(indexes(gladys)), [INDEX]);
  await app.start(CONFIG, { fresh: true });
  await app.idle();
  assert.deepEqual(distinct(indexes(gladys)), [INDEX, 13432.397]);
  assert.doesNotMatch(status(gladys).message.fr, /sauté/);
});

test('a jump held stays held across a restart, until the configuration is saved', async () => {
  const store = createMemoryStore();
  const routes = p1Routes();
  const first = await setup({ routes, devices: [created()], store });
  await first.app.start(CONFIG);
  await first.app.idle();
  routes[SMARTMETER_PATH] = () => json(meterWith({ CONSUMPTION_KWH_LOW: 10436.256 }));
  await first.tick(MINUTE);
  await first.app.stop();
  // A new container, hours later; Gladys still holds an old value.
  const device = created();
  const index = device.features.find((f) => f.external_id.endsWith(':consumption_index'));
  index.last_value = INDEX;
  index.last_value_changed = new Date(NOW - 200 * 3_600_000).toISOString();
  const second = await setup({ routes, devices: [device], store, now: NOW + 5 * 3_600_000 });
  await second.app.start(CONFIG);
  await second.app.idle();
  for (let i = 0; i < 5; i += 1) {
    await second.tick(MINUTE);
  }
  assert.ok(!indexes(second.gladys).includes(13432.397));
  assert.match(status(second.gladys).message.fr, /sauté/);
  await second.app.start(CONFIG, { fresh: true });
  await second.app.idle();
  assert.equal(indexes(second.gladys).at(-1), 13432.397);
});

test('unreachable P1 Monitor: status, growing delays, no request in between, then back', async () => {
  const routes = p1Routes();
  const { app, gladys, tick, fake, logger } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  routes[SMARTMETER_PATH] = () => {
    throw timeoutError();
  };
  await tick();
  assert.equal(status(gladys).connected, false);
  assert.match(status(gladys).message.fr, /pas de réponse.*10 s/);
  const calls = fake.calls.length;
  await tick(RETRY_MIN - 1000);
  assert.equal(fake.calls.length, calls, 'no request before the delay');
  await tick(1000);
  assert.match(status(gladys).message.fr, /20 s/);
  routes[SMARTMETER_PATH] = () => json(meterWith({}));
  await tick(20_000);
  assert.equal(status(gladys).connected, true);
  assert.ok(!logger.lines.join('\n').includes('http://'), 'no URL in the logs');
});

test('a secondary page failing: logged once, shown, the main values go on', async () => {
  const routes = p1Routes({
    '/api/v1/status': () => new Response('x', { status: 500 }),
    '/api/v1/configuration': () => {
      throw timeoutError();
    },
  });
  const { app, gladys, tick, logger, fake } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(gladys.fake.lastState(F('power')), 935);
  assert.equal(gladys.fake.lastState(F('consumption_index')), INDEX);
  assert.equal(gladys.fake.lastState(F('voltage_l1')), undefined);
  assert.equal(status(gladys).connected, true);
  assert.match(status(gladys).message.fr, /Certaines pages ne répondent pas \(phases, prix\)/);
  const statusCalls = () => fake.calls.filter((c) => c.path === '/api/v1/status').length;
  await tick();
  await tick();
  assert.equal(statusCalls(), 1, 'tried again after its own delay only');
  assert.equal(logger.lines.filter((l) => /status|phases page unavailable/.test(l)).length, 1);
  routes['/api/v1/status'] = () => json(STATUS);
  liveMeter(routes);
  await tick(SECONDARY_RETRY);
  assert.equal(gladys.fake.lastState(F('voltage_l1')), 229);
  assert.doesNotMatch(status(gladys).message.fr, /phases/);
});

test('no water meter: no water feature, asked again only after an hour', async () => {
  const routes = p1Routes({ '/api/v2/watermeter/day': () => json({}, 404) });
  const { app, gladys, tick, fake } = await setup({ routes });
  await app.start(CONFIG);
  await app.idle();
  const keys = gladys.fake.discoveredDevices[0].features.map((f) =>
    f.external_id.split(':').at(-1),
  );
  assert.ok(!keys.includes('water'));
  assert.doesNotMatch(status(gladys).message.fr, /pages/);
  const waterCalls = () => fake.calls.filter((c) => c.path === '/api/v2/watermeter/day').length;
  for (let i = 0; i < 30; i += 1) {
    await tick(MINUTE);
  }
  assert.equal(waterCalls(), 1);
  routes['/api/v2/watermeter/day'] = () => json(WATER);
  await tick(NO_WATER_RETRY);
  assert.equal(waterCalls(), 2);
  const after = gladys.fake.discoveredDevices[0].features.map((f) =>
    f.external_id.split(':').at(-1),
  );
  assert.ok(after.includes('water'), 'a water meter added later appears');
});

test('a frozen reading (P1 cable out): the power is no longer sent, the status says so', async () => {
  const routes = p1Routes();
  const { app, gladys, tick } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  const powers = () => published(gladys, 'power').length;
  // The same TIMESTAMP_UTC on every read.
  await tick(READING_STALE_AFTER);
  const before = powers();
  for (let i = 0; i < 70; i += 1) {
    await tick(MINUTE);
  }
  assert.equal(powers(), before, 'no power from a frozen reading, heartbeat included');
  assert.match(status(gladys).message.fr, /ne donne plus de nouveau relevé/);
  routes[SMARTMETER_PATH] = () => json(meterWith({ CONSUMPTION_W: 1200 }));
  await tick();
  assert.equal(gladys.fake.lastState(F('power')), 1200);
  assert.doesNotMatch(status(gladys).message.fr, /relevé/);
});

test('each reconnection publishes the device, the values and the status again', async () => {
  const routes = p1Routes();
  const { app, gladys, tick } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  const before = indexes(gladys).length;
  const discoveries = gladys.fake.bodies('POST', '/discovered_device').length;
  const statuses = gladys.fake.connectionStatuses.length;
  await app.start(CONFIG);
  await app.idle();
  assert.equal(indexes(gladys).length, before + 1);
  assert.ok(gladys.fake.bodies('POST', '/discovered_device').length > discoveries);
  assert.equal(gladys.fake.connectionStatuses.length, statuses + 1, 'same status sent again');
  // Unreachable, then a reconnection: the delay is kept; a save of the form ends it.
  routes[SMARTMETER_PATH] = () => {
    throw timeoutError();
  };
  await tick();
  await tick();
  assert.match(status(gladys).message.fr, /20 s/);
  routes[SMARTMETER_PATH] = () => json(SMARTMETER);
  const sent = gladys.fake.connectionStatuses.length;
  await app.start(CONFIG);
  await app.idle();
  // The failure is sent again to a Gladys that may have lost it, with the time left.
  assert.equal(gladys.fake.connectionStatuses.length, sent + 1);
  assert.equal(status(gladys).connected, false);
  assert.match(status(gladys).message.fr, /pas de réponse.*20 s/);
  await app.start(CONFIG, { fresh: true });
  await app.idle();
  assert.equal(status(gladys).connected, true);
});

test('the test button reads the meter once', async () => {
  const { app, gladys } = await setup();
  await app.start(CONFIG);
  await app.idle();
  const answer = await gladys.fake.action(ACTIONS.TEST);
  assert.match(
    answer.data.message.en,
    /P1 Monitor read: power taken 935 W, consumption index 8432.397 kWh/,
  );
  const { app: app2, gladys: gladys2 } = await setup({
    routes: p1Routes({ [SMARTMETER_PATH]: () => json([]) }),
  });
  await app2.start(CONFIG);
  await app2.idle();
  const empty = await gladys2.fake.action(ACTIONS.TEST);
  assert.match(empty.data.message.fr, /aucun relevé du compteur/);
});

test('the device created later: its values are read at once', async () => {
  const { app, gladys } = await setup();
  await app.start(CONFIG);
  await app.idle();
  assert.equal(gladys.fake.states.length, 0);
  await gladys.fake.deviceCreated(created());
  assert.equal(gladys.fake.lastState(F('consumption_index')), INDEX);
  assert.match(status(gladys).message.en, /Connected/);
});

test('after "Update" in Discovery, the new features get their values', async () => {
  const small = created({ power: true, consumption: true });
  const { app, gladys } = await setup({ devices: [small] });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(gladys.fake.lastState(F('gas')), undefined);
  await gladys.fake.deviceUpdated(created());
  assert.equal(gladys.fake.lastState(F('gas')), 2289.967);
  assert.equal(gladys.fake.lastState(F('voltage_l1')), 229);
});

test('after a restart, the device published again never loses a feature', async () => {
  const device = created();
  const routes = p1Routes({
    [SMARTMETER_PATH]: () =>
      json(
        meterWith({
          CONSUMPTION_GAS_M3: 0,
          PRODUCTION_W: 0,
          PRODUCTION_KWH_LOW: 0,
          PRODUCTION_KWH_HIGH: 0,
        }),
      ),
    '/api/v1/status': () => new Response('x', { status: 500 }),
    '/api/v1/configuration': () => new Response('x', { status: 500 }),
    '/api/v2/watermeter/day': () => json([]),
  });
  const { app, gladys } = await setup({ routes, devices: [device] });
  await app.start(CONFIG);
  await app.idle();
  const keys = (d) => d.features.map((f) => f.external_id).sort();
  assert.deepEqual(keys(gladys.fake.discoveredDevices[0]), keys(device));
});

test('another service at the address: never a device', async () => {
  const routes = p1Routes({ [SMARTMETER_PATH]: () => json({ status: 'ok' }) });
  const { app, gladys } = await setup({ routes });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(status(gladys).connected, false);
  assert.match(status(gladys).message.fr, /n’est pas celle d’un P1 Monitor/);
  assert.equal(gladys.fake.discoveredDevices.length, 0);
});

test('the address changed during a read: the old read publishes nothing', async () => {
  let release;
  const slow = new Promise((resolve) => {
    release = resolve;
  });
  const routes = p1Routes({
    [SMARTMETER_PATH]: async (call) => {
      if (call.url.includes(ADDRESS)) {
        await slow;
        return json(meterWith({ CONSUMPTION_W: 4321 }));
      }
      return json(meterWith({ CONSUMPTION_W: 1234 }));
    },
  });
  const { app, gladys } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  // The first read waits on the old address; the user saves another one.
  const other = { address: '192.168.1.41' };
  await app.start(other, { fresh: true });
  release();
  await app.idle();
  const powers = published(gladys, 'power').map((s) => s.state);
  assert.ok(!powers.includes(4321), 'nothing from the old address');
  assert.equal(powers.at(-1), 1234);
  assert.match(status(gladys).message.en, /\(192\.168\.1\.41\)/);
  // One device per integration: the same one, its address in its params.
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, DEVICE);
  assert.deepEqual(device.params, [{ name: 'address', value: '192.168.1.41' }]);
});

test('unreachable at the start: the created device is still offered in Discovery', async () => {
  const routes = p1Routes({
    [SMARTMETER_PATH]: () => {
      throw timeoutError();
    },
  });
  const device = created();
  const { app, gladys } = await setup({ routes, devices: [device] });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(status(gladys).connected, false);
  const keys = (d) => d.features.map((f) => f.external_id).sort();
  assert.deepEqual(keys(gladys.fake.discoveredDevices[0]), keys(device));
});

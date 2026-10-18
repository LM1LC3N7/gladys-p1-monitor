// -----------------------------------------------------------------------------
// The Gladys device of a P1 Monitor and its states. Pure.
//
// External id (forever): p1monitor:meter, one device per integration. The API
// gives no serial number the p1monitor library reads, and an address would
// change with the router: a new address of the same P1 Monitor keeps the device
// and its history (the index guard holds a different meter's values).
//
// Energy rules of the Gladys core (server/utils/constants.js and the
// energy-monitoring service):
// - `consumption_index` is the ONLY energy-sensor / index feature: the core
//   derives the consumption and its cost from its deltas, by itself. It holds
//   the electricity taken from the grid, low + high tariff, both cumulative
//   counters of the meter; never a daily total, never the injection;
// - the tariff indexes (low, high) are plain sensors: as indexes they would
//   be counted a second and a third time;
// - the injection is never in a consumption index (it would be billed): plain
//   sensors, kWh in the name;
// - gas and water are NEVER in the energy monitoring (the core would price
//   them at the electricity tariff, and publishEnergyConsumption is never
//   called): volume sensors in m³;
// - `power` is the only energy-sensor / power feature: the energy contracts
//   read it for the peaks. The injected power and the powers of each phase
//   are plain sensors, so they are never taken for it;
// - units: only the ones the core lists for the category
//   (DEVICE_FEATURE_UNITS_BY_CATEGORY): W, V, A, kWh for energy-sensor, m³
//   for volume-sensor, none for unknown (the unit is then in the name).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { EXTERNAL_ID_TYPE, PLATFORM_ID, POWER_MAX, PRICE_MAX } from './constants.js';
import { NO_CAPABILITIES } from './p1monitor/model.js';

/** Feature keys (forever). */
export const FEATURE = {
  POWER: 'power',
  INJECTION_POWER: 'injection_power',
  CONSUMPTION_INDEX: 'consumption_index',
  CONSUMPTION_LOW: 'consumption_low',
  CONSUMPTION_HIGH: 'consumption_high',
  INJECTION_INDEX: 'injection_index',
  INJECTION_LOW: 'injection_low',
  INJECTION_HIGH: 'injection_high',
  TARIFF: 'tariff',
  GAS: 'gas',
  WATER: 'water',
  PRICE_CONSUMPTION_LOW: 'price_consumption_low',
  PRICE_CONSUMPTION_HIGH: 'price_consumption_high',
  PRICE_INJECTION_LOW: 'price_injection_low',
  PRICE_INJECTION_HIGH: 'price_injection_high',
  PRICE_GAS: 'price_gas',
  phasePower: (n) => `power_l${n}`,
  phaseInjection: (n) => `injection_power_l${n}`,
  phaseVoltage: (n) => `voltage_l${n}`,
  phaseCurrent: (n) => `current_l${n}`,
};

/** The external ids of the one device of the integration. */
export const ids = (gladys) => gladys.externalIds(EXTERNAL_ID_TYPE, PLATFORM_ID);

const feature = (external, key, name, category, type, extra = {}) => ({
  name,
  external_id: external.feature(key),
  category,
  type,
  min: 0,
  max: 1_000_000_000,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});

/** A value shown, never summed nor billed: no energy category, no unit (it is in the name). */
const plain = (external, key, name, extra = {}) =>
  feature(external, key, name, C.UNKNOWN, T.SENSOR.DECIMAL, extra);

/** A price set in P1 Monitor: shown, never used by the Gladys energy contracts. */
const price = (external, key, name) =>
  plain(external, key, name, { min: -PRICE_MAX, max: PRICE_MAX });

/**
 * The device, with the features its capabilities show (src/p1monitor/model.js
 * capabilitiesOf). The features are fixed when the user creates it.
 */
export function buildDevice(gladys, capabilities, address) {
  const external = ids(gladys);
  const caps = { ...NO_CAPABILITIES, ...capabilities };
  const features = [];
  if (caps.power) {
    features.push(
      feature(
        external,
        FEATURE.POWER,
        'Power taken from the grid',
        C.ENERGY_SENSOR,
        T.ENERGY_SENSOR.POWER,
        {
          unit: U.WATT,
          max: POWER_MAX,
        },
      ),
    );
  }
  if (caps.consumption) {
    features.push(
      feature(
        external,
        FEATURE.CONSUMPTION_INDEX,
        'Consumption index',
        C.ENERGY_SENSOR,
        T.ENERGY_SENSOR.INDEX,
        { unit: U.KILOWATT_HOUR },
      ),
      plain(external, FEATURE.CONSUMPTION_LOW, 'Consumption index, low tariff (kWh)'),
      plain(external, FEATURE.CONSUMPTION_HIGH, 'Consumption index, high tariff (kWh)'),
    );
  }
  if (caps.injection) {
    features.push(
      plain(external, FEATURE.INJECTION_POWER, 'Power injected into the grid (W)', {
        max: POWER_MAX,
      }),
      plain(external, FEATURE.INJECTION_INDEX, 'Injection index (kWh)'),
      plain(external, FEATURE.INJECTION_LOW, 'Injection index, low tariff (kWh)'),
      plain(external, FEATURE.INJECTION_HIGH, 'Injection index, high tariff (kWh)'),
    );
  }
  if (caps.tariff) {
    features.push(
      feature(
        external,
        FEATURE.TARIFF,
        'Current tariff (1 = low, 2 = high)',
        C.UNKNOWN,
        T.SENSOR.INTEGER,
        { min: 1, max: 2 },
      ),
    );
  }
  for (let n = 1; n <= Math.min(3, caps.phases); n += 1) {
    // A value every 10 s: no history unless the user turns it on.
    features.push(
      plain(external, FEATURE.phasePower(n), `Power taken L${n} (W)`, {
        max: POWER_MAX,
        keep_history: false,
      }),
    );
    if (caps.injection) {
      features.push(
        plain(external, FEATURE.phaseInjection(n), `Power injected L${n} (W)`, {
          max: POWER_MAX,
          keep_history: false,
        }),
      );
    }
    features.push(
      feature(
        external,
        FEATURE.phaseVoltage(n),
        `Voltage L${n}`,
        C.ENERGY_SENSOR,
        T.ENERGY_SENSOR.VOLTAGE,
        { unit: U.VOLT, max: 500, keep_history: false },
      ),
      feature(
        external,
        FEATURE.phaseCurrent(n),
        `Current L${n}`,
        C.ENERGY_SENSOR,
        T.ENERGY_SENSOR.CURRENT,
        { unit: U.AMPERE, max: 1000, keep_history: false },
      ),
    );
  }
  if (caps.gas) {
    features.push(
      feature(external, FEATURE.GAS, 'Gas index', C.VOLUME_SENSOR, T.VOLUME_SENSOR.DECIMAL, {
        unit: U.CUBIC_METER,
      }),
    );
  }
  if (caps.water) {
    features.push(
      feature(external, FEATURE.WATER, 'Water index', C.VOLUME_SENSOR, T.VOLUME_SENSOR.DECIMAL, {
        unit: U.CUBIC_METER,
      }),
    );
  }
  if (caps.prices) {
    features.push(
      price(external, FEATURE.PRICE_CONSUMPTION_LOW, 'Electricity price, low tariff (€/kWh)'),
      price(external, FEATURE.PRICE_CONSUMPTION_HIGH, 'Electricity price, high tariff (€/kWh)'),
    );
    if (caps.injection) {
      features.push(
        price(external, FEATURE.PRICE_INJECTION_LOW, 'Injection price, low tariff (€/kWh)'),
        price(external, FEATURE.PRICE_INJECTION_HIGH, 'Injection price, high tariff (€/kWh)'),
      );
    }
  }
  if (caps.gasPrice && caps.gas) {
    features.push(price(external, FEATURE.PRICE_GAS, 'Gas price (€/m³)'));
  }
  return {
    name: 'P1 Monitor',
    external_id: external.device,
    features,
    params: [{ name: 'address', value: address }],
  };
}

/**
 * The capabilities a CREATED device carries (its features): the device
 * published again never has fewer features than the one the user created
 * (a missing one would read as a change, and "Update" would drop its history).
 */
export function capabilitiesOfDevice(device) {
  const keys = new Set(
    (device?.features ?? []).map((f) => String(f.external_id).split(':').at(-1)),
  );
  if (keys.size === 0) {
    return undefined;
  }
  let phases = 0;
  for (const n of [1, 2, 3]) {
    if (
      [
        FEATURE.phasePower(n),
        FEATURE.phaseInjection(n),
        FEATURE.phaseVoltage(n),
        FEATURE.phaseCurrent(n),
      ].some((k) => keys.has(k))
    ) {
      phases = n;
    }
  }
  return {
    power: keys.has(FEATURE.POWER),
    consumption: [
      FEATURE.CONSUMPTION_INDEX,
      FEATURE.CONSUMPTION_LOW,
      FEATURE.CONSUMPTION_HIGH,
    ].some((k) => keys.has(k)),
    injection: [FEATURE.INJECTION_POWER, FEATURE.INJECTION_INDEX, FEATURE.PRICE_INJECTION_LOW].some(
      (k) => keys.has(k),
    ),
    tariff: keys.has(FEATURE.TARIFF),
    gas: keys.has(FEATURE.GAS),
    water: keys.has(FEATURE.WATER),
    phases,
    prices: keys.has(FEATURE.PRICE_CONSUMPTION_LOW) || keys.has(FEATURE.PRICE_CONSUMPTION_HIGH),
    gasPrice: keys.has(FEATURE.PRICE_GAS),
  };
}

export const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const state = (external, key, value, digits) =>
  isNumber(value)
    ? [{ device_feature_external_id: external.feature(key), state: round(value, digits) }]
    : [];

/** A counter: never 0 (nor below), whatever the page said. */
const counterState = (external, key, value) =>
  isNumber(value) && value > 0 ? state(external, key, value, 3) : [];

/** The live values, read every 10 s: the powers and the phases. */
export function liveStates(external, meter, phases = []) {
  return [
    ...state(external, FEATURE.POWER, meter.power, 0),
    ...state(external, FEATURE.INJECTION_POWER, meter.injectionPower, 0),
    ...phases.flatMap((phase, i) => [
      ...state(external, FEATURE.phasePower(i + 1), phase.powerConsumed, 0),
      ...state(external, FEATURE.phaseInjection(i + 1), phase.powerProduced, 0),
      ...state(external, FEATURE.phaseVoltage(i + 1), phase.voltage, 1),
      ...state(external, FEATURE.phaseCurrent(i + 1), phase.current, 2),
    ]),
  ];
}

/**
 * The indexes, the tariff, water and the prices, published once a minute.
 * `consumptionIndex` is the value the IndexGuard let through (undefined: not
 * published this time). Every other index is a plain or volume sensor, never
 * published at 0.
 */
export function indexStates(external, { meter, water, prices }, consumptionIndex) {
  return [
    ...counterState(external, FEATURE.CONSUMPTION_INDEX, consumptionIndex),
    ...counterState(external, FEATURE.CONSUMPTION_LOW, meter.consumption.low),
    ...counterState(external, FEATURE.CONSUMPTION_HIGH, meter.consumption.high),
    ...counterState(external, FEATURE.INJECTION_INDEX, meter.injection.total),
    ...counterState(external, FEATURE.INJECTION_LOW, meter.injection.low),
    ...counterState(external, FEATURE.INJECTION_HIGH, meter.injection.high),
    ...state(external, FEATURE.TARIFF, meter.tariff, 0),
    ...counterState(external, FEATURE.GAS, meter.gas),
    ...counterState(external, FEATURE.WATER, water?.total),
    ...state(external, FEATURE.PRICE_CONSUMPTION_LOW, prices?.consumptionLow, 5),
    ...state(external, FEATURE.PRICE_CONSUMPTION_HIGH, prices?.consumptionHigh, 5),
    ...state(external, FEATURE.PRICE_INJECTION_LOW, prices?.injectionLow, 5),
    ...state(external, FEATURE.PRICE_INJECTION_HIGH, prices?.injectionHigh, 5),
    ...state(external, FEATURE.PRICE_GAS, prices?.gas, 5),
  ];
}

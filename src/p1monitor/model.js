// -----------------------------------------------------------------------------
// The answers of the P1 Monitor API, read into plain snapshots. Pure.
//
// The pages and the meaning of their fields are ported from the p1monitor
// library (klaasnicolaas/python-p1monitor, MIT, see THIRD_PARTY_NOTICES.md):
//
//   /api/v1/smartmeter      [{ CONSUMPTION_W, PRODUCTION_W,
//                              CONSUMPTION_KWH_LOW, CONSUMPTION_KWH_HIGH,
//                              PRODUCTION_KWH_LOW, PRODUCTION_KWH_HIGH,
//                              CONSUMPTION_GAS_M3, TARIFCODE, TIMESTAMP_UTC }]
//   /api/v1/status          [{ STATUS_ID, STATUS }], STATUS a string;
//                           74..76 power consumed L1..L3 (kW), 77..79 power
//                           produced (kW), 100..102 current (A), 103..105
//                           voltage (V)
//   /api/v1/configuration   [{ CONFIGURATION_ID, PARAMETER }], PARAMETER a
//                           string; 1 / 2 consumption price low / high,
//                           3 / 4 injection price low / high, 15 gas price
//   /api/v2/watermeter/day  [{ WATERMETER_CONSUMPTION_TOTAL_M3, ... }], [] or
//                           a 404 without a water meter
//
// Stricter than the library: a missing or non-numeric value is undefined
// (never 0), an index is a sum only when both of its tariffs are there, and
// a tariff code other than P (peak, high) or D (dal, low) is unknown (the
// library takes anything else for low).
// -----------------------------------------------------------------------------

import { CONFIGURATION_ID, PRICE_MAX, STATUS_ID } from '../constants.js';

/** A number, or a numeric string ("0.863"): anything else (null, '', true) is undefined. */
export function num(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

/** A counter: a number at or above 0, else undefined. */
const counter = (value) => {
  const n = num(value);
  return n !== undefined && n >= 0 ? n : undefined;
};

/** The sum of two tariffs, only when both are there and it is above 0. */
const sum = (low, high) =>
  low !== undefined && high !== undefined && low + high > 0 ? low + high : undefined;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** TARIFCODE: P (piek, peak) is the high tariff, 2; D (dal) the low one, 1. */
export function tariffOf(code) {
  const text = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (text === 'P') return 2;
  if (text === 'D') return 1;
  return undefined;
}

/**
 * /api/v1/smartmeter (limit 1): the last reading of the meter. Undefined when
 * the answer is not the one of a P1 Monitor; `empty` for an empty list (no
 * reading yet).
 */
export function parseSmartmeter(data) {
  if (Array.isArray(data) && data.length === 0) {
    return { empty: true };
  }
  const row = Array.isArray(data) ? data[0] : undefined;
  if (!isObject(row)) {
    return undefined;
  }
  const known = [
    'CONSUMPTION_W',
    'CONSUMPTION_KWH_LOW',
    'CONSUMPTION_KWH_HIGH',
    'PRODUCTION_W',
  ].some((key) => num(row[key]) !== undefined);
  if (!known) {
    return undefined;
  }
  const consumption = {
    low: counter(row.CONSUMPTION_KWH_LOW),
    high: counter(row.CONSUMPTION_KWH_HIGH),
  };
  consumption.total = sum(consumption.low, consumption.high);
  const injection = {
    low: counter(row.PRODUCTION_KWH_LOW),
    high: counter(row.PRODUCTION_KWH_HIGH),
  };
  injection.total = sum(injection.low, injection.high);
  const gas = counter(row.CONSUMPTION_GAS_M3);
  return {
    timestamp: num(row.TIMESTAMP_UTC),
    power: counter(row.CONSUMPTION_W),
    injectionPower: counter(row.PRODUCTION_W),
    consumption,
    injection,
    tariff: tariffOf(row.TARIFCODE),
    gas: gas > 0 ? gas : undefined,
  };
}

/** The values of a list `[{ <idKey>: id, <valueKey>: value }]`, by id. */
function byId(data, idKey, valueKey) {
  const values = new Map();
  for (const item of data) {
    if (isObject(item) && Number.isInteger(item[idKey])) {
      const value = num(item[valueKey]);
      if (value !== undefined) {
        values.set(item[idKey], value);
      }
    }
  }
  return values;
}

const watts = (kw) => (kw === undefined ? undefined : Math.round(kw * 1000));

/**
 * /api/v1/status: the phases. Only the phases that show something (a value
 * above 0) up to the last one: a single-phase meter gives L1 only. Undefined
 * when the answer has none of the phase ids.
 */
export function parsePhases(data) {
  if (!Array.isArray(data)) {
    return undefined;
  }
  const values = byId(data, 'STATUS_ID', 'STATUS');
  const ids = Object.values(STATUS_ID).flat();
  if (!ids.some((id) => values.has(id))) {
    return undefined;
  }
  const phases = [0, 1, 2].map((i) => {
    const get = (key) => {
      const value = values.get(STATUS_ID[key][i]);
      return value !== undefined && value >= 0 ? value : undefined;
    };
    return {
      powerConsumed: watts(get('powerConsumed')),
      powerProduced: watts(get('powerProduced')),
      current: get('current'),
      voltage: get('voltage'),
    };
  });
  const shows = (phase) => Object.values(phase).some((v) => v !== undefined && v > 0);
  let count = 0;
  phases.forEach((phase, i) => {
    if (shows(phase)) count = i + 1;
  });
  return { phases: phases.slice(0, count) };
}

/** /api/v1/configuration: the prices set in P1 Monitor (euro). Undefined without any. */
export function parsePrices(data) {
  if (!Array.isArray(data)) {
    return undefined;
  }
  const values = byId(data, 'CONFIGURATION_ID', 'PARAMETER');
  const prices = {};
  for (const [key, id] of Object.entries(CONFIGURATION_ID)) {
    const value = values.get(id);
    if (value !== undefined && Math.abs(value) <= PRICE_MAX) {
      prices[key] = value;
    }
  }
  return Object.keys(prices).length > 0 ? prices : undefined;
}

/**
 * /api/v2/watermeter/day (limit 1): the total of the water meter (m³), never
 * the litres of the day. `{ none: true }` for an empty list; undefined when
 * the answer is not the expected one.
 */
export function parseWater(data) {
  if (Array.isArray(data) && data.length === 0) {
    return { none: true };
  }
  const row = Array.isArray(data) ? data[0] : undefined;
  if (!isObject(row) || !('WATERMETER_CONSUMPTION_TOTAL_M3' in row)) {
    return undefined;
  }
  const total = counter(row.WATERMETER_CONSUMPTION_TOTAL_M3);
  return { total: total > 0 ? total : undefined };
}

// --- Capabilities ---------------------------------------------------------------------

export const NO_CAPABILITIES = Object.freeze({
  power: false,
  consumption: false,
  injection: false,
  tariff: false,
  gas: false,
  water: false,
  phases: 0,
  prices: false,
  gasPrice: false,
});

/**
 * What a read shows: `{ meter, phases?, prices?, water? }`. The injection
 * only once it holds something (a home without solar panels reads 0 there);
 * gas and water once above 0.
 */
export function capabilitiesOf({ meter, phases, prices, water } = {}) {
  return {
    power: meter?.power !== undefined,
    consumption: meter?.consumption?.low !== undefined && meter?.consumption?.high !== undefined,
    injection: Boolean(meter?.injection?.total > 0 || meter?.injectionPower > 0),
    tariff: meter?.tariff !== undefined,
    gas: meter?.gas !== undefined,
    water: water?.total !== undefined,
    phases: phases?.phases?.length ?? 0,
    prices: prices?.consumptionLow !== undefined || prices?.consumptionHigh !== undefined,
    gasPrice: prices?.gas !== undefined,
  };
}

/** Capabilities only grow: a value missing for a while never removes a feature. */
export function mergeCapabilities(a, b) {
  if (!a) return b ? { ...NO_CAPABILITIES, ...b } : undefined;
  if (!b) return { ...NO_CAPABILITIES, ...a };
  const merged = { ...NO_CAPABILITIES };
  for (const key of Object.keys(NO_CAPABILITIES)) {
    merged[key] =
      key === 'phases' ? Math.max(a.phases ?? 0, b.phases ?? 0) : Boolean(a[key] || b[key]);
  }
  return merged;
}

/** Whether `target` shows something `current` does not. */
export function bringsNew(current, target) {
  if (!current) return Boolean(target);
  return Object.keys(NO_CAPABILITIES).some((key) =>
    key === 'phases'
      ? (target.phases ?? 0) > (current.phases ?? 0)
      : Boolean(target[key]) && !current[key],
  );
}

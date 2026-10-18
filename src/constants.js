// -----------------------------------------------------------------------------
// Constants shared by the integration. Every key stored by Gladys (actions,
// manifest keys, feature keys in src/devices.js) is forever: never rename one.
// -----------------------------------------------------------------------------

export const ACTIONS = { TEST: 'test_connection' };

/** The type part of the external ids: `p1monitor:host-<address>`. */
export const EXTERNAL_ID_TYPE = 'p1monitor';

// --- The local REST API of P1 Monitor (as the p1monitor library reads it) --------
export const PATHS = {
  /** The last reading of the smart meter: power, indexes, tariff, gas. */
  SMARTMETER: '/api/v1/smartmeter',
  /** The status list: voltage, current and power of each phase. */
  STATUS: '/api/v1/status',
  /** The configuration list: the prices set in P1 Monitor. */
  CONFIGURATION: '/api/v1/configuration',
  /** The water meter, by day: the total of the last day. */
  WATERMETER: '/api/v2/watermeter/day',
};

/** The query of each page, as the p1monitor library sends it. */
export const QUERIES = {
  [PATHS.SMARTMETER]: { json: 'object', limit: '1' },
  [PATHS.STATUS]: { json: 'object' },
  [PATHS.CONFIGURATION]: { json: 'object' },
  [PATHS.WATERMETER]: { json: 'object', limit: '1' },
};

/** The ids of the status list (p1monitor `Phases`): kW for the powers. */
export const STATUS_ID = {
  powerConsumed: [74, 75, 76],
  powerProduced: [77, 78, 79],
  current: [100, 101, 102],
  voltage: [103, 104, 105],
};

/** The ids of the configuration list (p1monitor `Settings`): euro per kWh or m³. */
export const CONFIGURATION_ID = {
  consumptionLow: 1,
  consumptionHigh: 2,
  injectionLow: 3,
  injectionHigh: 4,
  gas: 15,
};

export const HTTP_TIMEOUT = 10_000;
/** The status and configuration lists are a few tens of KiB: more is not P1 Monitor. */
export const MAX_BODY_BYTES = 512 * 1024;

// --- Schedule ------------------------------------------------------------------------
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/** The live values (power, phases): one read every 10 s. */
export const POWER_INTERVAL = 10 * SECOND;
/** The indexes (electricity, gas, water) and the tariff: published once a minute. */
export const INDEX_INTERVAL = 60 * SECOND;
/** The water meter page: read every 5 minutes. */
export const WATER_INTERVAL = 5 * MINUTE;
/** The prices set in P1 Monitor: read every 15 minutes. */
export const PRICES_INTERVAL = 15 * MINUTE;
/** A water meter page saying "none" (404, empty): asked again after this delay. */
export const NO_WATER_RETRY = HOUR;
/** A secondary page failing: tried again after this delay (never blocking the rest). */
export const SECONDARY_RETRY = 5 * MINUTE;
/** An unreachable P1 Monitor: tries after 10 s, then doubled up to 5 minutes. */
export const RETRY_MIN = 10 * SECOND;
export const RETRY_MAX = 5 * MINUTE;
/** Unchanged values are sent again after this delay (publishChangedStates heartbeat). */
export const STATE_HEARTBEAT = 10 * MINUTE;
/** The test button answers within this delay. */
export const TEST_ANSWER_WITHIN = 25 * SECOND;
/**
 * The reading of the meter has not changed (same TIMESTAMP_UTC) for this long:
 * the power and the phases are stale (P1 cable out, P1 Monitor stopped
 * reading), they are no longer published. Measured on our clock only.
 */
export const READING_STALE_AFTER = 5 * MINUTE;

// --- Plausibility of the electricity index (the one Gladys bills) --------------------
/** A home never draws more than this on average between two reads. */
export const INDEX_MAX_KW = 100;
/** kWh always accepted on top of INDEX_MAX_KW × hours (rounding, a late read). */
export const INDEX_SLACK_KWH = 0.5;
/**
 * A drop is taken only once lower values (never 0, never decreasing) have
 * been read for this long. A jump up is never taken without the user.
 */
export const INDEX_DROP_CONFIRM = 60 * MINUTE;

/** A price set in P1 Monitor outside this range (euro) is not shown. */
export const PRICE_MAX = 100;

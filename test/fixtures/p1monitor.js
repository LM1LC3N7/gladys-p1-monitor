// -----------------------------------------------------------------------------
// Answers of a P1 Monitor, shaped after the test fixtures of the p1monitor
// library (MIT, see THIRD_PARTY_NOTICES.md). Synthetic: no real device.
// -----------------------------------------------------------------------------

export const ADDRESS = '192.168.1.40';
export const NOW = Date.parse('2026-10-18T10:00:00Z');

export const SMARTMETER = [
  {
    CONSUMPTION_GAS_M3: 2289.967,
    CONSUMPTION_KWH_HIGH: 2996.141,
    CONSUMPTION_KWH_LOW: 5436.256,
    CONSUMPTION_W: 935,
    PRODUCTION_KWH_HIGH: 4408.947,
    PRODUCTION_KWH_LOW: 1575.502,
    PRODUCTION_W: 0,
    RECORD_IS_PROCESSED: 0,
    TARIFCODE: 'D',
    TIMESTAMP_UTC: 1633130812,
    TIMESTAMP_lOCAL: '2021-10-02 01:26:52',
  },
];

/** The smart meter reading with some fields changed, a new timestamp by default. */
export const meterWith = (fields, stamp = 1) => [
  { ...SMARTMETER[0], TIMESTAMP_UTC: SMARTMETER[0].TIMESTAMP_UTC + stamp, ...fields },
];

const status = (id, value, label) => ({ LABEL: label, SECURITY: 0, STATUS: value, STATUS_ID: id });

export const STATUS = [
  status(1, '2026-10-18 12:00:00', 'Tijdstip'),
  status(74, '0.863', 'Huidige KW verbruik L1 (21.7.0)'),
  status(75, '0.0', 'Huidige KW verbruik L2 (41.7.0)'),
  status(76, '0.0', 'Huidige KW verbruik L3 (61.7.0)'),
  status(77, '0.0', 'Huidige KW levering L1 (22.7.0)'),
  status(78, '0.0', 'Huidige KW levering L2 (42.7.0)'),
  status(79, '0.0', 'Huidige KW levering L3 (62.7.0)'),
  status(100, '4.0', 'Huidige Amperage L1 (31.7.0)'),
  status(101, '0.0', 'Huidige Amperage L2 (51.7.0)'),
  status(102, '0.0', 'Huidige Amperage L2 (71.7.0)'),
  status(103, '229.0', 'Huidige Voltage L1 (32.7.0)'),
  status(104, '0.0', 'Huidige Voltage L2 (52.7.0)'),
  status(105, '0.0', 'Huidige Voltage L2 (72.7.0)'),
];

/** A three-phase meter, injecting on L2. */
export const STATUS_3P = STATUS.map((item) => {
  const values = {
    74: '0.863',
    75: '0.0',
    76: '0.412',
    77: '0.0',
    78: '1.250',
    79: '0.0',
    100: '4.0',
    101: '5.0',
    102: '2.0',
    103: '229.0',
    104: '231.5',
    105: '230.1',
  };
  return item.STATUS_ID in values ? { ...item, STATUS: values[item.STATUS_ID] } : item;
});

export const CONFIGURATION = [
  {
    CONFIGURATION_ID: 1,
    LABEL: 'Verbruik tarief elektriciteit dal/nacht in euro.',
    PARAMETER: '0.22311',
  },
  {
    CONFIGURATION_ID: 2,
    LABEL: 'Verbruik tarief elektriciteit piek/dag in euro.',
    PARAMETER: '0.24388',
  },
  {
    CONFIGURATION_ID: 3,
    LABEL: 'Geleverd tarief elektriciteit dal/nacht in euro.',
    PARAMETER: '0.22311',
  },
  {
    CONFIGURATION_ID: 4,
    LABEL: 'Geleverd tarief elektriciteit piek/dag in euro.',
    PARAMETER: '0.24388',
  },
  { CONFIGURATION_ID: 15, LABEL: 'Verbruik tarief gas in euro.', PARAMETER: '0.86687' },
];

export const WATER = [
  {
    TIMEPERIOD_ID: 13,
    TIMESTAMP_UTC: 1644620400,
    TIMESTAMP_lOCAL: '2022-02-12 00:00:00',
    WATERMETER_CONSUMPTION_LITER: 128.0,
    WATERMETER_CONSUMPTION_TOTAL_M3: 1640.399,
    WATERMETER_PULS_COUNT: 128.0,
  },
];

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

export const html = (text = '<html><body>P1 Monitor</body></html>', status = 200) =>
  new Response(text, { status, headers: { 'content-type': 'text/html' } });

/** Every page of a P1 Monitor, each one replaceable. */
export const routes = (overrides = {}) => ({
  '/api/v1/smartmeter': () => json(SMARTMETER),
  '/api/v1/status': () => json(STATUS),
  '/api/v1/configuration': () => json(CONFIGURATION),
  '/api/v2/watermeter/day': () => json(WATER),
  ...overrides,
});

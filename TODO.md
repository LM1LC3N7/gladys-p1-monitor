# TODO

## Before announcing

- [ ] Test on a real Gladys 5.2+ with a real P1 Monitor (ideally a Belgian
      and a Dutch meter, with gas, solar injection, three phases and a water
      meter): test button, device creation, the consumption and cost the
      core derives from the index, the sensors.
- [ ] Test the Docker image (no Docker on the development PC yet).
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store
      (after the first release: the store validator needs the GHCR image).

## To confirm on a real P1 Monitor (built without one)

- [ ] The pages and their `json=object` answers as the p1monitor library
      reads them (its fixtures date from 2021-2022): field names, numbers
      as numbers in the smart meter page, strings in the status and
      configuration lists.
- [ ] `limit=1` gives the LAST reading (newest first), as the library
      assumes.
- [ ] `TARIFCODE`: `P` / `D` only? A Belgian meter: does P1 Monitor still call
      tariff 1 (day in Belgium) `LOW`? The docs ask the user to check.
- [ ] The status ids 74 to 79, 100 to 105 on a recent P1 Monitor; whether a
      meter that does not give the current per phase leaves it at 0.
- [ ] `TIMESTAMP_UTC` changes on every new reading (the frozen reading
      detection relies on it; 5 minutes without change stops the power).
- [ ] The water meter page: 404 or `[]` without a meter (both handled), and
      `WATERMETER_CONSUMPTION_TOTAL_M3` as the cumulative total of the meter.
- [ ] Whether the API answers on a P1 Monitor with HTTPS turned on (plain
      HTTP only here) and whether some installs protect the API.
- [ ] The core's consumption from the index: one `energy-sensor` / `index`
      feature published every minute, the derived features attached to the
      main electric meter.

## Decisions

- **Versions**: 0.1.0 set once by hand when leaving the template (package,
  lock file, manifest, image tag), as for the sibling integrations; the
  Release workflow owns them from now on (the first patch release gives
  0.1.1).
- **Reused project**: p1monitor (klaasnicolaas/python-p1monitor, MIT, by
  Klaas Schoute, 3.2.0, tag `v3.2.0`, commit 552650f), cloned read-only in
  `_ref/p1monitor`, ported to JavaScript: the pages, their query and the
  meaning of their fields (`THIRD_PARTY_NOTICES.md`, README, docs). The SDK
  stays the only runtime dependency. The guard, the store and the address
  parser come from gladys-youless (same project, same rules).
- **Stricter than the library**: a missing or non-numeric value is never 0;
  `TARIFCODE` other than `P` / `D` is unknown (the library takes it for low);
  an index is the sum of its two tariffs only when both are there and above
  0 (one tariff missing would read as a drop, then as a jump).
- **External id**: `p1monitor:host-<address>`: the API gives no serial
  number the library reads. The docs ask for a fixed address.
- **One device per integration**: most homes have one meter.
- **Distinct modules**: not DSMR Reader (GBoulvin), YouLess nor HomeWizard;
  said in the manifest, the README and both docs (two of them on one meter
  would count the consumption twice). `test/manifest.test.js` checks it.
- **Energy (lessons of waves 2 and 3, lot 6)**: `consumption_index` is the
  only `energy-sensor` / `index` feature: low + high, two cumulative
  counters, never a daily total, never the injection. The tariff indexes are
  plain sensors (as indexes they would be counted three times). The
  injection (power, indexes, per phase) is plain sensors (`unknown` /
  `decimal`, unit in the name), never `energy-production-sensor` nor
  `grid-sensor`. No `daily-consumption`, no `publishEnergyConsumption`
  (tested: nothing reaches `/energy/consumption`).
- **Gas and water**: `volume-sensor` / `decimal` in m³, never in the energy
  monitoring. Water is the meter total (`WATERMETER_CONSUMPTION_TOTAL_M3`),
  never the litres of the day. Neither passes the index guard (not billed),
  but neither is ever published at 0.
- **Power**: `power` (taken from the grid, `CONSUMPTION_W`, 0 to 100 kW) is
  the only `energy-sensor` / `power` feature (the energy contracts read it
  for the peaks); the injected power is a plain sensor, never a negative
  `power`. Voltage and current per phase are `energy-sensor` voltage /
  current; the powers per phase are plain sensors (kW × 1000). The phase
  features have `keep_history: false`.
- **Phases**: only the phases that show a value above 0 (up to the last
  one): a single-phase meter gives L1 only.
- **Tariff**: published as 1 (low, `D`) or 2 (high, `P`), feature named
  "1 = low, 2 = high".
- **Prices** ("tarifs du jour"): the five prices set in P1 Monitor
  (configuration ids 1 to 4, 15), plain sensors in €/kWh or €/m³, read every
  15 minutes, between -100 and 100 €; injection prices only with the
  injection, the gas price only with gas. A price may be 0 (published). Never
  used by Gladys to price anything: the cost comes from the Gladys energy
  contracts.
- **Injection present**: only once its index or its power is above 0 (a home
  without solar panels reads 0 there).
- **Capabilities**: the reads plus the features of the created device
  (`gladys.devices`), only growing; the states are filtered on the features
  of the created device.
- **Index plausibility** (`src/guard.js`, identical to gladys-youless): never
  0; a drop taken after 60 min of non-zero, non-decreasing values; a jump
  over 100 kW on average (+ 0.5 kWh) never confirmed by repetition nor by
  time, kept in `/data/p1-monitor-state.json`, accepted only by a save of the
  configuration (`start(…, { fresh: true })`), the difference counted once;
  a reconnection never accepts it; the guard starts again at
  `onDeviceCreated`. While held, the last accepted value is sent again.
- **Frozen reading**: P1 Monitor keeps serving its last reading when the P1
  cable is out. The `TIMESTAMP_UTC` unchanged for 5 minutes (measured on our
  clock, so no clock skew) stops the power and the phases, with a status
  note; the indexes are still published (unchanged, so no delta).
- **Secondary pages**: status (each read), configuration (15 min), water
  (5 min; 1 h after a 404 or `[]`); a failure is logged once, shown in the
  status, tried again after 5 minutes; the phases are dropped while their
  page fails (live values), the last prices and water total are kept.
- **Pace**: one timer every 10 s; the indexes, tariff, gas, water and prices
  published when 60 s have passed; `publishChangedStates` with a 10-minute
  heartbeat. At most about 100 states a minute with three phases and
  injection (only changed values are sent), far below the 300 a minute of Gladys.
- **Republication**: every start (each `connected`) calls
  `forgetPublishedStates()`, clears the status cache, publishes the
  discovered device, the values and the status again.
- **Errors**: unreachable → 10 s, doubled up to 5 min; a reconnection keeps
  the delay, a save of the form or a good test ends it. A read never overlaps
  another (10 s timeout per request). Logs hold our own codes only: no URL,
  no text of the device.
- **Hostile answers**: bodies read up to 512 KiB (the status and
  configuration lists are a few tens of KiB), no redirect followed
  (`redirect: 'manual'`).
- **No password, no HTTPS**: the library sends none; P1 Monitor's local API is
  open on the LAN (to confirm).
- **Gladys version**: `>=5.2.0`, like the other energy integrations.
- **Not read in v0.1**: the dynamic tariffs, the history pages, the peak
  power of the Belgian capacity tariff, the litres of water of the day.

## Ideas

- The Belgian capacity tariff peak (quarter-hour peak) if P1 Monitor exposes
  it.
- The dynamic tariffs of P1 Monitor.
- The injection as `grid-sensor` / `output-index` once every supported
  Gladys knows the category.

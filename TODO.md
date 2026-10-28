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

- **SDK `^0.16.0`** (2026-10-27, migration wave 4): 0.16.0 is on npm since
  2026-10-25 (a stale npm cache said otherwise); it adds the ai, tts and music
  types; no effect here (`poll_frequency` unused). `keywords`, `countries`
  and `gladys_version >= 5.3.0` wait until Gladys 5.3 is widespread.
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
  an index is the sum of its two tariffs only when both are there (one
  tariff missing would read as a drop), see the index plausibility below.
- **External id** (review I5): `p1monitor:meter`, one device per integration;
  the address is only a param. The API gives no serial number the library
  reads, and an address changes with the router: a new address of the same
  P1 Monitor keeps the device and its history; another meter at the new
  address is held by the guard (drop or jump) until a save.
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
- **Index plausibility** (review B1, `src/guard.js`): the core skips a
  negative delta but counts every rise in full, so a drop TAKEN then a rise
  back bills the whole difference (9,194 → 10 → 9,194 = 9,184 fictive kWh).
  Hence:
  - (a) `indexOfTariffs`: both tariffs present, finite, at or above 0, the
    sum finite and above 0. Against the tariffs of the last index accepted
    (kept in /data with the guard): both tariffs lower is checked FIRST and
    is a real drop, for the guard (round 2, m1: even when one of them reads
    0); otherwise a tariff that was above 0 and reads 0, or a tariff lower
    while the other is not, gives no index for that reading (one register
    glitching is not a drop). A tariff at 0 is accepted when it already was
    0, or with no reference yet: a single-tariff meter (Belgian
    mono-horaire) keeps its second register at 0 and must still get an index
    (deliberately softer than "each tariff above 0" asked by the review,
    which would give such a meter no index at all). The tariff reference is
    never cleared by a save (round 2, m1); a register stuck in a state that
    gives no index (a new meter with a register staying at 0) has one way
    out, documented: delete the device and create it again (`onDeviceCreated`
    clears the guard, the tariffs and the /data entry). Tested;
  - (b) never 0; the model's `sum` (`src/p1monitor/model.js`) also requires
    `Number.isFinite(low + high)` (approval, n3);
  - (c) a value plausible after the reference (not lower, at most 100 kW on
    average + 0.5 kWh) goes through; a value EQUAL to the reference goes
    through without moving its date (review I1: a frozen reading never
    shrinks the margin of the next rise); at a restart, the same value in
    /data and in Gladys keeps the OLDEST date, otherwise the most recent
    reference wins;
  - (d) a drop and a jump up are held (`held = { direction, from, to,
threshold, at }`, `at` the time `to` was read), never confirmed by
    repetition nor by time; every value at or above a held jump stays held;
    the last accepted value is sent again; the status shows it, also in the
    "unreachable" status (round 2, R2); a value back to the usual rule ends
    the hold;
  - (e) only the `accept_held_index` action (round 2, R2) accepts, never a
    save of the configuration nor a reconnection. It accepts the value shown
    (`held.to` read at `held.at`) and answers with what will be counted (the
    jump in kWh, or 0 kWh for a drop). The acceptance is bounded (round 2,
    R1): a jump is taken only for `held.to ≤ v ≤ held.to + 100 kW × (at −
held.at) + 0.5 kWh`, a drop only for `v ≤ held.to + margin`; any other
    value is held again and the acceptance dropped. An acceptance is not
    kept in /data (a restart asks again). A value held read back from /data
    is dated at its loading (`held.at` = load time, approval n1), never its
    old date, which would widen the range an acceptance takes. A drop taken bills nothing
    (negative delta), the values rise from there; a jump taken is counted
    once;
  - (f) the guard starts again at `onDeviceCreated` (its /data entry
    removed, guard, tariffs and saved key reset after the save, review M2);
  - (g) the margin grows with the time since the last accepted value: after
    24 h of outage, up to 2,400 kWh pass at once (review M6, documented).
- **Powers** (review I2): above 100 kW (`POWER_MAX`), the power taken, the
  power injected and the powers per phase are undefined (a glitch).
- **Secondary pages and the meter** (round 2, m4): the outcome of a
  secondary page counts only when the meter answered; with the P1 Monitor
  down, a page failing is neither logged nor delayed, it is read again with
  the meter.
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
  the delay and sends the last failure again with the time left (review I3);
  a save of the form or a good test ends it. Unreachable at a start, the
  created device is still published in Discovery (review M1).
- **Reads and restarts** (review I4): a read checks, after each await, that
  the client and the generation are still its own, else gives up before
  discover, publish and status; a read of a previous start is let finish,
  then the new one runs.
- **Clocks** (review M3): the pacing (reads, retries, intervals, frozen
  reading) uses a monotonic clock. A pacing clock found behind the last
  index time is reset. The index guard runs on a session clock (2026-10-27,
  migration wave 4, as gladys-openems in lot 17): the wall clock read once
  at the start of the process plus the monotonic time since, so that NTP
  moving the wall clock by hours never widens nor narrows its margin. /data
  keeps wall dates (session date + the wall offset of the moment it is
  written), turned back into session dates when the guard loads; a date
  from /data or from Gladys ahead of the session clock is taken as now.
  /data is written again when the wall offset moves (to the minute, in the
  key of `saveGuard`), and the reference read from /data and unchanged
  since keeps its wall date there, never the bounded date of a life whose
  clock was wrong (review r1, I1). No wait after a restart: a local device
  read every 10 s. Tested: wall clock 10 h ahead, 10 min back, set by NTP
  before the guard loads (a /data date, a Gladys date, a held value loaded
  on a failure), a fresh monotonic clock at each life (a life started 10 h
  late, flat index, then +900 kWh held in the next life).
  Residuals (as gladys-openems, review r1 m1): a life that STARTS with the
  wall clock hours ahead takes a glitch up to 100 kW × the error as long as
  the index stays flat since its start, e.g. solar export (L3, review r2
  m-r2-1); a life started before NTP that takes a new value, then
  restarts less than a minute after NTP (before the next index check
  rewrites /data), leaves a late date (L2). Safe side: after a long stop of
  the monotonic clock (machine asleep) or a start without the time, a real
  rise may stay held until the user accepts it.
- **Accept in two clicks** (review r1, L6, rule of the fiche): the first
  click lists the value held (nothing accepted), the second, 3 s to 5 min
  later on the monotonic clock, accepts it only if the same guard still
  holds it (same direction and origin, the value listed plus at most the
  margin since the first click); otherwise "not accepted, changed". The
  acceptance stays bounded by `src/guard.js`. Memory only.
  Review r2: the margin of the second click and its window are tested with
  the wall clock moved by ±10 h between the clicks (N13, N14), a drop read
  lower than listed (N10), a new jump from another reference (N11). The
  direction check (N12) survives the suite: with the same origin, a held
  value of the other direction can never be at or above the value listed
  within the margin since the first click, so it is kept as a guard but no
  test can tell it apart.
- **Order** (review M5): the secondary pages are read in parallel with the
  meter, never after it. A read never overlaps
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

## Port to gladys-youless

gladys-youless (published) has the same guard and the same flaw: a drop
confirmed after 60 minutes then a rise back bills the whole difference. To
port, from this repository:

- **`src/guard.js`**: replace it by this one (`IndexGuard`, `margin`,
  `follows`, `acceptHeld`, `withinAccepted`):
  - no drop confirmation by time: remove the `drop` branch and
    `INDEX_DROP_CONFIRM` (`src/constants.js`); a drop is held like a jump;
  - `held = { direction: 'up' | 'down', from, to, threshold, at }` replaces
    `jump`; `accepted = { direction, to, at }` replaces `jumpAccepted`;
  - R1: an acceptance takes only `held.to ≤ v ≤ held.to + margin(held.at,
at)` for a jump, `v ≤ held.to + margin` for a drop; otherwise held again,
    acceptance dropped;
  - a value equal to the reference is accepted without moving `last.at`; at
    a restart, the same value in /data and Gladys keeps the oldest date;
  - **migration of /data** (`/data/youless-state.json` exists on installed
    devices): in the constructor, read the old `{ last, jump: { from, to,
threshold } }` as `held = { direction: 'up', from, to, threshold, at }`
    with `at` the time of loading (pass `now` to the constructor), never
    `last.at`: no date was kept for the jump, and an older date would widen
    the range an acceptance takes. Write the new shape at the next save.
    Test it with an old state.
- **`indexOfTariffs`**: copy it, and call it ONLY on the P1 path of the LS120
  (`/e` Enelogic with P1 values: `p1`, `p2`), never on `cnt` (LS110,
  PVOutput) nor on `net` (LS120 without P1). Keep `p1Known` and `p1Outage`
  as they are (a read without P1 once P1 was seen still gives no index).
  The tariffs `{ p1, p2 }` of the last index accepted are kept in /data with
  the guard (`saveGuard`), never cleared by a save; `onDeviceCreated` clears
  them.
- **R2, `accept_held_index` action**: manifest action (labels en/fr as
  here), `ACTIONS.ACCEPT_HELD` in `src/constants.js`, `gladys.onAction` in
  `index.js`, `acceptHeldIndex()` in `src/app.js` (builds the guard from
  Gladys and /data if needed, `acceptHeld()`, publishes at once, answers with
  the kWh counted). Remove the acceptance from `doStart` (`fresh`): a save of
  the form accepts nothing. The held note is added to the "unreachable"
  status too (`failureMessage`).
- **`src/app.js`**: `acceptJump` → `acceptHeld`, `guard.jump` →
  `guard.held` (messages, logs, `okMessage`), the tariffs in `saveGuard` and
  in the guard construction (`guardOf`).
- **`src/i18n.js`**: `notes.jump` → `notes.held` (drop and jump messages,
  "X kWh will be counted at once as consumption; accept only if this
  energy was really consumed", "Saving the configuration accepts nothing"),
  `accept.nothing / up / down` for the action, `unreachable(…, notes)`.
- **Docs fr/en, README, TODO, CHANGELOG**: remove "a drop is accepted after
  60 minutes" and "save the configuration to accept"; describe the action,
  its bounds, the way out of a stuck register (delete and create the device
  again), the margin after a long outage. A `### Fixed` entry in the
  CHANGELOG (fictive kWh after a confirmed drop then a rise).
- **Tests** (`test/model.test.js`, `test/app.test.js`, adapted to the
  YouLess fixtures): drop held a week then back (no fictive kWh); drop
  accepted by the action then a rise (0 then the rise only); an accepted
  drop never takes a jump; an acceptance bounded (1000 → 1005 accepted, then
  5000 held, nothing billed); frozen 3 h then +4 kWh accepted; same value
  keeps the oldest date at a restart; p2 at 0 for 90 minutes then back;
  both P1 tariffs lower is a drop; a save of the form accepts nothing; the
  held note in the unreachable status; the old /data state migrated; the
  manifest test lists both actions.
- **Additions of the approval**:
  1. the key of `saveGuard` (youless `src/app.js`, around line 440) is built
     from `held` (direction, from, threshold) and the tariffs, no longer
     from `jump`;
  2. the held note appears in EVERY not-connected status, not only
     "unreachable": also "password refused" (`T.auth`) and "password asked"
     (`T.protected`), and the downgrade message;
  3. `doStart`, when the address or the password changes, also resets the
     tariff reference (`tariffRef = undefined`, another device);
  4. n1 applies to ANY value held read back from /data (new shape and the
     migrated `{ jump }`): `held.at` = the load time, passed to the
     `IndexGuard` constructor;
  5. a migration test with an old state whose `last.at` is several days old:
     the jump stays held, an acceptance followed by a value far above the
     jump shown is held again (the old date never widens the range).
- Then the usual definition of done, and a patch release.

## Ideas

- The Belgian capacity tariff peak (quarter-hour peak) if P1 Monitor exposes
  it.
- The dynamic tariffs of P1 Monitor.
- The injection as `grid-sensor` / `output-index` once every supported
  Gladys knows the category.

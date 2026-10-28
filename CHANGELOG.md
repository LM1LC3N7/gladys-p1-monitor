# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Fixed

- An accepted drop is now the floor: a reading lower still is held (never
  counted without a new click), and the real value that follows is taken
  instead of being held as a jump.

## [0.1.4] - 2026-10-28

### Changed

- Integration SDK 0.16 (no change for the devices).
- "Accept the held index" takes two clicks: the first lists the value held
  and accepts nothing; the second, from 3 seconds to 5 minutes later,
  accepts exactly that value (with what the home may have used since), never
  a value beyond it read in between.

### Fixed

- The plausibility check of the consumption index no longer follows the wall
  clock while the integration runs: NTP moving the clock by hours neither
  widens nor narrows the margin of the next rise. It runs on the time elapsed
  since the start. The dates kept in /data are wall dates, written again
  when the clock is set, and a date from /data or Gladys ahead of the clock
  counts as now. Two rare cases remain, documented: a start with the clock
  hours ahead, and a restart within a minute of the clock being set.

## [0.1.3] - 2026-10-23

## [0.1.2] - 2026-10-18

### Fixed

- While a consumption index is held, a lower value that does not fit the short
  margin counted from the hold (an old reference) is held in its turn, its kWh
  shown, instead of being taken: nothing is billed without the user.
- The log of a held index names the "Accept the held index" button instead of
  a save of the configuration.

## [0.1.1] - 2026-10-18

### Added

- Local reading of P1 Monitor (ztatz) through its REST API, as the p1monitor
  library does: the smart meter reading, the phases, the prices set in
  P1 Monitor and the water meter.
- One device with what the meter gives: the power taken and injected every
  10 seconds; the consumption index (low + high tariff) as the only energy
  index, fed to the Gladys energy monitoring every minute; the tariff and
  injection indexes as plain sensors (never billed); the current tariff;
  power, voltage and current per phase; gas and water as volume sensors in
  m³, out of the energy monitoring; the prices as plain sensors.
- The consumption index is protected (the core counts every rise in full):
  never 0, never a partial sum, a register at 0 or dropping alone ignored;
  a drop held (never confirmed by time); a jump over 100 kW on average held whatever the time
  passed and across restarts (kept in `/data`), shown in the status and
  accepted only by the "Accept the held index" action (the difference counted
  once). The other counters are never sent at 0.
- A frozen reading (same timestamp for 5 minutes) stops the power and the
  phases, and the status says so.
- The secondary pages (phases, prices, water) never hold back the main
  values; without a water meter, its page is asked again once an hour.
- The device published again never loses a feature of the created one, and
  "Update" in Discovery gets the new features their values at once.
- Resilience: an unreachable P1 Monitor is tried again after 10 s, doubled up
  to 5 minutes; each reconnection to Gladys publishes the device, every value
  and the status again.
- "Accept the held index" button: takes exactly the value held shown in the
  status (a jump counted once, a drop billing nothing) and answers with the
  kWh counted; a save of the configuration never accepts anything.
- "Test the connection" button: reads the power and the consumption index
  once.
- Documentation in English and French; `LICENSE` (Apache-2.0) and
  `THIRD_PARTY_NOTICES.md` (MIT license of p1monitor), shipped in the image.

### Changed

- Review of milestone 1: a drop of the consumption index is held like a jump,
  never confirmed by time (a drop taken then a rise back would have billed
  thousands of fictive kWh); a tariff at 0 or dropping alone gives no index;
  a frozen reading never shrinks the margin of the next rise; powers above
  100 kW ignored; one device per integration (`p1monitor:meter`), the address
  only a parameter; the last failure shown again after a reconnection; a read
  of an old address publishes nothing; the created device still offered when
  the P1 Monitor is unreachable at the start; pacing on a monotonic clock;
  secondary pages read in parallel with the meter.
- Review round 2: a value held back is accepted only by the new "Accept the
  held index" action, bounded to the value shown plus what the home may draw
  since (another value is held again); a save of the configuration accepts
  nothing; the held index also shows in the "unreachable" status; both
  tariffs lower is always a drop for the guard, and the tariff reference is
  never cleared by a save (a stuck register: delete and create the device
  again); a secondary page failing while the meter fails is not counted.
- Approval: a value held read back from `/data` after a restart is dated at
  its loading, so an old date never widens what an acceptance takes; the
  sums of tariffs require a finite total.

[Unreleased]: https://github.com/LM1LC3N7/gladys-p1-monitor/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/LM1LC3N7/gladys-p1-monitor/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/LM1LC3N7/gladys-p1-monitor/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/LM1LC3N7/gladys-p1-monitor/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-p1-monitor/releases/tag/v0.1.1

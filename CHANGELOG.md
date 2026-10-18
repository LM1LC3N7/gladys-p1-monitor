# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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
  accepted only when the user saves the configuration (the difference counted
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

[Unreleased]: https://github.com/LM1LC3N7/gladys-p1-monitor/commits/main

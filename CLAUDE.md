# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

It reads **P1 Monitor** (ztatz), the software plugged into the P1 port of a
smart meter (BE, NL), through its local REST API over plain HTTP:
`/api/v1/smartmeter`, `/api/v1/status`, `/api/v1/configuration`,
`/api/v2/watermeter/day`. The pages and the meaning of their fields are
ported from [p1monitor](https://github.com/klaasnicolaas/python-p1monitor)
(MIT, see `THIRD_PARTY_NOTICES.md`). Unofficial: not affiliated with
P1 Monitor. Sibling of `gladys-youless` (same energy rules, same guard);
distinct from the DSMR Reader (GBoulvin), YouLess and HomeWizard
integrations.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/model.test.js            # one file
node --test --test-name-pattern "guard"   # tests whose name matches
npm run audit                             # npm audit --omit=dev
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/app.js                        P1MonitorApp: 10 s reads, secondary pages, indexes
                                  every minute, frozen reading, retries, test button
src/p1monitor/client.js           the only HTTP access (bounded body, no redirect)
src/p1monitor/model.js            the pages -> snapshots, capabilities (pure)
src/guard.js                      plausibility of the billed index (pure)
src/store.js                      the guard state kept in /data across restarts
src/devices.js                    the device, feature keys, states (pure)
src/config.js                     the address, normalized
src/constants.js                  pages, ids, pacing, limits, manifest keys
src/i18n.js                       runtime texts (en/fr)
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys (integration-sdk/testing)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **Energy monitoring**: `consumption_index` is the ONLY `energy-sensor` /
  `index` (or `energy`) feature: low + high, two cumulative counters, only
  when both are there; the core derives consumption and cost from it. Never a
  second index (tariffs), never the injection in it, never a daily total,
  never `daily-consumption` through `publishStates`, never
  `publishEnergyConsumption`. Gas and water are `volume-sensor` in m³, NEVER
  in the energy monitoring (the core would price them at the electricity
  tariff). `power` (taken from the grid) stays the only `energy-sensor` /
  `power` feature; the injected power is a plain sensor.
- **The billed index passes `IndexGuard`** (`src/guard.js`): never 0, a drop
  and a jump up never confirmed by repetition nor by time (both held),
  only by the `accept_held_index` action in two clicks, bounded to the value
  listed by the first (a save of the configuration accepts nothing). The
  guard runs on the session clock (wall at the start + monotonic since). The other counters are never
  published at 0.
- **A secondary page never blocks the main data**: status, configuration
  and water failing keep the power and the indexes going.
- **Never a text of the device in a message**, never a URL in the logs:
  error messages use our own words and codes.
- **External ids are forever**: `p1monitor:meter` (one device per integration, the address only a param), the `FEATURE`
  keys of `src/devices.js`, the manifest keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume: `src/store.js` keeps the index reference, a value held and the tariffs
  in `/data/p1-monitor-state.json`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language.
  `test/manifest.test.js` ties the manifest to the code.
- **User-facing text** is bilingual (English and French): runtime messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync. Files are
  UTF-8 without BOM (`test/encoding.test.js`, sources included).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

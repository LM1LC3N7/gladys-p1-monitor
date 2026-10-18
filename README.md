# gladys-p1-monitor

[Gladys Assistant](https://gladysassistant.com) external integration for
**P1 Monitor** (ztatz), the software plugged into the P1 port of a smart
meter (Belgium, Netherlands), read through its local REST API: the power
taken and injected every 10 seconds, the electricity index for the Gladys
energy monitoring every minute, and, when the meter gives them, the indexes
per tariff, the injection, the phases, gas, water and the prices set in
P1 Monitor. **Unofficial, not affiliated with P1 Monitor. Never tested with a
real P1 Monitor.**

Not to be confused with the **DSMR Reader** integration (GBoulvin), which
reads the DSMR Reader software, nor with the **YouLess** and **HomeWizard**
integrations, which read those boxes: one meter, one of them.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/app.js (P1MonitorApp)
                 ├─ src/p1monitor/client.js  local HTTP: the pages (bounded, no redirect)
                 ├─ src/p1monitor/model.js   smartmeter, status, configuration, water -> snapshots (pure)
                 ├─ src/guard.js             plausibility of the billed index (pure)
                 └─ src/devices.js           the device, its features and states (pure)
```

- **Pages** (after the p1monitor library): `/api/v1/smartmeter` (main),
  `/api/v1/status` (phases), `/api/v1/configuration` (prices),
  `/api/v2/watermeter/day` (water), all with `json=object`. Only the smart
  meter page decides whether the P1 Monitor is reachable; the three others
  are secondary: their failure is logged once, shown in the status, tried
  again every 5 minutes, and never holds back the main values.
- **One device**, external id `p1monitor:meter` (the API gives no serial
  number; the address is only a param, so a new IP address keeps the device
  and its history). Its features are what the P1 Monitor showed plus what the
  created device carries (from `gladys.devices`): the published device never
  shrinks.
- **Energy**: `consumption_index` (energy-sensor / index, kWh) is the only
  energy index: `CONSUMPTION_KWH_LOW + CONSUMPTION_KWH_HIGH`, two cumulative
  counters of the meter, only when both are there. The core derives the
  consumption and cost from it. Tariff and injection indexes, injected power
  and prices are plain sensors (never billed, never counted twice); gas and
  water are volume sensors (m³), out of the energy monitoring. No
  `daily-consumption`, no `publishEnergyConsumption`.
- **Index plausibility** (`src/guard.js`; the core skips a negative delta
  but counts every rise in full): never 0, never a partial sum; a tariff
  that was above 0 and reads 0, or that drops alone, gives no index for that
  reading; a drop of the sum and a jump over 100 kW on average are never
  confirmed by repetition nor by time: held (kept in
  `/data/p1-monitor-state.json` across restarts), the last accepted value
  sent again, shown in the status, accepted only by a save of the
  configuration (a drop then bills nothing, a jump is counted once). A value
  equal to the reference never moves its date (a frozen reading never
  shrinks the margin). The other counters are never published at 0.
- **Pace**: one read every 10 s (power, phases); the indexes, tariff, gas,
  water and prices are published once a minute; water read every 5 min,
  prices every 15 min; `publishChangedStates` with a 10-minute heartbeat.
- **Frozen reading**: the `TIMESTAMP_UTC` of the reading unchanged for
  5 minutes (our clock) stops the power and the phases.
- **Errors**: unreachable → retries after 10 s, doubled up to 5 min; a
  reconnection to Gladys keeps the delay, a save of the form ends it. Errors
  are logged with our own codes, never a text of the device or a URL.

## Credits

The pages and the meaning of their fields are ported from
[p1monitor](https://github.com/klaasnicolaas/python-p1monitor) 3.2.0 by Klaas
Schoute (MIT, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)). Modelled
on the sibling integration
[gladys-youless](https://github.com/LM1LC3N7/gladys-youless), which follows
the same energy rules.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit                                   # npm audit --omit=dev
npx github:GladysAssistant/integration-store .  # store admission checks
```

Tests never touch the network: the P1 Monitor answers are synthetic, shaped
after the fixtures of the p1monitor library. Gladys is the SDK's fake.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0 (`LICENSE`). The logic ported from p1monitor remains under its MIT
license, reproduced in full in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
(also shipped in the Docker image).

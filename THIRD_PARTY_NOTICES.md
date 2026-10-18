# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the project below, distributed under its own
license.

## p1monitor (klaasnicolaas/python-p1monitor)

<https://github.com/klaasnicolaas/python-p1monitor>, by Klaas Schoute, the
library the P1 Monitor integration of Home Assistant uses. Version 3.2.0
(tag `v3.2.0`, commit 552650f).

Ported to JavaScript in `src/p1monitor/client.js` and `src/p1monitor/model.js`:
the pages of the local API (`/api/v1/smartmeter`, `/api/v1/status`,
`/api/v1/configuration`, `/api/v2/watermeter/day`) and their query
(`json=object`, `limit=1`), the meaning of the fields of the smart meter
reading (`CONSUMPTION_W`, `PRODUCTION_W`, `CONSUMPTION_KWH_LOW` / `HIGH`,
`PRODUCTION_KWH_LOW` / `HIGH`, `CONSUMPTION_GAS_M3`, `TARIFCODE` with `P` for
the high tariff), the ids of the status list (74 to 79 power per phase in kW,
100 to 102 current, 103 to 105 voltage), the ids of the configuration list
(1 to 4 electricity prices, 15 gas price), the water meter total
(`WATERMETER_CONSUMPTION_TOTAL_M3`, an empty list or a 404 without a water
meter). The test answers in `test/fixtures/p1monitor.js` are shaped after its
test fixtures. Changed here: a missing value is never read as 0, a tariff code
other than `P` or `D` is unknown, and an index is a sum only when both of its
tariffs are there.

Its license, reproduced as it appears in the repository (tag `v3.2.0`):

```
MIT License

Copyright (c) 2021-2026 Klaas Schoute

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## gladys-youless

The plausibility guard of the billed index (`src/guard.js`), the `/data`
store (`src/store.js`) and the address parser (`src/config.js`) come from the
sibling integration [gladys-youless](https://github.com/LM1LC3N7/gladys-youless),
same project, Apache-2.0.

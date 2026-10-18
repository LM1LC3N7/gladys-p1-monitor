# P1 Monitor for Gladys Assistant

**Unofficial** integration, not affiliated with P1 Monitor (ztatz). It reads
**P1 Monitor**, the software (often on a Raspberry Pi) plugged into the P1
port of your smart meter (Belgium, Netherlands), **through its local API**,
without any cloud or account.

> **Never tested with a real P1 Monitor.** The integration was written from
> the p1monitor library (used by Home Assistant) and simulated answers. Your
> feedback on the Gladys forum is welcome.

### This is not…

- the **DSMR Reader** integration (by GBoulvin), which reads another
  software, DSMR Reader;
- the **YouLess** integration, which reads the YouLess box;
- the **HomeWizard** integration, which reads the HomeWizard box (P1 Meter).

Use the one that matches what is plugged into your meter: two of them on the
same meter would count the consumption twice in the energy monitoring.

## What you get

One "P1 Monitor" device, with only what your meter gives:

| Value                                                     | Pace   | Type in Gladys                                  |
| --------------------------------------------------------- | ------ | ----------------------------------------------- |
| Power taken from the grid (W)                             | 10 s   | energy sensor, power                            |
| Power injected into the grid (W)                          | 10 s   | plain sensor                                    |
| Consumption index (kWh): low tariff + high tariff         | 1 min  | energy sensor, **index**: energy monitoring     |
| Consumption index per tariff, low and high (kWh)          | 1 min  | plain sensors                                   |
| Injection index, total and per tariff (kWh)               | 1 min  | plain sensors, **never billed**                 |
| Current tariff (1 = low, 2 = high)                        | 1 min  | plain sensor                                    |
| Per phase: power taken and injected (W), voltage, current | 10 s   | sensors without history by default              |
| Gas (m³)                                                  | 1 min  | volume sensor, **out of the energy monitoring** |
| Water (m³), when a water meter is wired to P1 Monitor     | 5 min  | volume sensor, **out of the energy monitoring** |
| Prices set in P1 Monitor (€/kWh, €/m³)                    | 15 min | plain sensors                                   |

The Gladys **energy monitoring** derives the consumption per half hour and
its cost from the consumption index by itself (low + high tariff of the
meter, two cumulative counters: never a daily total, never the injection).
Injection, gas and water stay apart: Gladys would price gas at the
electricity tariff, and the injection would be counted as a consumption. The
P1 Monitor prices are only shown: the cost in Gladys comes from your Gladys
energy contracts.

"Low tariff" and "high tariff" are the names P1 Monitor uses (`LOW` and
`HIGH`, "dal" and "piek"; tariff code `D` or `P`). On a Belgian meter, where
tariff 1 is the day tariff, check which one matches your bill (not verified).

## Installation

1. Give the device running P1 Monitor a **fixed IP address** in your router:
   the Gladys device is known by this address (changing it creates a new
   device).
2. In Gladys, install the P1 Monitor integration from the store, open its
   configuration and enter the **address** (e.g. `192.168.1.40`, with
   `:port` only if it is not 80).
3. Click **Test the connection**: the power and index read are shown.
4. In the **Discover** tab, create the P1 Monitor device. The values arrive
   at once.

The API is read over plain HTTP on your network, without a password (as Home
Assistant does); the HTTPS of P1 Monitor is not used.

## Good to know

- **P1 Monitor unreachable**: the integration status says so, and it tries
  again after 10 s, then 20 s, 40 s… up to 5 minutes, never giving up. Saving
  the configuration tries again at once.
- **Secondary pages** (phases, prices, water meter) failing: the power and
  the indexes go on; the status says so, and the page is tried again every
  5 minutes. Without a water meter, the water page is asked again only once
  an hour (a meter added later appears).
- **Frozen reading**: when P1 Monitor gives the same meter reading for
  5 minutes (P1 cable unplugged, reading stopped), the power and the phases
  are no longer sent (they would look current) and the status says so.
- **Consumption index protected** (Gladys counts every rise in full):
  - an index at 0 is never sent, nor a partial sum (a tariff missing: no
    index); the tariff and injection indexes, gas and water are never sent
    at 0 either;
  - a **drop** (meter replaced) is accepted only after 60 minutes of
    non-zero, non-decreasing values; the consumption of these 60 minutes of
    waiting is lost;
  - a **jump up** (more than 100 kW on average since the last value) is
    **never** accepted by itself, not by repetition, not by time, not by a
    restart: every value at or above it stays held (the hold is kept in
    `/data`), the last accepted value is sent again to Gladys, and the
    integration status shows the jump. If it is right, **save the
    configuration** of the integration: the current index is then accepted,
    and the difference is **counted once** as consumption.
- Unchanged values are sent again only every 10 minutes; on each
  reconnection to Gladys, the device, all its values and the status are
  published again.
- The features of the device are fixed when it is created: if a value
  appears later (first solar panels, a water meter), click "Update" in the
  Discover tab: the new values arrive at once. The device published again
  never loses a feature of the created one, even if a value is missing for a
  while.
- The injection (power, indexes, injection prices) appears only once it is
  above 0: a home without panels does not see these values.

## Limits

- One P1 Monitor per installation of the integration.
- The dynamic tariffs and the history of P1 Monitor are not read.
- No protected access (password, HTTPS): the local API must be reachable
  over HTTP from Gladys.

## Credits

API reading ported from
[p1monitor](https://github.com/klaasnicolaas/python-p1monitor) (MIT, Klaas
Schoute). P1 Monitor is a software by ztatz. Integration code under the
Apache-2.0 license.

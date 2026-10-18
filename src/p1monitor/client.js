// -----------------------------------------------------------------------------
// The local REST API of P1 Monitor (ztatz), plain HTTP on the home network,
// no cloud, no account, after the p1monitor library
// (klaasnicolaas/python-p1monitor, MIT, see THIRD_PARTY_NOTICES.md): a GET
// of /api/<page> with `json=object` (and `limit=1` for the readings).
//
// The smart meter page is the main one; the status (phases), configuration
// (prices) and water meter pages are secondary: src/app.js never lets their
// failure hold back the main values.
//
// Errors carry our own words and codes, never a text of the device.
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, MAX_BODY_BYTES, PATHS, QUERIES } from '../constants.js';
import { parsePhases, parsePrices, parseSmartmeter, parseWater } from './model.js';

export class P1MonitorError extends Error {
  /**
   * @param {'timeout'|'unreachable'|'http'|'too_large'|'not_data'|'unknown_answer'|'no_data'} code
   */
  constructor(code, message, status) {
    super(message);
    this.name = 'P1MonitorError';
    this.code = code;
    this.status = status;
  }
}

/** A system error code (ECONNREFUSED...) is ours to show; anything else is not. */
const systemCode = (err) => {
  const code = err?.cause?.code ?? err?.code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,30}$/.test(code) ? code : undefined;
};

/** A network failure (while connecting or while reading the body), in our words. */
function networkError(err) {
  if (err instanceof P1MonitorError) {
    return err;
  }
  const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
  const code = systemCode(err);
  return new P1MonitorError(
    timeout ? 'timeout' : 'unreachable',
    timeout ? 'no answer' : `unreachable${code ? ` (${code})` : ''}`,
  );
}

/** The body, read up to `limit` bytes: a longer one is not P1 Monitor. */
async function readBounded(response, limit) {
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new P1MonitorError('too_large', 'the device answered more than P1 Monitor sends');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

const notP1Monitor = () =>
  new P1MonitorError('unknown_answer', 'the answer is not a P1 Monitor one');

export class P1MonitorClient {
  constructor({
    address,
    fetchImpl = (...args) => globalThis.fetch(...args),
    timeout = HTTP_TIMEOUT,
  }) {
    this.address = address;
    this.fetch = fetchImpl;
    this.timeout = timeout;
  }

  /**
   * One GET of a page, its JSON. `allow404`: a 404 is returned as
   * `undefined` (the water meter page without a water meter).
   */
  async get(path, { allow404 = false } = {}) {
    const query = new URLSearchParams(QUERIES[path] ?? {}).toString();
    let response;
    let text;
    try {
      response = await this.fetch(`http://${this.address}${path}${query ? `?${query}` : ''}`, {
        method: 'GET',
        headers: { Accept: 'application/json, text/plain, */*' },
        // A redirect is never followed: the requests stay on this address.
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeout),
      });
      // The body can fail too (timeout, connection cut): same errors.
      text = await readBounded(response, MAX_BODY_BYTES);
    } catch (err) {
      throw networkError(err);
    }
    if (response.status === 404 && allow404) {
      return undefined;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new P1MonitorError('http', `HTTP ${response.status}`, response.status);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new P1MonitorError('not_data', 'the device answered something that is not data');
    }
  }

  /** The last reading of the smart meter (the main page). */
  async readMeter() {
    const meter = parseSmartmeter(await this.get(PATHS.SMARTMETER));
    if (!meter) {
      throw notP1Monitor();
    }
    if (meter.empty) {
      throw new P1MonitorError('no_data', 'P1 Monitor has no reading of the meter yet');
    }
    return meter;
  }

  /** The voltage, current and power of each phase (secondary). */
  async readPhases() {
    const phases = parsePhases(await this.get(PATHS.STATUS));
    if (!phases) {
      throw notP1Monitor();
    }
    return phases;
  }

  /** The prices set in P1 Monitor (secondary). */
  async readPrices() {
    const prices = parsePrices(await this.get(PATHS.CONFIGURATION));
    if (!prices) {
      throw notP1Monitor();
    }
    return prices;
  }

  /** The water meter total (secondary): `{ none: true }` without a water meter. */
  async readWater() {
    const data = await this.get(PATHS.WATERMETER, { allow404: true });
    if (data === undefined) {
      return { none: true };
    }
    const water = parseWater(data);
    if (!water) {
      throw notP1Monitor();
    }
    return water;
  }
}

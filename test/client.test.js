// -----------------------------------------------------------------------------
// The HTTP client against a fake P1 Monitor: pages, queries, errors.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BODY_BYTES } from '../src/constants.js';
import { P1MonitorClient, P1MonitorError } from '../src/p1monitor/client.js';
import { createFetch, refusedError, timeoutError } from './helpers/fakeFetch.js';
import { ADDRESS, WATER, html, json, routes } from './fixtures/p1monitor.js';

const client = (overrides = {}) => {
  const fake = createFetch(routes(overrides));
  return { fake, client: new P1MonitorClient({ address: ADDRESS, fetchImpl: fake.fetch }) };
};

test('the smart meter page: the query of the library, no redirect followed', async () => {
  const { client: c, fake } = client();
  const meter = await c.readMeter();
  assert.equal(meter.power, 935);
  assert.equal(meter.consumption.total, 2996.141 + 5436.256);
  assert.equal(fake.calls[0].url, `http://${ADDRESS}/api/v1/smartmeter?json=object&limit=1`);
  assert.equal(fake.calls[0].init.redirect, 'manual');
  assert.equal(fake.calls[0].init.method, 'GET');
});

test('the secondary pages: phases, prices, water', async () => {
  const { client: c, fake } = client();
  assert.equal((await c.readPhases()).phases.length, 1);
  assert.equal((await c.readPrices()).gas, 0.86687);
  assert.equal((await c.readWater()).total, 1640.399);
  assert.deepEqual(
    fake.calls.map((call) => `${call.path}${call.query}`),
    [
      '/api/v1/status?json=object',
      '/api/v1/configuration?json=object',
      '/api/v2/watermeter/day?json=object&limit=1',
    ],
  );
});

test('no water meter: a 404 or an empty list, never an error', async () => {
  for (const handler of [() => json({}, 404), () => json([])]) {
    const { client: c } = client({ '/api/v2/watermeter/day': handler });
    assert.deepEqual(await c.readWater(), { none: true });
  }
  const { client: c } = client({ '/api/v2/watermeter/day': () => json({ x: 1 }) });
  await assert.rejects(c.readWater(), (err) => err.code === 'unknown_answer');
  assert.ok(WATER.length === 1);
});

test('no reading yet, another service, a web page: our own errors', async () => {
  const cases = [
    [() => json([]), 'no_data'],
    [() => json([{ hello: 'world' }]), 'unknown_answer'],
    [() => json({ hello: 'world' }), 'unknown_answer'],
    [() => html(), 'not_data'],
    [() => json({}, 404), 'http'],
    [() => new Response('boom secret-text', { status: 500 }), 'http'],
  ];
  for (const [handler, code] of cases) {
    const { client: c } = client({ '/api/v1/smartmeter': handler });
    await assert.rejects(c.readMeter(), (err) => {
      assert.ok(err instanceof P1MonitorError);
      assert.ok(!err.message.includes('secret-text'));
      return err.code === code;
    });
  }
});

test('network failures in our words', async () => {
  const { client: c } = client({
    '/api/v1/smartmeter': () => {
      throw timeoutError();
    },
  });
  await assert.rejects(c.readMeter(), (err) => err.code === 'timeout');
  const { client: refused } = client({
    '/api/v1/smartmeter': () => {
      throw refusedError();
    },
  });
  await assert.rejects(
    refused.readMeter(),
    (err) => err.code === 'unreachable' && err.message === 'unreachable (ECONNREFUSED)',
  );
});

test('an answer larger than P1 Monitor sends is cut', async () => {
  const big = 'x'.repeat(MAX_BODY_BYTES + 10);
  const { client: c } = client({ '/api/v1/status': () => new Response(big) });
  await assert.rejects(c.readPhases(), (err) => err.code === 'too_large');
});

test('a body cut while being read is a network error in our words', async () => {
  const broken = () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          controller.error(timeoutError());
        },
      }),
    );
  const { client: c } = client({ '/api/v1/smartmeter': broken });
  await assert.rejects(
    c.readMeter(),
    (err) => err instanceof P1MonitorError && err.code === 'timeout',
  );
});

// -----------------------------------------------------------------------------
// The integration itself: the P1 Monitor read every 10 s (the indexes
// published once a minute), its device, the plausibility of the billed index,
// the secondary pages (phases, prices, water) that never hold back the main
// values, the retries of an unreachable device and the test button. index.js
// only wires the SDK handlers to it.
//
// The created devices are read from `gladys.devices`, which the SDK keeps up
// to date (connection, creation, update, deletion): never a copy of our own.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import {
  INDEX_INTERVAL,
  NO_WATER_RETRY,
  POWER_INTERVAL,
  PRICES_INTERVAL,
  READING_STALE_AFTER,
  RETRY_MAX,
  RETRY_MIN,
  SECONDARY_RETRY,
  STATE_HEARTBEAT,
  TEST_ANSWER_WITHIN,
  WATER_INTERVAL,
} from './constants.js';
import {
  FEATURE,
  buildDevice,
  capabilitiesOfDevice,
  ids,
  indexStates,
  liveStates,
  round,
} from './devices.js';
import { IndexGuard } from './guard.js';
import { createFileStore } from './store.js';
import { T } from './i18n.js';
import { P1MonitorClient } from './p1monitor/client.js';
import { bringsNew, capabilitiesOf, mergeCapabilities } from './p1monitor/model.js';

const defaultTimers = { setTimeout, clearTimeout, setInterval, clearInterval };

/** The secondary pages, in the order they are read; `every`: 0 for each read. */
const PAGES = [
  { name: 'phases', read: (client) => client.readPhases(), every: 0, keepOnError: false },
  {
    name: 'prices',
    read: (client) => client.readPrices(),
    every: PRICES_INTERVAL,
    keepOnError: true,
  },
  { name: 'water', read: (client) => client.readWater(), every: WATER_INTERVAL, keepOnError: true },
];

const freshPages = () =>
  Object.fromEntries(PAGES.map((p) => [p.name, { nextAt: 0, failing: false, data: undefined }]));

/** The index Gladys already holds for a feature of a created device, when it says so. */
function lastValueOf(device, featureId) {
  const feature = (device?.features ?? []).find((f) => f.external_id === featureId);
  const value = Number(feature?.last_value);
  const at = Date.parse(feature?.last_value_changed ?? '');
  return feature?.last_value !== null &&
    feature?.last_value !== undefined &&
    Number.isFinite(value) &&
    Number.isFinite(at)
    ? { value, at }
    : undefined;
}

export class P1MonitorApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'p1-monitor' }),
    now = Date.now,
    timers = defaultTimers,
    clientFactory = (options) => new P1MonitorClient(options),
    store = createFileStore(),
  }) {
    this.gladys = gladys;
    /** /data: the index reference and the jump held, across restarts. */
    this.store = store;
    this.savedGuard = undefined;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.clientFactory = clientFactory;
    this.config = normalizeConfig();
    this.client = undefined;
    /** What the P1 Monitor showed it gives, and what its created device carries: only grows. */
    this.capabilities = undefined;
    this.guard = undefined;
    this.lastIndexAt = 0;
    /** The last reading of the meter, and the secondary pages. */
    this.meter = undefined;
    this.pages = freshPages();
    /** Freshness of the reading: its TIMESTAMP_UTC, and when (our clock) it last changed. */
    this.readingStamp = undefined;
    this.freshAt = 0;
    /** Retries: kept across reconnections to Gladys, reset by a save of the form. */
    this.failures = 0;
    this.nextTryAt = 0;
    this.timer = undefined;
    this.busy = undefined;
    this.firstRun = Promise.resolve();
    this.lastStatus = undefined;
    this.generation = 0;
    this.lifecycle = Promise.resolve();
  }

  // --- Lifecycle -------------------------------------------------------------

  /**
   * `fresh`: the user saved the form (not a reconnection): the retry delays
   * end, and a consumption index jump held back is accepted (counted once).
   */
  start(raw = {}, { fresh = false } = {}) {
    return this.serialize(() => this.doStart(raw, { fresh }));
  }

  stop() {
    return this.serialize(() => this.doStop());
  }

  /** Resolves once every queued start/stop and the first read after it are done (tests). */
  async idle() {
    await this.lifecycle;
    await this.firstRun;
  }

  serialize(job) {
    const run = this.lifecycle.then(job, job);
    this.lifecycle = run.catch(() => {});
    return run;
  }

  async doStart(raw, { fresh = false } = {}) {
    await this.doStop();
    const generation = ++this.generation;
    const config = normalizeConfig(raw);
    const changed = config.address !== this.config.address;
    this.config = config;
    if (changed || !this.client) {
      // Another P1 Monitor: nothing of the previous one is kept.
      this.client = config.address ? this.clientFactory({ address: config.address }) : undefined;
      this.capabilities = undefined;
      this.guard = undefined;
      this.meter = undefined;
      this.pages = freshPages();
      this.readingStamp = undefined;
      this.failures = 0;
      this.nextTryAt = 0;
    }
    if (fresh) {
      this.failures = 0;
      this.nextTryAt = 0;
      for (const page of Object.values(this.pages)) {
        page.nextAt = 0;
      }
      if (this.guard?.jump) {
        this.logger.info(
          'P1 Monitor consumption index jump accepted by a save of the configuration',
        );
        this.guard.acceptJump();
      }
    }
    // The core keeps the connection status in memory: a restarted Gladys has
    // lost it, so it is always sent again after a (re)connection.
    this.lastStatus = undefined;
    if (!config.address) {
      await this.setStatus(false, config.invalidAddress ? T.badAddress : T.noAddress);
      return;
    }
    // Every start (a reconnection to Gladys included) publishes everything
    // again: a restarted Gladys has lost the discovered list.
    this.gladys.forgetPublishedStates();
    this.lastIndexAt = 0;
    await this.discover();
    // Always armed, whatever the first read gives: never a dead integration.
    this.timer = this.timers.setInterval(
      () => this.run(generation, () => this.tick()),
      POWER_INTERVAL,
    );
    // Not awaited: a start (a save of the form) answers at once.
    this.firstRun = this.run(generation, () => this.tick());
  }

  async doStop() {
    this.generation += 1;
    if (this.timer !== undefined) {
      this.timers.clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Run a job of a generation: nothing after a restart. */
  async run(generation, job) {
    if (generation !== this.generation) {
      return;
    }
    try {
      await job();
    } catch (err) {
      this.logger.error(`P1 Monitor: unexpected error (${err?.name ?? 'Error'})`);
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  // --- Devices ---------------------------------------------------------------------

  externalIds() {
    return ids(this.gladys, this.config.address);
  }

  /** The created Gladys device of the P1 Monitor, undefined until the user creates it. */
  createdDevice() {
    if (!this.config.address) {
      return undefined;
    }
    const id = this.externalIds().device;
    return (this.gladys.devices ?? []).find((d) => d.external_id === id);
  }

  /** The capabilities known so far, with the features of the created device (never fewer). */
  knownCapabilities(seen) {
    return mergeCapabilities(
      mergeCapabilities(this.capabilities, capabilitiesOfDevice(this.createdDevice())),
      seen,
    );
  }

  async discover() {
    if (!this.capabilities) {
      return;
    }
    await this.gladys
      .publishDiscoveredDevices([buildDevice(this.gladys, this.capabilities, this.config.address)])
      .catch((err) => this.logger.warn(`Publishing the P1 Monitor device failed: ${err.message}`));
  }

  /** The Discover tab asks: the known device, or a read now to find it. */
  async scan() {
    if (this.capabilities) {
      await this.discover();
    } else if (this.client) {
      this.nextTryAt = 0;
      await this.run(this.generation, () => this.tick());
    }
  }

  async onDeviceCreated(device) {
    if (this.config.address && device?.external_id === this.externalIds().device) {
      // A new device: no reference of the index yet (nor a jump kept in /data
      // for a deleted device of the same id), its values right away.
      this.guard = undefined;
      this.savedGuard = undefined;
      const indexId = this.externalIds().feature(FEATURE.CONSUMPTION_INDEX);
      const kept = this.store.load();
      if (indexId in kept) {
        delete kept[indexId];
        await this.store
          .save(kept)
          .catch((err) =>
            this.logger.warn(
              `Clearing the P1 Monitor index state failed (${err?.code ?? 'error'})`,
            ),
          );
      }
      this.lastIndexAt = 0;
      await this.run(this.generation, () => this.tick());
    }
  }

  async onDeviceUpdated(device) {
    if (this.config.address && device?.external_id === this.externalIds().device) {
      // New features (Update in Discovery): their values right away.
      this.lastIndexAt = 0;
      await this.run(this.generation, () => this.tick());
    }
  }

  // --- Reads -------------------------------------------------------------------------

  /** One read; a read still running (a slow device) is never doubled. */
  tick() {
    if (!this.busy) {
      this.busy = this.doTick().finally(() => {
        this.busy = undefined;
      });
    }
    return this.busy;
  }

  async doTick() {
    const now = this.now();
    if (!this.client || now < this.nextTryAt) {
      return;
    }
    const client = this.client;
    let meter;
    try {
      meter = await client.readMeter();
    } catch (err) {
      await this.failed(err, now);
      return;
    }
    this.failures = 0;
    this.nextTryAt = 0;
    this.meter = meter;
    for (const page of PAGES) {
      await this.readPage(client, page, now);
    }
    this.followFreshness(meter, now);
    const target = this.knownCapabilities(
      capabilitiesOf({
        meter,
        phases: this.pages.phases.data,
        prices: this.pages.prices.data,
        water: this.pages.water.data,
      }),
    );
    if (!this.capabilities || bringsNew(this.capabilities, target)) {
      this.capabilities = target;
      await this.discover();
    }
    await this.publish(meter, now);
    await this.setStatus(true, this.createdDevice() ? this.okMessage(meter) : T.noDevice);
  }

  /**
   * A secondary page: its failure is logged once, shown in the status and
   * tried again after SECONDARY_RETRY; it never holds back the main values.
   */
  async readPage(client, { name, read, every, keepOnError }, now) {
    const page = this.pages[name];
    if (now < page.nextAt) {
      return;
    }
    try {
      const data = await read(client);
      page.data = data;
      page.nextAt = data?.none ? now + NO_WATER_RETRY : every ? now + every : 0;
      if (page.failing) {
        page.failing = false;
        this.logger.info(`P1 Monitor ${name} page back`);
      }
    } catch (err) {
      page.nextAt = now + SECONDARY_RETRY;
      if (!keepOnError) {
        // Live values: never shown stale.
        page.data = undefined;
      }
      if (!page.failing) {
        page.failing = true;
        this.logger.warn(`P1 Monitor ${name} page unavailable (${err?.code ?? 'error'})`);
      }
    }
  }

  /** The reading is stale when its TIMESTAMP_UTC has not changed for a while (our clock). */
  followFreshness(meter, now) {
    if (meter.timestamp === undefined || meter.timestamp !== this.readingStamp) {
      this.readingStamp = meter.timestamp;
      this.freshAt = now;
    }
  }

  isStale(now) {
    return this.readingStamp !== undefined && now - this.freshAt >= READING_STALE_AFTER;
  }

  okMessage(meter) {
    const notes = [];
    const failing = PAGES.map((p) => p.name).filter((name) => this.pages[name].failing);
    if (failing.length > 0) notes.push(T.notes.pages(failing));
    if (this.isStale(this.now())) notes.push(T.notes.stale);
    if (this.capabilities?.consumption && meter.consumption.total === undefined) {
      notes.push(T.notes.noIndex);
    }
    if (this.guard?.jump) notes.push(T.notes.jump(this.guard.jump));
    return T.ok(this.config.address, notes);
  }

  async failed(err, now) {
    const code = err?.code ?? 'error';
    const wait = Math.min(RETRY_MIN * 2 ** this.failures, RETRY_MAX);
    this.failures += 1;
    this.nextTryAt = now + wait;
    // Our own words only (P1MonitorError): never a text of the device.
    this.logger.warn(`P1 Monitor read failed: ${code}${err?.status ? ` ${err.status}` : ''}`);
    await this.setStatus(false, T.unreachable(this.config.address, err, wait));
  }

  /** The states of a read: the live values every time, the indexes once a minute. */
  async publish(meter, now) {
    const created = this.createdDevice();
    if (!created) {
      return;
    }
    const external = this.externalIds();
    // A frozen reading (P1 cable out): its power would look live, it is not sent.
    const states = this.isStale(now)
      ? []
      : liveStates(external, meter, this.pages.phases.data?.phases ?? []);
    if (now - this.lastIndexAt >= INDEX_INTERVAL) {
      this.lastIndexAt = now;
      const indexId = external.feature(FEATURE.CONSUMPTION_INDEX);
      this.guard ??= new IndexGuard(lastValueOf(created, indexId), this.store.load()[indexId]);
      // The value Gladys will hold (3 decimals) is the one the guard checks.
      const total =
        meter.consumption.total === undefined ? undefined : round(meter.consumption.total, 3);
      const plausible = total !== undefined && this.guard.accept(total, now);
      await this.saveGuard(indexId);
      if (total !== undefined && !plausible) {
        this.logger.warn(
          this.guard.jump
            ? 'P1 Monitor consumption index jump held back: save the configuration to accept it'
            : 'P1 Monitor consumption index held back: a drop or a 0, not confirmed',
        );
      }
      // While a jump is held, the last accepted value is sent again (no delta
      // for the core; the heartbeat keeps its date recent in Gladys).
      const held = this.guard.jump ? this.guard.last?.value : undefined;
      states.push(
        ...indexStates(
          external,
          { meter, water: this.pages.water.data, prices: this.pages.prices.data },
          plausible ? total : held,
        ),
      );
    }
    // Only the features the created device has (they are fixed at its creation).
    const features = created.features ? new Set(created.features.map((f) => f.external_id)) : null;
    const allowed = features
      ? states.filter((s) => features.has(s.device_feature_external_id))
      : states;
    if (allowed.length === 0) {
      return;
    }
    await this.gladys
      .publishChangedStates(allowed, { heartbeat: STATE_HEARTBEAT })
      .catch((err) => this.logger.warn(`Publishing the P1 Monitor values failed: ${err.message}`));
  }

  /** Keeps the guard in /data when its reference or its held jump changed. */
  async saveGuard(indexId) {
    const state = this.guard.state();
    const key = JSON.stringify([
      state.last,
      state.jump && { from: state.jump.from, threshold: state.jump.threshold },
    ]);
    if (key === this.savedGuard) {
      return;
    }
    try {
      await this.store.save({ ...this.store.load(), [indexId]: state });
      this.savedGuard = key;
    } catch (err) {
      this.logger.warn(
        `Saving the P1 Monitor index state in /data failed (${err?.code ?? 'error'})`,
      );
    }
  }

  // --- Configuration screen button --------------------------------------------------

  /** The test button: read the smart meter once. */
  async testConnection() {
    if (!this.client) {
      return this.config.invalidAddress ? T.badAddress : T.noAddress;
    }
    let timer;
    const late = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => resolve(T.test.slow), TEST_ANSWER_WITHIN);
    });
    try {
      return await Promise.race([this.check(), late]);
    } finally {
      this.timers.clearTimeout(timer);
    }
  }

  async check() {
    const client = this.client;
    try {
      const meter = await client.readMeter();
      if (client === this.client) {
        // A good answer ends the retry delay: the next tick reads it.
        this.failures = 0;
        this.nextTryAt = 0;
      }
      return T.test.ok(meter);
    } catch (err) {
      return T.unreachable(this.config.address, err, RETRY_MIN);
    }
  }
}

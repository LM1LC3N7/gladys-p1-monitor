// -----------------------------------------------------------------------------
// The integration itself: the P1 Monitor read every 10 s (the indexes
// published once a minute), its device, the plausibility of the billed index,
// the secondary pages (phases, prices, water) that never hold back the main
// values, the retries of an unreachable device and the test button. index.js
// only wires the SDK handlers to it.
//
// The created devices are read from `gladys.devices`, which the SDK keeps up
// to date (connection, creation, update, deletion): never a copy of our own.
//
// Two clocks: `now` (wall clock) dates the index for the guard and for
// Gladys; `monotonic` paces the reads, retries and intervals, so that a wall
// clock set back never stops them.
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
import { IndexGuard, indexOfTariffs } from './guard.js';
import { createFileStore } from './store.js';
import { T } from './i18n.js';
import { P1MonitorClient } from './p1monitor/client.js';
import { bringsNew, capabilitiesOf, mergeCapabilities } from './p1monitor/model.js';

const defaultTimers = { setTimeout, clearTimeout, setInterval, clearInterval };

/** The secondary pages; `every`: 0 for each read. */
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

/** The tariffs kept in /data with the guard: `{ low, high }` of the last index accepted. */
const validTariffs = (tariffs) =>
  tariffs && Number.isFinite(tariffs.low) && Number.isFinite(tariffs.high)
    ? { low: tariffs.low, high: tariffs.high }
    : undefined;

export class P1MonitorApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'p1-monitor' }),
    now = Date.now,
    monotonic = () => performance.now(),
    timers = defaultTimers,
    clientFactory = (options) => new P1MonitorClient(options),
    store = createFileStore(),
  }) {
    this.gladys = gladys;
    /** /data: the index reference, the value held and the tariffs, across restarts. */
    this.store = store;
    this.savedGuard = undefined;
    this.logger = logger;
    this.now = now;
    this.monotonic = monotonic;
    this.timers = timers;
    this.clientFactory = clientFactory;
    this.config = normalizeConfig();
    this.client = undefined;
    /** What the P1 Monitor showed it gives, and what its created device carries: only grows. */
    this.capabilities = undefined;
    this.guard = undefined;
    /** The tariffs of the last index accepted (src/guard.js indexOfTariffs). */
    this.tariffRef = undefined;
    /** The last index check gave no index (a tariff missing or glitching). */
    this.indexUndefined = false;
    this.lastIndexAt = undefined;
    this.pages = freshPages();
    /** Freshness of the reading: its TIMESTAMP_UTC, and when (monotonic) it last changed. */
    this.readingStamp = undefined;
    this.freshAt = 0;
    /** Retries: kept across reconnections to Gladys, reset by a save of the form. */
    this.failures = 0;
    this.nextTryAt = 0;
    this.lastError = undefined;
    this.timer = undefined;
    this.busy = undefined;
    this.busyGeneration = undefined;
    this.firstRun = Promise.resolve();
    this.lastStatus = undefined;
    this.generation = 0;
    this.lifecycle = Promise.resolve();
  }

  // --- Lifecycle -------------------------------------------------------------

  /**
   * `fresh`: the user saved the form (not a reconnection): the retry delays
   * end. It accepts nothing: a value held back is only taken by its own
   * action (`acceptHeldIndex`).
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
      // Another address: its reads start again. The device (one per
      // integration) and its index guard stay: another meter is held there.
      this.client = config.address ? this.clientFactory({ address: config.address }) : undefined;
      this.pages = freshPages();
      this.readingStamp = undefined;
      this.failures = 0;
      this.nextTryAt = 0;
      this.lastError = undefined;
    }
    if (fresh) {
      this.failures = 0;
      this.nextTryAt = 0;
      this.lastError = undefined;
      for (const page of Object.values(this.pages)) {
        page.nextAt = 0;
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
    // again: a restarted Gladys has lost the discovered list. Unreachable now,
    // the created device is still offered as it is.
    this.gladys.forgetPublishedStates();
    this.lastIndexAt = undefined;
    this.capabilities = this.knownCapabilities();
    await this.discover();
    const mono = this.monotonic();
    if (this.lastError && mono < this.nextTryAt) {
      // Still waiting: the failure is shown again, with the time left.
      await this.setStatus(false, this.failureMessage(this.lastError, this.nextTryAt - mono));
    }
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
    return ids(this.gladys);
  }

  /** The created Gladys device of the P1 Monitor, undefined until the user creates it. */
  createdDevice() {
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
    if (!this.capabilities || !this.config.address) {
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
      // A new device: no reference of the index yet (nor a value held in
      // /data for a deleted device of the same id), its values right away.
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
      // After the save: a read finished meanwhile must not leave its guard.
      this.guard = undefined;
      this.savedGuard = undefined;
      this.tariffRef = undefined;
      this.lastIndexAt = undefined;
      await this.run(this.generation, () => this.tick());
    }
  }

  async onDeviceUpdated(device) {
    if (this.config.address && device?.external_id === this.externalIds().device) {
      // New features (Update in Discovery): their values right away.
      this.lastIndexAt = undefined;
      await this.run(this.generation, () => this.tick());
    }
  }

  // --- Reads -------------------------------------------------------------------------

  /**
   * One read; a read still running (a slow device) is never doubled. A read
   * of a previous start (another address) is let finish (it gives up), then
   * this one runs.
   */
  tick() {
    if (this.busy) {
      if (this.busyGeneration === this.generation) {
        return this.busy;
      }
      return this.busy.then(() => this.tick());
    }
    this.busyGeneration = this.generation;
    this.busy = this.doTick().finally(() => {
      this.busy = undefined;
    });
    return this.busy;
  }

  async doTick() {
    const generation = this.generation;
    const client = this.client;
    const mono = this.monotonic();
    if (!client || mono < this.nextTryAt) {
      return;
    }
    /** A start (another address, a stop) during an await: this read gives up. */
    const gone = () => client !== this.client || generation !== this.generation;
    // The secondary pages are read along with the meter: they never delay it.
    // Their outcome counts only when the meter answered: with the P1 Monitor
    // down, a page failing says nothing of its own, it is read again with the
    // meter at the next try.
    const [result, ...pages] = await Promise.allSettled([
      client.readMeter(),
      ...PAGES.map((page) => this.readPage(client, page, mono)),
    ]);
    if (gone()) {
      return;
    }
    if (result.status === 'rejected') {
      await this.failed(result.reason, mono);
      return;
    }
    for (const page of pages) {
      page.value?.();
    }
    const meter = result.value;
    this.failures = 0;
    this.nextTryAt = 0;
    this.lastError = undefined;
    this.followFreshness(meter, mono);
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
      if (gone()) return;
    }
    await this.publish(meter, mono);
    if (gone()) return;
    await this.setStatus(true, this.createdDevice() ? this.okMessage(meter, mono) : T.noDevice);
  }

  /**
   * A secondary page: its failure is logged once, shown in the status and
   * tried again after SECONDARY_RETRY; it never holds back the main values.
   * Returns what to record (applied by doTick only when the meter answered),
   * or undefined when the page is not due.
   */
  async readPage(client, { name, read, every, keepOnError }, mono) {
    const page = this.pages[name];
    if (mono < page.nextAt) {
      return undefined;
    }
    let data;
    try {
      data = await read(client);
    } catch (err) {
      return () => {
        page.nextAt = mono + SECONDARY_RETRY;
        if (!keepOnError) {
          // Live values: never shown stale.
          page.data = undefined;
        }
        if (!page.failing) {
          page.failing = true;
          this.logger.warn(`P1 Monitor ${name} page unavailable (${err?.code ?? 'error'})`);
        }
      };
    }
    return () => {
      page.data = data;
      page.nextAt = data?.none ? mono + NO_WATER_RETRY : every ? mono + every : 0;
      if (page.failing) {
        page.failing = false;
        this.logger.info(`P1 Monitor ${name} page back`);
      }
    };
  }
  /** The reading is stale when its TIMESTAMP_UTC has not changed for a while (monotonic). */
  followFreshness(meter, mono) {
    if (meter.timestamp === undefined || meter.timestamp !== this.readingStamp) {
      this.readingStamp = meter.timestamp;
      this.freshAt = mono;
    }
  }

  isStale(mono) {
    return this.readingStamp !== undefined && mono - this.freshAt >= READING_STALE_AFTER;
  }

  okMessage(meter, mono) {
    const notes = [];
    const failing = PAGES.map((p) => p.name).filter((name) => this.pages[name].failing);
    if (failing.length > 0) notes.push(T.notes.pages(failing));
    if (this.isStale(mono)) notes.push(T.notes.stale);
    if (this.capabilities?.consumption && this.indexUndefined) {
      notes.push(T.notes.noIndex);
    }
    if (this.guard?.held) notes.push(T.notes.held(this.guard.held));
    return T.ok(this.config.address, notes);
  }

  async failed(err, mono) {
    const code = err?.code ?? 'error';
    const wait = Math.min(RETRY_MIN * 2 ** this.failures, RETRY_MAX);
    this.failures += 1;
    this.nextTryAt = mono + wait;
    this.lastError = err;
    // Our own words only (P1MonitorError): never a text of the device.
    this.logger.warn(`P1 Monitor read failed: ${code}${err?.status ? ` ${err.status}` : ''}`);
    await this.setStatus(false, this.failureMessage(err, wait));
  }

  /** The failure, with the index held back if any (the user must see it while waiting). */
  failureMessage(err, wait) {
    const held = this.currentGuard()?.held;
    const notes = held ? [T.notes.held(held)] : [];
    return T.unreachable(this.config.address, err, wait, notes);
  }

  /** The guard of the created device, built from Gladys and /data when needed. */
  currentGuard() {
    const created = this.createdDevice();
    if (!created) {
      return undefined;
    }
    return this.guardOf(created, this.externalIds().feature(FEATURE.CONSUMPTION_INDEX));
  }

  /** The guard of the created device, from Gladys and /data. */
  guardOf(created, indexId) {
    if (!this.guard) {
      const saved = this.store.load()[indexId];
      this.guard = new IndexGuard(lastValueOf(created, indexId), saved);
      this.tariffRef = validTariffs(saved?.tariffs);
    }
    return this.guard;
  }

  /** The states of a read: the live values every time, the indexes once a minute. */
  async publish(meter, mono) {
    const created = this.createdDevice();
    if (!created) {
      return;
    }
    const external = this.externalIds();
    // A frozen reading (P1 cable out): its power would look live, it is not sent.
    const states = this.isStale(mono)
      ? []
      : liveStates(external, meter, this.pages.phases.data?.phases ?? []);
    if (this.lastIndexAt !== undefined && mono < this.lastIndexAt) {
      // A clock set back (a monotonic clock never is): paced again from now.
      this.lastIndexAt = undefined;
    }
    if (this.lastIndexAt === undefined || mono - this.lastIndexAt >= INDEX_INTERVAL) {
      this.lastIndexAt = mono;
      const indexId = external.feature(FEATURE.CONSUMPTION_INDEX);
      const guard = this.guardOf(created, indexId);
      const { low, high } = meter.consumption;
      // Both tariffs checked, then their sum as Gladys will hold it (3 decimals).
      const sum = indexOfTariffs(low, high, this.tariffRef);
      const total = sum === undefined ? undefined : round(sum, 3);
      this.indexUndefined = total === undefined;
      const plausible = total !== undefined && guard.accept(total, this.now());
      if (plausible) {
        this.tariffRef = { low, high };
      }
      await this.saveGuard(indexId);
      if (total !== undefined && !plausible) {
        this.logger.warn(
          `P1 Monitor consumption index ${guard.held?.direction === 'down' ? 'drop' : 'jump'} held back: save the configuration to accept it`,
        );
      }
      // While a value is held, the last accepted one is sent again (no delta
      // for the core; the heartbeat keeps its date recent in Gladys).
      const held = guard.held ? guard.last?.value : undefined;
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

  /** Keeps the guard in /data when its reference, its value held or the tariffs changed. */
  async saveGuard(indexId) {
    const state = { ...this.guard.state(), tariffs: this.tariffRef ?? null };
    const key = JSON.stringify([
      state.last,
      state.held && {
        direction: state.held.direction,
        from: state.held.from,
        threshold: state.held.threshold,
      },
      state.tariffs,
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

  /**
   * The "Accept the held index" button: takes the value held as shown now
   * (plus what the home may draw until the next read, src/guard.js), never
   * anything else. Answers with what will be counted.
   */
  async acceptHeldIndex() {
    const accepted = this.currentGuard()?.acceptHeld();
    if (!accepted) {
      return T.accept.nothing;
    }
    this.logger.info(
      `P1 Monitor consumption index ${accepted.direction === 'down' ? 'drop' : 'jump'} accepted by the user`,
    );
    // Published at the next read, which comes now.
    this.lastIndexAt = undefined;
    this.firstRun = this.run(this.generation, () => this.tick());
    return accepted.direction === 'down' ? T.accept.down(accepted) : T.accept.up(accepted);
  }

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

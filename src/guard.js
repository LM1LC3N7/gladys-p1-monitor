// -----------------------------------------------------------------------------
// Plausibility of the electricity index, the only value Gladys bills. Pure.
//
// The core turns the deltas of an `energy-sensor` / `index` feature into
// consumption and cost: it skips a delta below zero (a counter reset) but
// counts every rise IN FULL. So 9,194 → 0 → 9,194 kWh is billed as 9,194 kWh
// in one half hour, and so is 9,194 → 10 (a drop taken) → 9,194. The rules:
// - a value of 0 (or below) is never published;
// - a value plausible after the last one published (not lower, not more than
//   INDEX_MAX_KW on average since then) goes through; a value EQUAL to it
//   goes through without moving its date, so that a frozen reading never
//   shrinks the margin of the next real rise;
// - a drop and a jump up are NEVER confirmed by repetition nor by time: they
//   are held (the last accepted value is sent again), shown in the status,
//   kept in /data across restarts, and taken only on an explicit gesture of
//   the user (`acceptHeld`, a save of the configuration). A drop taken gives
//   the core a negative delta (nothing billed), and the values after it rise
//   from there normally; a jump taken is counted once as consumption;
// - while a jump is held, every value at or above it stays held: the margin
//   growing while nothing is published must never cover it;
// - a value back to the usual rule (the drop or the jump was a glitch) ends
//   the hold.
//
// `indexOfTariffs` checks the two tariffs before their sum reaches the
// guard: a tariff that was above 0 and reads 0, or that drops alone, is a
// glitch of one register, never a drop of the index.
// -----------------------------------------------------------------------------

import { INDEX_MAX_KW, INDEX_SLACK_KWH } from './constants.js';

const HOUR = 3_600_000;

/** Whether `value` may follow `previous` (both `{ value, at }`). */
function follows(previous, value, at) {
  const hours = Math.max(0, at - previous.at) / HOUR;
  return (
    value >= previous.value && value - previous.value <= INDEX_MAX_KW * hours + INDEX_SLACK_KWH
  );
}

const validLast = (last) =>
  last && Number.isFinite(last.value) && last.value > 0 && Number.isFinite(last.at)
    ? { value: last.value, at: last.at }
    : undefined;

const validHeld = (held) =>
  held &&
  (held.direction === 'up' || held.direction === 'down') &&
  [held.from, held.to, held.threshold].every(Number.isFinite)
    ? { direction: held.direction, from: held.from, to: held.to, threshold: held.threshold }
    : undefined;

const isCounter = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * The consumption index of a reading, low + high, or undefined when it must
 * not reach the guard at all:
 * - a tariff missing, not a finite number, or below 0;
 * - the sum at 0;
 * - against `previous` (the tariffs of the last index accepted): a tariff
 *   that was above 0 and reads 0, or a tariff lower while the other is not
 *   (one register glitching). Both lower is a real drop: the guard holds it.
 */
export function indexOfTariffs(low, high, previous) {
  if (!isCounter(low) || !isCounter(high) || low + high <= 0) {
    return undefined;
  }
  if (previous && isCounter(previous.low) && isCounter(previous.high)) {
    if ((previous.low > 0 && low === 0) || (previous.high > 0 && high === 0)) {
      return undefined;
    }
    if (low < previous.low !== high < previous.high) {
      return undefined;
    }
  }
  return low + high;
}

export class IndexGuard {
  /**
   * `last`: the value Gladys already holds (`{ value, at }`), when known.
   * `saved`: the state kept in /data (`state()`), so that a value held back
   * stays held across a restart.
   */
  constructor(last, saved) {
    const kept = validLast(saved?.last);
    const known = validLast(last);
    if (kept && known && kept.value === known.value) {
      // The same value: its OLDEST date, the margin of the next rise counts from it.
      this.last = { value: kept.value, at: Math.min(kept.at, known.at) };
    } else {
      // Otherwise the most recent reference wins.
      this.last = kept && (!known || kept.at >= known.at) ? kept : known;
    }
    /**
     * A value held back until the user accepts it:
     * `{ direction: 'up' | 'down', from, to, threshold }`. For a jump up,
     * every value at or above `threshold` stays held whatever the time.
     */
    this.held = this.last ? validHeld(saved?.held) : undefined;
    this.heldAccepted = false;
  }

  /** What /data keeps: the reference and the value held. */
  state() {
    return { last: this.last ?? null, held: this.held ?? null };
  }

  /** The user accepts the value held (a save of the configuration). */
  acceptHeld() {
    if (this.held) {
      this.heldAccepted = true;
    }
  }

  /** Whether `value`, read at `at`, may be published. A published value becomes the reference. */
  accept(value, at) {
    if (!Number.isFinite(value) || value <= 0) {
      return false;
    }
    if (!this.last) {
      return this.take(value, at);
    }
    if (value === this.last.value) {
      // Unchanged (a frozen reading): published, its date NOT moved.
      this.release();
      return true;
    }
    const up = this.held?.direction === 'up';
    if (up && value >= this.held.threshold) {
      if (this.heldAccepted) {
        return this.take(value, at);
      }
      // Held, however long ago the last value was published.
      this.held = { ...this.held, to: value };
      return false;
    }
    if (follows(this.last, value, at)) {
      return this.take(value, at);
    }
    const direction = value > this.last.value ? 'up' : 'down';
    if (this.heldAccepted && this.held?.direction === direction) {
      return this.take(value, at);
    }
    if (this.held?.direction !== direction) {
      this.heldAccepted = false;
    }
    this.held = {
      direction,
      from: this.last.value,
      to: value,
      threshold: direction === 'up' && up ? Math.min(value, this.held.threshold) : value,
    };
    return false;
  }

  release() {
    this.held = undefined;
    this.heldAccepted = false;
  }

  take(value, at) {
    this.last = { value, at };
    this.release();
    return true;
  }
}

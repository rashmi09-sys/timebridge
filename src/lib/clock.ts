import type { Instant } from '../types';

/**
 * The page's notion of "now". It can be pinned with ?now= for demos and tests,
 * but it keeps advancing with real time so nothing goes stale while the page
 * stays open (the "there now" line, minimum-notice checks at booking time).
 */
export interface Clock {
  now(): Instant;
  /** The instant the page loaded with (stable; used to fetch availability). */
  readonly origin: Instant;
}

export function createClock(origin: Instant, realNow: () => number = Date.now): Clock {
  const loadedAt = realNow();
  return {
    origin,
    now: () => origin + (realNow() - loadedAt),
  };
}

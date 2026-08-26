/**
 * A tiny in-memory, TTL-based cache used to avoid re-spending StayAPI quota on searches
 * that were already done recently.
 *
 * Why this exists: a single "flexible date" search can call StayAPI once per candidate
 * check-in date (up to MAX_WINDOW_DAYS times) plus once to resolve the destination name.
 * With a free-trial quota of only 50-100 one-time requests, that disappears after just a
 * handful of searches. This cache means the SAME destination+date+guest-count combo,
 * searched again by anyone (the same visitor reloading, or a different visitor searching
 * the same popular city/dates) within the TTL window, is served from memory instead of
 * spending another request — at zero cost, for however many times it's re-requested.
 *
 * Deliberately simple: a plain in-memory Map, not a database or Redis. This process is a
 * single Render instance, so that's enough to be effective, and it needs no extra
 * infrastructure. The trade-off: the cache is empty again after a redeploy or after the
 * free-tier instance spins down from inactivity and restarts — the next search after that
 * pays full price again, same as today. That's an acceptable trade for the simplicity.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

/**
 * Returns the cached value for `key` if present and not yet expired, otherwise calls
 * `fetchFn`, caches its result for `ttlMs`, and returns it. Concurrent calls with the same
 * key while a fetch is in flight are NOT de-duplicated (kept simple) — a burst of
 * simultaneous first-time requests for the same key can still each spend one real request.
 */
export async function getOrFetch<T>(key: string, ttlMs: number, fetchFn: () => Promise<T>): Promise<{ value: T; fromCache: boolean }> {
  const existing = store.get(key);
  const now = Date.now();
  if (existing && existing.expiresAt > now) {
    return { value: existing.value as T, fromCache: true };
  }

  const value = await fetchFn();
  store.set(key, { value, expiresAt: now + ttlMs });
  return { value, fromCache: false };
}

/** Current number of live (non-expired) entries — exposed for the /healthz diagnostic. */
export function cacheSize(): number {
  const now = Date.now();
  let count = 0;
  for (const entry of store.values()) {
    if (entry.expiresAt > now) count++;
  }
  return count;
}

/** Wipes every cached entry. Used between unit tests so they don't leak cache state into each other. */
export function clearCache(): void {
  store.clear();
}

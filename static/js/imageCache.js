// static/js/imageCache.js
/**
 * imageCache.js
 *
 * Temporary in-memory image cache for gallery/preview responsiveness.
 *
 * Design goals:
 * - Keep recent images instantly available in preview mode.
 * - Avoid unbounded RAM growth during large sessions.
 * - Avoid duplicate fetches.
 * - Cleanly invalidate when tunnel/session changes.
 */

import { fetchImageBlob } from "./api.js";

const MAX_ENTRIES = 32;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024; // 64 MB
const MAX_SINGLE_BYTES = 24 * 1024 * 1024; // 24 MB

/** @type {Map<string, {url: string, size: number}>} */
const entries = new Map();

/** @type {Map<string, Promise<string>>} */
const inflight = new Map();

/** @type {Set<string>} */
const pinned = new Set();

let totalBytes = 0;
let sessionToken = 0;

function touch(key) {
  const entry = entries.get(key);
  if (!entry) return;

  entries.delete(key);
  entries.set(key, entry);
}

function evict(key) {
  const entry = entries.get(key);
  if (!entry) return;

  totalBytes -= entry.size;
  entries.delete(key);

  try {
    URL.revokeObjectURL(entry.url);
  } catch {
    // Ignore revoke errors.
  }
}

function trim() {
  if (entries.size <= MAX_ENTRIES && totalBytes <= MAX_TOTAL_BYTES) {
    return;
  }

  for (const key of entries.keys()) {
    if (entries.size <= MAX_ENTRIES && totalBytes <= MAX_TOTAL_BYTES) {
      break;
    }

    // Never evict pinned preview images.
    if (pinned.has(key)) {
      continue;
    }

    evict(key);
  }
}

function remember(key, objectUrl, size) {
  const existing = entries.get(key);

  if (existing) {
    totalBytes -= existing.size;

    if (existing.url !== objectUrl) {
      try {
        URL.revokeObjectURL(existing.url);
      } catch {
        // Ignore.
      }
    }

    entries.delete(key);
  }

  entries.set(key, {
    url: objectUrl,
    size,
  });

  totalBytes += size;
  trim();
}

/**
 * Return cached object URL immediately if present.
 * Does not fetch.
 */
export function getIfCached(key) {
  if (!key) return null;

  const entry = entries.get(key);
  if (!entry) return null;

  touch(key);
  return entry.url;
}

/**
 * Get an object URL for the image.
 * Fetches and caches if needed.
 */
export function getCachedObjectUrl(key, url) {
  if (!key || !url) {
    return Promise.reject(new Error("Invalid image key/url."));
  }

  const cached = getIfCached(key);
  if (cached) {
    return Promise.resolve(cached);
  }

  const existing = inflight.get(key);
  if (existing) {
    return existing;
  }

  const token = sessionToken;

  const promise = (async () => {
    const blob = await fetchImageBlob(url);

    // If session changed while loading, discard result.
    if (token !== sessionToken) {
      throw new Error("Image cache session changed.");
    }

    // Avoid caching extremely large images in RAM.
    if (blob.size > MAX_SINGLE_BYTES) {
      throw new Error("Image too large for memory cache.");
    }

    const objectUrl = URL.createObjectURL(blob);
    remember(key, objectUrl, blob.size || 0);
    return objectUrl;
  })();

  inflight.set(key, promise);

  promise
    .catch(() => {
      // Silent cache miss; callers can fall back to direct URL.
    })
    .finally(() => {
      if (inflight.get(key) === promise) {
        inflight.delete(key);
      }
    });

  return promise;
}

/**
 * Fire-and-forget prefetch.
 */
export function prefetch(key, url) {
  if (!key || !url) return;

  if (document.hidden) return;

  if (navigator.connection?.saveData) return;

  getCachedObjectUrl(key, url).catch(() => {
    // Ignore prefetch failures.
  });
}

/**
 * Pin a key so it is not evicted.
 * Useful for the currently inspected image.
 */
export function pin(key) {
  if (!key) return;
  pinned.add(key);
  touch(key);
}

/**
 * Unpin a key.
 */
export function unpin(key) {
  if (!key) return;
  pinned.delete(key);
}

/**
 * Clear all cached images.
 * Call when tunnel changes or session resets.
 */
export function clear() {
  sessionToken += 1;

  for (const entry of entries.values()) {
    try {
      URL.revokeObjectURL(entry.url);
    } catch {
      // Ignore.
    }
  }

  entries.clear();
  inflight.clear();
  pinned.clear();
  totalBytes = 0;
}

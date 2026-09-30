// static/js/api.js
/**
 * api.js – Every HTTP call to the Flask backend lives here.
 * The frontend NEVER talks to ComfyUI directly.
 */

const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * Thin wrapper around fetch that normalises the {"ok":…} envelope.
 * @param {string} url
 * @param {RequestInit} [opts]
 * @returns {Promise<any>} resolved `data` payload
 * @throws {Error} with a human-readable message on failure
 */
async function request(url, opts = {}) {
  let resp;

  try {
    resp = await fetch(url, {
      cache: "no-store",
      ...opts,
    });
  } catch {
    throw new Error("Network error – cannot reach the backend.");
  }

  let body;

  try {
    body = await resp.json();
  } catch {
    throw new Error(`Server returned non-JSON (HTTP ${resp.status}).`);
  }

  if (!resp.ok || body.ok === false) {
    throw new Error(body.error || `HTTP ${resp.status}`);
  }

  return body.data ?? body;
}

function post(url, payload) {
  return request(url, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
}

// ── Public API surface ──────────────────────────────────────────────

export function getHealth(tunnelUrl) {
  const q = tunnelUrl ? `?tunnel_url=${encodeURIComponent(tunnelUrl)}` : "";
  return request(`/api/health${q}`);
}

export function getConfig() {
  return request("/api/config");
}

export function getCheckpoints(tunnelUrl, refresh = false) {
  return post("/api/checkpoints", { tunnel_url: tunnelUrl, refresh });
}

export function getLoras(tunnelUrl, refresh = false) {
  return post("/api/loras", { tunnel_url: tunnelUrl, refresh });
}

export function getVaes(tunnelUrl) {
  return post("/api/vaes", { tunnel_url: tunnelUrl });
}

export function getClips(tunnelUrl) {
  return post("/api/clips", { tunnel_url: tunnelUrl });
}

export function getSamplers(tunnelUrl) {
  return post("/api/samplers", { tunnel_url: tunnelUrl });
}

export function generateImage(settings) {
  return post("/api/generate", settings);
}

export function getHistory(tunnelUrl) {
  return post("/api/history", { tunnel_url: tunnelUrl });
}

export function getQueue(tunnelUrl) {
  return post("/api/queue", { tunnel_url: tunnelUrl });
}

/**
 * Stable identity for a gallery image.
 * Used for keyed rendering and cache lookups.
 */
export function imageKey(img) {
  if (!img) return "";

  const promptId = img.meta?.prompt_id || "";
  const filename = img.filename || "";
  const subfolder = img.subfolder || "";
  const type = img.type || "output";

  return `${promptId}|${filename}|${subfolder}|${type}`;
}

/**
 * Build the proxied image URL.
 *
 * Important:
 * - No random cache-buster.
 * - Optional version tag (`v`) allows safe long-term caching.
 */
export function imageUrl(
  tunnelUrl,
  filename,
  subfolder = "",
  type = "output",
  version = ""
) {
  const p = new URLSearchParams({
    tunnel_url: tunnelUrl,
    filename,
    subfolder,
    type,
  });

  if (version) {
    p.set("v", version);
  }

  return `/api/image?${p.toString()}`;
}

/**
 * Fetch an image as a Blob.
 * Uses HTTP cache aggressively.
 */
export async function fetchImageBlob(url, signal) {
  let resp;

  try {
    resp = await fetch(url, {
      cache: "force-cache",
      signal,
    });
  } catch {
    throw new Error("Network error while fetching image.");
  }

  if (!resp.ok) {
    throw new Error(`Image request failed (HTTP ${resp.status}).`);
  }

  return resp.blob();
}
// ── Civitai search ─────────────────────────────────────────────────────────────
export function getCivitaiSearch(params = {}) {
  const qs = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;

    if (Array.isArray(value)) {
      value.forEach(v => qs.append(key, String(v)));
    } else {
      qs.set(key, String(value));
    }
  });

  const query = qs.toString();
  return request(`/api/civitai/search${query ? `?${query}` : ""}`);
}

export function downloadCivitaiLora(payload) {
  return post("/api/civitai/download", payload);
}

export function getCivitaiDownloadStatus(promptId, tunnelUrl) {
  const q = new URLSearchParams({
    prompt_id: promptId,
    tunnel_url: tunnelUrl,
  });
  return request(`/api/civitai/download/status?${q.toString()}`);
}
// -- Get trigger words function
export function getLoraTriggerWords(tunnelUrl, loraName) {
  return post("/api/loras/trigger-words", {
    tunnel_url: tunnelUrl,
    lora_name: loraName,
  });
}

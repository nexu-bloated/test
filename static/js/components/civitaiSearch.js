// static/js/components/civitaiSearch.js

import * as api from "../api.js";
import state from "../state.js";
import * as ui from "../ui.js";

const els = {};
let sentinelObserver = null;

const CIVITAI_TAGS = [
  "character",
  "style",
  "concept",
  "clothing",
  "base model",
  "background",
  "poses",
  "tool",
  "assets",
  "vehicle",
  "buildings",
  "objects",
  "animal",
  "action"
];

// ── State ─────────────────────────────────────────────────────────────────────

function ensureCivitaiState() {
  if (!state.civitai) {
    state.civitai = {
      searchResults: [],
      downloadLinks: {},
      pendingDownload: null,
      nextCursor: null,
      activeDownloads: {},
      completedDownloads: {},
      selectedTags: [],
      isLoadingMore: false,
      hasSearchedOnce: false,
      currentSearchSignature: ""
    };
  } else {
    if (!Array.isArray(state.civitai.selectedTags)) {
      state.civitai.selectedTags = [];
    }
    if (!state.civitai.downloadLinks) state.civitai.downloadLinks = {};
    if (!state.civitai.activeDownloads) state.civitai.activeDownloads = {};
    if (!state.civitai.completedDownloads) state.civitai.completedDownloads = {};
  }
}

// ── DOM cache ─────────────────────────────────────────────────────────────────

function cacheElements() {
  els.openBtn = document.getElementById("btnCivitaiOpen");
  els.modal = document.getElementById("civitaiSearchModal");
  els.modalBody = els.modal?.querySelector(".nexus-modal-body") || null;
  els.closeBtn = document.getElementById("btnCivitaiClose");
  els.exitBtn = document.getElementById("btnCivitaiExit");
  els.runBtn = document.getElementById("btnCivitaiRun");
  els.query = document.getElementById("civitaiQuery");
  els.type = document.getElementById("civitaiType");
  els.baseModel = document.getElementById("civitaiBaseModel");
  els.sort = document.getElementById("civitaiSort");
  els.nsfw = document.getElementById("civitaiNsfw");
  els.tags = document.getElementById("civitaiTags");
  els.results = document.getElementById("civitaiResults");
  els.sentinel = document.getElementById("civitaiSentinel");
  els.loadMoreStatus = document.getElementById("civitaiLoadMoreStatus");
  els.status = document.getElementById("civitaiStatus");
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initCivitaiSearch() {
  ensureCivitaiState();
  cacheElements();

  if (!els.openBtn || !els.modal) return;

  els.openBtn.addEventListener("click", openSearch);
  els.closeBtn?.addEventListener("click", closeSearch);
  els.exitBtn?.addEventListener("click", closeSearch);
  els.runBtn?.addEventListener("click", searchCivitai);

  els.query?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchCivitai();
    }
  });

  els.modal.addEventListener("click", (event) => {
    if (event.target === els.modal) {
      closeSearch();
    }
  });

  document.addEventListener(
    "keydown",
    (event) => {
      if (!ui.isOpen(els.modal)) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeSearch();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        searchCivitai();
      }
    },
    true
  );

  renderTagChips();
}

// ── Tags ──────────────────────────────────────────────────────────────────────

function renderTagChips() {
  const container = els.tags;
  if (!container) return;

  container.replaceChildren();

  CIVITAI_TAGS.forEach((tag) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nexus-civitai-tag nexus-btn nexus-btn-ghost";
    btn.textContent = tag;
    btn.dataset.tag = tag;

    if (state.civitai.selectedTags.includes(tag)) {
      btn.classList.add("is-active");
    }

    btn.addEventListener("click", () => {
      toggleTag(tag);
    });

    container.appendChild(btn);
  });
}

function toggleTag(tag) {
  const idx = state.civitai.selectedTags.indexOf(tag);

  if (idx > -1) {
    state.civitai.selectedTags.splice(idx, 1);
  } else {
    state.civitai.selectedTags.push(tag);
  }

  renderTagChips();
}

// ── Modal helpers ─────────────────────────────────────────────────────────────

function openSearch() {
  ui.openModal(els.modal);
  els.query?.focus();
}

function closeSearch() {
  ui.closeModal(els.modal);
}

// ── UI state ──────────────────────────────────────────────────────────────────

function setLoading(loading) {
  if (els.runBtn) {
    els.runBtn.disabled = loading;
    els.runBtn.textContent = loading ? "Searching…" : "Search";
  }

  [els.query, els.type, els.baseModel, els.sort, els.nsfw].forEach((el) => {
    if (el) el.disabled = loading;
  });
}

function setStatus(message) {
  if (els.status) {
    els.status.textContent = message || "";
  }
}

function updateLoadMoreStatus(status) {
  if (!els.loadMoreStatus) return;

  els.loadMoreStatus.className = "nexus-civitai-load-more";
  els.loadMoreStatus.onclick = null;

  if (status === "loading") {
    els.loadMoreStatus.textContent = "◌ Loading more…";
    els.loadMoreStatus.classList.add("is-loading");
  } else if (status === "end") {
    els.loadMoreStatus.textContent = "◬ No more results.";
  } else if (status === "empty") {
    els.loadMoreStatus.textContent = "";
  } else if (status === "error") {
    els.loadMoreStatus.textContent = "⚠ Failed to load more. Click to retry.";
    els.loadMoreStatus.classList.add("is-error");
    els.loadMoreStatus.onclick = () => {
      els.loadMoreStatus.onclick = null;
      loadMoreCivitai();
    };
  } else {
    els.loadMoreStatus.textContent = "";
  }
}

// ── Search ────────────────────────────────────────────────────────────────────

function getSearchSignature(params) {
  return JSON.stringify({
    query: params.query,
    types: params.types,
    baseModels: params.baseModels,
    sort: params.sort,
    tags: state.civitai.selectedTags.slice().sort(),
    nsfw: params.nsfw
  });
}

async function searchCivitai() {
  ensureCivitaiState();

  state.civitai.nextCursor = null;
  state.civitai.isLoadingMore = false;
  state.civitai.hasSearchedOnce = false;

  setLoading(true);
  setStatus("Searching Civitai…");
  updateLoadMoreStatus("idle");

  const params = {
    query: els.query?.value.trim() || "",
    types: els.type?.value || "LORA",
    baseModels: els.baseModel?.value || "",
    sort: els.sort?.value || "",
    tag: state.civitai.selectedTags,
    limit: 24
  };

  if (els.nsfw?.checked) params.nsfw = "true";

  const signature = getSearchSignature(params);
  state.civitai.currentSearchSignature = signature;

  try {
    const data = await api.getCivitaiSearch(params);

    if (state.civitai.currentSearchSignature !== signature) return;

    const items = Array.isArray(data?.items) ? data.items : [];

    state.civitai.searchResults = items;
    state.civitai.nextCursor = data?.metadata?.nextCursor || null;
    state.civitai.hasSearchedOnce = true;

    renderResults(items, true);

    setStatus(items.length ? `${items.length} result(s).` : "No results.");

    if (!state.civitai.nextCursor || items.length === 0) {
      updateLoadMoreStatus(items.length === 0 ? "empty" : "end");
    } else {
      updateLoadMoreStatus("idle");
    }

    setupObserver();
  } catch (error) {
    if (state.civitai.currentSearchSignature === signature) {
      renderResults([], true);
      setStatus(error?.message || "Search failed.");
      ui.toast(error?.message || "Civitai search failed.", "danger");
      updateLoadMoreStatus("error");
    }
  } finally {
    if (state.civitai.currentSearchSignature === signature) {
      setLoading(false);
    }
  }
}

async function loadMoreCivitai() {
  if (state.civitai.isLoadingMore || !state.civitai.nextCursor) return;

  const currentSignature = state.civitai.currentSearchSignature;

  state.civitai.isLoadingMore = true;
  updateLoadMoreStatus("loading");

  const params = {
    query: els.query?.value.trim() || "",
    types: els.type?.value || "LORA",
    baseModels: els.baseModel?.value || "",
    sort: els.sort?.value || "",
    tag: state.civitai.selectedTags,
    limit: 24,
    cursor: state.civitai.nextCursor
  };

  if (els.nsfw?.checked) params.nsfw = "true";

  try {
    const data = await api.getCivitaiSearch(params);

    if (state.civitai.currentSearchSignature !== currentSignature) {
      return;
    }

    const items = Array.isArray(data?.items) ? data.items : [];

    state.civitai.nextCursor = data?.metadata?.nextCursor || null;
    state.civitai.searchResults = [
      ...(state.civitai.searchResults || []),
      ...items
    ];

    if (items.length > 0) {
      renderResults(items, false);
    }

    if (!state.civitai.nextCursor || items.length === 0) {
      updateLoadMoreStatus("end");
    } else {
      updateLoadMoreStatus("idle");
    }
  } catch (error) {
    if (state.civitai.currentSearchSignature === currentSignature) {
      updateLoadMoreStatus("error");
      ui.toast(error?.message || "Failed to load more results.", "danger");
    }
  } finally {
    if (state.civitai.currentSearchSignature === currentSignature) {
      state.civitai.isLoadingMore = false;
    }
  }
}

// ── Infinite scroll ───────────────────────────────────────────────────────────

function setupObserver() {
  if (sentinelObserver) {
    sentinelObserver.disconnect();
  }

  const sentinel = els.sentinel;
  if (!sentinel) return;

  const root = els.modalBody || null;

  sentinelObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (
          entry.isIntersecting &&
          state.civitai.hasSearchedOnce &&
          !state.civitai.isLoadingMore &&
          state.civitai.nextCursor
        ) {
          loadMoreCivitai();
        }
      });
    },
    {
      root,
      rootMargin: "200px",
      threshold: 0
    }
  );

  sentinelObserver.observe(sentinel);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderResults(items, replace = true) {
  if (!els.results) return;

  ensureCivitaiState();

  if (replace) {
    state.civitai.downloadLinks = {};
    els.results.replaceChildren();
  }

  if (!items.length && replace) {
    const empty = document.createElement("div");
    empty.className = "nexus-civitai-empty";
    empty.textContent = "◬ No models found";
    els.results.appendChild(empty);
    return;
  }

  const showNsfw = Boolean(els.nsfw?.checked);
  const fragment = document.createDocumentFragment();
  const seenKeys = new Set();

  items.forEach((item) => {
    const { version, file, downloadUrl } = getCardDownloadData(item);
    const key = makeDownloadKey(item, version, file, downloadUrl);

    if (seenKeys.has(key)) {
      console.warn("[Civitai] Skipping duplicate result key:", key, item?.name);
      return;
    }

    if (!replace && els.results.querySelector(keySelector(key))) {
      return;
    }

    seenKeys.add(key);
    fragment.appendChild(createResultCard(item, showNsfw, key));
  });

  const emptyMsg = els.results.querySelector(".nexus-civitai-empty");
  if (emptyMsg) emptyMsg.remove();

  els.results.appendChild(fragment);
}

function inferCivitaiDestination(linkLike) {
  const type = String(linkLike?.civitaiType || "").toLowerCase();
  if (["lora", "locon", "lycoris", "dora"].some((kind) => type.includes(kind))) return "loras";
  if (type.includes("checkpoint")) {
    const haystack = [linkLike.baseModel, linkLike.modelName, linkLike.versionName, linkLike.fileName]
      .filter(Boolean).join(" ").toLowerCase();
    return haystack.includes("anima") ? "diffusion_models" : "checkpoints";
  }
  return "loras";
}

function createResultCard(item, showNsfw, key) {
  const {
    version,
    file,
    fallbackDownloadUrl,
    downloadUrl
  } = getCardDownloadData(item);

  const downloadKey = key || makeDownloadKey(item, version, file, downloadUrl);

  const creatorName =
    typeof item.creator === "string"
      ? item.creator
      : item.creator?.username || "Unknown creator";

  const link = {
    key: downloadKey,
    source: "civitai",
    modelId: item?.id ?? null,
    modelVersionId: version?.id ?? null,
    modelName: item?.name || "",
    versionName: version?.name || "",
    baseModel: version?.baseModel || "",
    civitaiType: item?.type || "",
    fileName: file?.name || "",
    fileType: file?.type || "",
    fileSizeKB: file?.sizeKB ?? null,
    downloadUrl,
    fallbackDownloadUrl,
    targetFolder: inferCivitaiDestination({
      civitaiType: item?.type, baseModel: version?.baseModel,
      modelName: item?.name, versionName: version?.name, fileName: file?.name
    }),
    pageUrl: item?.id != null ? `https://civitai.red/models/${item.id}` : "",
    savedAt: new Date().toISOString()
  };

  const existing = state.civitai.downloadLinks[downloadKey];
  if (existing && existing.downloadUrl !== link.downloadUrl) {
    console.warn("[Civitai] Duplicate download key with different URL detected.", {
      downloadKey,
      existing,
      incoming: link
    });
  }

  state.civitai.downloadLinks[downloadKey] = link;

  const card = document.createElement("article");
  card.className = "nexus-panel nexus-civitai-card";
  card.dataset.downloadKey = downloadKey;

  const thumbUrl = item.images?.[0]?.url || version?.images?.[0]?.url || "";

  if (thumbUrl) {
    const img = document.createElement("img");
    img.className = "nexus-civitai-thumb";
    img.src = thumbUrl;
    img.alt = item.name || "Civitai model";
    img.loading = "lazy";
    img.decoding = "async";

    if (item.nsfw && !showNsfw) {
      img.classList.add("is-nsfw");
    }

    card.appendChild(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "nexus-civitai-thumb nexus-civitai-thumb-empty";
    placeholder.textContent = "◬";
    card.appendChild(placeholder);
  }

  const name = document.createElement("div");
  name.className = "nexus-civitai-name";
  name.title = item.name || "";
  name.textContent = item.name || "Unnamed model";

  const meta = document.createElement("div");
  meta.className = "nexus-civitai-meta";
  meta.textContent =
    [version?.baseModel, item.type].filter(Boolean).join(" · ") || "—";

  meta.textContent = [item.type, version?.baseModel, `to ${link.targetFolder}`]
    .filter(Boolean)
    .join(" · ");

  const creator = document.createElement("div");
  creator.className = "nexus-civitai-creator";
  creator.textContent = creatorName;

  const actions = document.createElement("div");
  actions.className = "nexus-civitai-actions";

  const downloadBtn = document.createElement("button");
  downloadBtn.type = "button";
  downloadBtn.className = "nexus-btn nexus-btn-ghost nexus-civitai-download";
  downloadBtn.textContent = "⬇ Download";
  downloadBtn.title = downloadUrl ? `Download to ${link.targetFolder}` : "No download URL available";
  downloadBtn.disabled = !downloadUrl;
  downloadBtn.dataset.noUrl = downloadUrl ? "false" : "true";

  // Restore active/completed download state if applicable.
  if (state.civitai.completedDownloads[downloadKey]) {
    updateDownloadButton(downloadBtn, "completed");
  } else if (state.civitai.activeDownloads[downloadKey]) {
    updateDownloadButton(
      downloadBtn,
      state.civitai.activeDownloads[downloadKey].status || "pending"
    );
  }

  // IMPORTANT:
  // Capture the exact link object for this card.
  // Do NOT look it up later from a shared map only by key.
  downloadBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    handleDownload(link, downloadBtn);
  });

  const pageBtn = document.createElement("a");
  pageBtn.className = "nexus-btn nexus-btn-ghost";
  pageBtn.textContent = "↗";
  pageBtn.title = "Open on Civitai";
  pageBtn.target = "_blank";
  pageBtn.rel = "noreferrer";

  if (link.pageUrl) {
    pageBtn.href = link.pageUrl;
  } else {
    pageBtn.href = "#";
    pageBtn.setAttribute("aria-disabled", "true");
  }

  actions.appendChild(downloadBtn);
  actions.appendChild(pageBtn);

  card.appendChild(name);
  card.appendChild(meta);
  card.appendChild(creator);
  card.appendChild(actions);

  return card;
}

// ── Data helpers ──────────────────────────────────────────────────────────────

function getCardDownloadData(item) {
  const version = Array.isArray(item?.modelVersions)
    ? item.modelVersions[0]
    : null;

  const file = pickFile(version);

  const fallbackDownloadUrl = version?.id
    ? `https://civitai.com/api/download/models/${version.id}`
    : "";

  const downloadUrl = normalizeDownloadUrl(
    file?.downloadUrl || fallbackDownloadUrl
  );

  return {
    version,
    file,
    fallbackDownloadUrl,
    downloadUrl
  };
}

function pickFile(version) {
  const files = Array.isArray(version?.files) ? version.files : [];
  if (!files.length) return null;

  const isModelExtension = (name) =>
    /\.(safetensors|pt|ckpt|bin)$/i.test(name || "");

  return (
    files.find(
      (f) => f?.primary && f?.type === "Model" && isModelExtension(f.name)
    ) ||
    files.find((f) => f?.type === "Model" && isModelExtension(f.name)) ||
    files.find((f) => f?.primary && isModelExtension(f.name)) ||
    files.find((f) => isModelExtension(f.name)) ||
    files.find((f) => f?.primary) ||
    files.find((f) => f?.type === "Model") ||
    files[0] ||
    null
  );
}

function normalizeDownloadUrl(url) {
  if (!url) return "";
  if (url.startsWith("/")) return `https://civitai.red${url}`;
  return url;
}

function safeKeyPart(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return String(value);
}

function makeDownloadKey(item, version, file, downloadUrl) {
  const modelId = safeKeyPart(item?.id ?? item?.modelId, "model");
  const versionId = safeKeyPart(version?.id, "version");
  const fileId = safeKeyPart(file?.id || file?.name || downloadUrl, "file");

  return `${modelId}:${versionId}:${fileId}`;
}

function keySelector(key) {
  const escaped = String(key)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');

  return `[data-download-key="${escaped}"]`;
}

// ── Download flow ─────────────────────────────────────────────────────────────

async function handleDownload(link, btn) {
  ensureCivitaiState();

  if (!state.tunnelUrl || !state.connected) {
    ui.toast("Connect the uplink before downloading LoRAs.", "danger");
    return;
  }

  if (!link?.downloadUrl) {
    ui.toast("No download URL available.", "danger");
    return;
  }

  const downloadKey = link.key;

  if (!downloadKey) {
    ui.toast("Invalid download metadata.", "danger");
    return;
  }

  if (state.civitai.activeDownloads[downloadKey]) return;

  await startDownload(link, btn, false);
}

async function startDownload(link, btn, overwrite = false) {
  const downloadKey = link.key;

  state.civitai.activeDownloads[downloadKey] = {
    status: "queued",
    button: btn
  };

  updateDownloadButtonsForKey(downloadKey, "queued", btn);

  const payload = {
    tunnel_url: state.tunnelUrl,
    download_url: link.downloadUrl,
    fallback_download_url: link.fallbackDownloadUrl,
    model_id: link.modelId,
    model_version_id: link.modelVersionId,
    model_name: link.modelName,
    version_name: link.versionName,
    file_name: link.fileName,
    file_size_kb: link.fileSizeKB,
    overwrite,
    model_type: link.civitaiType || "",
    base_model: link.baseModel || "",
    destination_hint: link.targetFolder || ""
  };

  try {
    const result = await api.downloadCivitaiLora(payload);

    if (result.status === "already_exists") {
      state.civitai.activeDownloads[downloadKey] = null;
      showOverwriteModal(link, btn);
      return;
    }

    if (result.status === "queued" && result.prompt_id) {
      state.civitai.activeDownloads[downloadKey] = {
        status: "pending",
        promptId: result.prompt_id,
        filename: result.filename,
        button: btn,
        modelType: result.model_type || link.civitaiType || "",
        targetFolder: result.target_folder || link.targetFolder || "loras"
      };

      updateDownloadButtonsForKey(downloadKey, "pending", btn);
      pollDownloadStatus(downloadKey, result.prompt_id);
    } else {
      throw new Error("Unexpected response from server.");
    }
  } catch (error) {
    state.civitai.activeDownloads[downloadKey] = null;
    updateDownloadButtonsForKey(downloadKey, "error", btn);
    ui.toast(error?.message || "Failed to start download.", "danger");
  }
}

function updateDownloadButton(btn, status) {
  if (!btn) return;

  const noUrl = btn.dataset.noUrl === "true";

  btn.classList.remove("is-success", "is-error");

  if (status === "queued") {
    btn.textContent = "⬇ Queued…";
    btn.disabled = true;
  } else if (status === "pending" || status === "running") {
    btn.textContent = "⬇ Downloading…";
    btn.disabled = true;
  } else if (status === "completed") {
    btn.textContent = "✓ Downloaded";
    btn.disabled = true;
    btn.classList.add("is-success");
  } else if (status === "error") {
    btn.textContent = "⚠ Failed";
    btn.disabled = noUrl;
    btn.classList.add("is-error");
  } else {
    btn.textContent = "⬇ Download";
    btn.disabled = noUrl;
  }
}

function updateDownloadButtonsForKey(downloadKey, status, extraBtn = null) {
  if (extraBtn) {
    updateDownloadButton(extraBtn, status);
  }

  if (!els.results || !downloadKey) return;

  const buttons = els.results.querySelectorAll(
    `${keySelector(downloadKey)} .nexus-civitai-download`
  );

  buttons.forEach((btn) => updateDownloadButton(btn, status));
}

async function pollDownloadStatus(downloadKey, promptId) {
  const maxAttempts = 600;
  let attempts = 0;

  const interval = setInterval(async () => {
    const active = state.civitai.activeDownloads?.[downloadKey];

    if (!active) {
      clearInterval(interval);
      return;
    }

    attempts++;

    if (attempts > maxAttempts) {
      clearInterval(interval);

      state.civitai.activeDownloads[downloadKey] = null;
      updateDownloadButtonsForKey(downloadKey, "error");

      ui.toast(
        "Download polling timed out. It may still be running on the remote machine.",
        "warning"
      );

      return;
    }

    try {
      const statusRes = await api.getCivitaiDownloadStatus(
        promptId,
        state.tunnelUrl
      );

      const status = statusRes.status;

      if (status === "pending" || status === "running") {
        updateDownloadButtonsForKey(downloadKey, status);
      } else if (status === "completed" || status === "already_exists") {
        clearInterval(interval);

        const completedActive = state.civitai.activeDownloads?.[downloadKey] || {};
        const modelType = String(completedActive.modelType || "").toLowerCase();
        const targetFolder = statusRes.destination || completedActive.targetFolder || "";

        state.civitai.activeDownloads[downloadKey] = null;
        state.civitai.completedDownloads[downloadKey] = true;

        updateDownloadButtonsForKey(downloadKey, "completed");

        ui.toast(
          `Successfully downloaded ${statusRes.filename || "model"}${targetFolder ? ` to ${targetFolder}` : ""}.`,
          "success"
        );

        if (modelType.includes("checkpoint") || targetFolder === "checkpoints" || targetFolder === "diffusion_models") {
          await refreshCheckpointList();
        } else if (modelType || targetFolder) {
          await refreshLoraList();
        } else {
          await Promise.all([refreshLoraList(), refreshCheckpointList()]);
        }
      } else if (status === "failed") {
        clearInterval(interval);

        state.civitai.activeDownloads[downloadKey] = null;
        updateDownloadButtonsForKey(downloadKey, "error");

        ui.toast(
          statusRes.error || "Download failed on remote machine.",
          "danger"
        );
      }
    } catch (err) {
      console.warn("Poll error:", err);
    }
  }, 2000);

  if (state.civitai.activeDownloads[downloadKey]) {
    state.civitai.activeDownloads[downloadKey].interval = interval;
  } else {
    clearInterval(interval);
  }
}

// ── LoRA list refresh ─────────────────────────────────────────────────────────

async function refreshLoraList() {
  try {
    const res = await api.getLoras(state.tunnelUrl, true);
    const newLoras = res.loras || [];
    state._loraNames = newLoras;

    document.querySelectorAll(".nexus-lora-row select").forEach((sel) => {
      const currentVal = sel.value;

      sel.innerHTML = '<option value="">-- LoRA --</option>';

      newLoras.forEach((name) => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
      });

      if (newLoras.includes(currentVal)) {
        sel.value = currentVal;
      }
    });
  } catch (err) {
    console.error("Failed to refresh LoRA list:", err);
  }
}

async function refreshCheckpointList() {
  try {
    const res = await api.getCheckpoints(state.tunnelUrl, true);
    const checkpoints = res.checkpoints || [];
    const select = ui.els.selCheckpoint;
    const currentValue = select?.value || "";
    ui.fillCheckpoints(checkpoints, currentValue);
    if (select && !select.value && checkpoints.length) select.value = checkpoints[0];
  } catch (err) {
    console.error("Failed to refresh checkpoint list:", err);
  }
}

// ── Overwrite modal ───────────────────────────────────────────────────────────

function showOverwriteModal(link, btn) {
  const downloadKey = link?.key;

  const backdrop = document.createElement("div");
  backdrop.className = "nexus-modal-backdrop is-open";

  const dialog = document.createElement("div");
  dialog.className = "nexus-modal";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");

  const header = document.createElement("div");
  header.className = "nexus-modal-header";

  const title = document.createElement("h2");
  title.className = "nexus-modal-title";
  title.textContent = "File Already Exists";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "nexus-btn nexus-btn-ghost btn-cancel";
  closeBtn.textContent = "✕";

  header.appendChild(title);
  header.appendChild(closeBtn);

  const body = document.createElement("div");
  body.className = "nexus-modal-body";

  const p1 = document.createElement("p");
  p1.appendChild(document.createTextNode("The file "));

  const strong = document.createElement("strong");
  strong.textContent = link?.fileName || "file";
  p1.appendChild(strong);

  p1.appendChild(
    document.createTextNode(" already exists on the remote machine.")
  );

  const p2 = document.createElement("p");
  p2.textContent = "Do you want to overwrite it?";

  body.appendChild(p1);
  body.appendChild(p2);

  const actions = document.createElement("div");
  actions.className = "nexus-modal-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "nexus-btn nexus-btn-ghost btn-cancel";
  cancelBtn.textContent = "Cancel";

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "nexus-btn btn-confirm";
  confirmBtn.textContent = "Overwrite";

  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);

  dialog.appendChild(header);
  dialog.appendChild(body);
  dialog.appendChild(actions);

  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  const closeModal = (resetButton = true) => {
    backdrop.classList.remove("is-open");

    setTimeout(() => {
      backdrop.remove();
    }, 200);

    if (resetButton && downloadKey) {
      updateDownloadButtonsForKey(downloadKey, "idle", btn);
    }
  };

  confirmBtn.addEventListener("click", async () => {
    closeModal(false);
    await startDownload(link, btn, true);
  });

  [closeBtn, cancelBtn].forEach((b) => {
    b.addEventListener("click", () => closeModal(true));
  });

  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) {
      closeModal(true);
    }
  });
}

// static/js/ui.js
/**
ui.js – DOM reads/writes only.
No fetch calls and no business state ownership.
*/
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const FOCUSABLE_SELECTOR =
'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export const els = {
  // header / quick settings
  queueLabel: $("#queueLabel"),
  statusDot: $("#statusDot"),
  statusLabel: $("#statusLabel"),
  btnExpandEditor: $("#btnExpandEditor"),
  workspaceGrid: $("#workspaceGrid"),
  selResolution: $("#selResolution"),
  selSampler: $("#selSampler"),
  selScheduler: $("#selScheduler"),
  btnSeedRandom: $("#btnSeedRandom"),
  btnSeedFixed: $("#btnSeedFixed"),
  btnSeedValue: $("#btnSeedValue"),
  rangeBatch: $("#rangeBatch"),
  batchVal: $("#batchVal"),
  btnGenerate: $("#btnGenerate"),
  // sidebar
  tunnelUrl: $("#tunnelUrl"),
  btnConnect: $("#btnConnect"),
  selCheckpoint: $("#selCheckpoint"),
  selVae: $("#selVae"),
  selClip: $("#selClip"),

  modelModeSwitch: $("#modelModeSwitch"),
  btnAnimaBase: $("#btnAnimaBase"),
  btnAnima29: $("#btnAnima29"),
  anima29Notice: $("#anima29Notice"),

  btnAddLora: $("#btnAddLora"),
  loraContainer: $("#loraContainer"),
  posPrompt: $("#posPrompt"),
  negPrompt: $("#negPrompt"),
  posCount: $("#posCount"),
  negCount: $("#negCount"),
  rangeSteps: $("#rangeSteps"),
  stepsVal: $("#stepsVal"),
  rangeCfg: $("#rangeCfg"),
  cfgVal: $("#cfgVal"),
  hiresToggle: $("#hiresToggle"),
  hiresControls: $("#hiresControls"),
  rangeHiresSteps: $("#rangeHiresSteps"),
  hiresStepsVal: $("#hiresStepsVal"),
  selHiresSampler: $("#selHiresSampler"),
  rangeHiresCfg: $("#rangeHiresCfg"),
  hiresCfgVal: $("#hiresCfgVal"),
  rangeHiresDenoise: $("#rangeHiresDenoise"),
  hiresDenoiseVal: $("#hiresDenoiseVal"),
  rangeHiresSharpen: $("#rangeHiresSharpen"),
  hiresSharpenVal: $("#hiresSharpenVal"),
  // gallery
  galleryGrid: $("#galleryGrid"),
  btnNewest: $("#btnNewest"),
  btnOldest: $("#btnOldest"),
  btnSync: $("#btnSync"),
  dropZone: $("#dropZone"),
  // custom resolution modal
  customResModal: $("#customResModal"),
  customWidth: $("#customWidth"),
  customHeight: $("#customHeight"),
  customResError: $("#customResError"),
  btnCustomConfirm: $("#btnCustomConfirm"),
  btnCustomCancel: $("#btnCustomCancel"),
  btnCustomClose: $("#btnCustomClose"),
  // seed modal
  seedModal: $("#seedModal"),
  seedInput: $("#seedInput"),
  seedError: $("#seedError"),
  btnSeedConfirm: $("#btnSeedConfirm"),
  btnSeedCancel: $("#btnSeedCancel"),
  btnSeedClose: $("#btnSeedClose"),
  // inspect modal
  inspectModal: $("#inspectModal"),
  inspectImg: $("#inspectImg"),
  btnInspectDownload: $("#btnInspectDownload"),
  btnInspectRemix: $("#btnInspectRemix"),
  btnInspectCopyPrompt: $("#btnInspectCopyPrompt"),
  btnInspectCopySeed: $("#btnInspectCopySeed"),
  btnInspectClose: $("#btnInspectClose"),
  btnInspectPrev: $("#btnInspectPrev"),
  btnInspectNext: $("#btnInspectNext"),
  inspectCounter: $("#inspectCounter"),
  inspectFilename: $("#inspectFilename"),
  // remix modal
  remixModal: $("#remixModal"),
  remixBody: $("#remixBody"),
  btnRemixApply: $("#btnRemixApply"),
  btnRemixClose: $("#btnRemixClose"),
  btnRemixClose2: $("#btnRemixClose2"),
  // toasts
  toastStack: $("#toastStack"),
};

function safeText(el, text) {
  if (el) el.textContent = text;
}

// ── status ──────────────────────────────────────────────────────────
export function setConnectionStatus(online) {
  if (els.statusDot) {
    els.statusDot.className =
      "nexus-status-dot" + (online ? " nexus-status-dot--online" : "");
  }
  safeText(els.statusLabel, online ? "Online" : "Offline");
}

export function setQueueLabel(running, pending) {
  safeText(els.queueLabel, `Queue: ${(running || 0) + (pending || 0)}`);
}

// ── generate button ─────────────────────────────────────────────────
export function setGenerating(active) {
  if (!els.btnGenerate) return;
  els.btnGenerate.disabled = active;
  els.btnGenerate.classList.toggle("is-generating", active);
  els.btnGenerate.setAttribute("aria-busy", String(active));
  els.btnGenerate.textContent = active ? "◌ GENERATING…" : "⚡ GENERATE ⚡";
}

// ── range fill ──────────────────────────────────────────────────────
export function updateRangeFill(input) {
  if (!input) return;
  const min = parseFloat(input.min) || 0;
  const max = parseFloat(input.max) || 100;
  const val = parseFloat(input.value) || 0;
  const pct = ((val - min) / (max - min)) * 100;
  input.style.setProperty("--range-pct", `${pct}%`);
}

// ── select helpers ──────────────────────────────────────────────────
export function fillSelect(select, items, placeholder, selectedValue) {
  if (!select) return;
  select.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = placeholder;
  select.appendChild(ph);
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = item;
    opt.textContent = item;
    select.appendChild(opt);
  }
  if (selectedValue && items.includes(selectedValue)) {
    select.value = selectedValue;
  } else {
    select.selectedIndex = 0;
  }
}

export function fillCheckpoints(list, selected) {
  fillSelect(els.selCheckpoint, list || [], "-- Select Checkpoint --", selected);
}

export function fillVaes(list, selected) {
  fillSelect(els.selVae, list || [], "-- Select VAE --", selected);
}

export function fillClips(list, selected) {
  fillSelect(els.selClip, list || [], "-- Select CLIP --", selected);
}

export function fillSamplers(
  samplers,
  schedulers,
  selectedSampler,
  selectedScheduler
) {
  fillSelect(els.selSampler, samplers || [], "-- Sampler --", selectedSampler);
  fillSelect(
    els.selScheduler,
    schedulers || [],
    "-- Scheduler --",
    selectedScheduler
  );
}

/**
Select a value, adding a clearly-labelled option when it is not loaded.
*/
export function selectOrAddOption(select, value, suffix = " (Remixed)") {
  if (!select || !value) return;
  const exists = Array.from(select.options).some(
    (option) => option.value === value
  );
  if (!exists) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = `${value}${suffix}`;
    select.appendChild(option);
  }
  select.value = value;
}

function resolutionLabel(value) {
  const [w, h] = String(value).split("x");
  return `${w} × ${h}`;
}

export function fillResolutionSelect(
  presets,
  customResolutions,
  selectedValue
) {
  const select = els.selResolution;
  if (!select) return;
  select.innerHTML = "";
  const seen = new Set();
  for (const preset of presets) {
    const opt = document.createElement("option");
    opt.value = preset.value;
    opt.textContent = preset.label;
    select.appendChild(opt);
    seen.add(preset.value);
  }
  for (const value of customResolutions || []) {
    if (!seen.has(value)) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = resolutionLabel(value);
      select.appendChild(opt);
      seen.add(value);
    }
  }
  if (
    selectedValue &&
    selectedValue !== "custom" &&
    !seen.has(selectedValue)
  ) {
    const opt = document.createElement("option");
    opt.value = selectedValue;
    opt.textContent = resolutionLabel(selectedValue);
    select.appendChild(opt);
    seen.add(selectedValue);
  }
  const customOpt = document.createElement("option");
  customOpt.value = "custom";
  customOpt.textContent = "Custom…";
  select.appendChild(customOpt);
  if (selectedValue && seen.has(selectedValue)) {
    select.value = selectedValue;
  }
}

// ── state sync ──────────────────────────────────────────────────────
export function updateSeedUI(seedMode, fixedSeed) {
  const isFixed = seedMode === "fixed";
  if (els.btnSeedRandom) {
    els.btnSeedRandom.classList.toggle("is-active", !isFixed);
    els.btnSeedRandom.setAttribute("aria-pressed", String(!isFixed));
  }
  if (els.btnSeedFixed) {
    els.btnSeedFixed.classList.toggle("is-active", isFixed);
    els.btnSeedFixed.setAttribute("aria-pressed", String(isFixed));
  }
  if (els.btnSeedValue) {
    els.btnSeedValue.disabled = !isFixed;
    els.btnSeedValue.textContent =
      isFixed && fixedSeed > 0 ? String(fixedSeed) : "—";
  }
}

export function updateBatchUI(batchSize) {
  if (els.rangeBatch) {
    els.rangeBatch.value = String(batchSize);
    els.rangeBatch.setAttribute("aria-valuetext", String(batchSize));
    updateRangeFill(els.rangeBatch);
  }
  safeText(els.batchVal, String(batchSize));
}

function formatCfg(value) {
  return Number(value).toFixed(1);
}

export function syncControlsFromState(state, presets) {
  fillResolutionSelect(presets, state.customResolutions, state.resolution);
  if (els.selSampler) {
    const hasSampler = Array.from(els.selSampler.options).some(
      (o) => o.value === state.sampler
    );
    if (hasSampler) els.selSampler.value = state.sampler;
  }
  if (els.selScheduler) {
    const hasScheduler = Array.from(els.selScheduler.options).some(
      (o) => o.value === state.scheduler
    );
    if (hasScheduler) els.selScheduler.value = state.scheduler;
  }
  if (els.rangeSteps) {
    els.rangeSteps.value = String(state.steps);
    updateRangeFill(els.rangeSteps);
  }
  safeText(els.stepsVal, String(state.steps));
  if (els.rangeCfg) {
    els.rangeCfg.value = String(state.cfg);
    updateRangeFill(els.rangeCfg);
  }
  safeText(els.cfgVal, formatCfg(state.cfg));
  updateBatchUI(state.batchSize);
  updateSeedUI(state.seedMode, state.fixedSeed);
  setExpanded(state.expanded);
}

// ── expand editor ───────────────────────────────────────────────────
export function setExpanded(expanded) {
  if (els.workspaceGrid) {
    els.workspaceGrid.classList.toggle("nexus-editor-expanded", expanded);
  }
  if (els.btnExpandEditor) {
    els.btnExpandEditor.setAttribute("aria-pressed", String(expanded));
    els.btnExpandEditor.textContent = expanded
      ? "⤢ Collapse Editor"
      : "⤢ Expand Editor";
  }
}

// ── modals ──────────────────────────────────────────────────────────
export function isOpen(backdrop) {
  return !!(backdrop && backdrop.classList.contains("is-open"));
}

export function openModal(backdrop) {
  if (!backdrop) return;
  backdrop._lastFocus = document.activeElement;
  backdrop.classList.add("is-open");
  backdrop.setAttribute("aria-hidden", "false");
  const container =
    backdrop.querySelector('[role="dialog"]') || backdrop.firstElementChild;
  const getFocusables = () =>
    Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
      (el) => !el.disabled
    );
  const initial =
    container.querySelector("[data-autofocus]") || getFocusables()[0];
  if (initial) {
    requestAnimationFrame(() => initial.focus());
  }
  if (backdrop._trapHandler) {
    backdrop.removeEventListener("keydown", backdrop._trapHandler);
  }
  backdrop._trapHandler = (e) => {
    if (e.key !== "Tab") return;
    const items = getFocusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  backdrop.addEventListener("keydown", backdrop._trapHandler);
}

export function closeModal(backdrop) {
  if (!backdrop) return;
  backdrop.classList.remove("is-open");
  backdrop.setAttribute("aria-hidden", "true");
  if (backdrop._trapHandler) {
    backdrop.removeEventListener("keydown", backdrop._trapHandler);
    backdrop._trapHandler = null;
  }
  if (backdrop._lastFocus && typeof backdrop._lastFocus.focus === "function") {
    backdrop._lastFocus.focus();
  }
}

export function setModalError(errorEl, message) {
  safeText(errorEl, message || "");
}

// ── inspect / remix ─────────────────────────────────────────────────
export function setInspectImage(src) {
  if (els.inspectImg && els.inspectImg.src !== src) {
    els.inspectImg.src = src;
  }
}

export function showInspect(src, index = -1, total = 0, filename = "") {
  setInspectImage(src);
  safeText(
    els.inspectCounter,
    total > 0 && index >= 0 ? `${index + 1} / ${total}` : ""
  );
  safeText(els.inspectFilename, filename);
  if (isOpen(els.inspectModal)) return;
  document.body.style.overflow = "hidden";
  openModal(els.inspectModal);
}

export function hideInspect() {
  closeModal(els.inspectModal);
  if (els.inspectImg) els.inspectImg.src = "";
  safeText(els.inspectCounter, "");
  safeText(els.inspectFilename, "");
  document.body.style.overflow = "";
}

export function showRemix(meta) {
  if (els.remixBody) {
    els.remixBody.textContent = JSON.stringify(meta || {}, null, 2);
  }
  openModal(els.remixModal);
}

export function hideRemix() {
  closeModal(els.remixModal);
}

// ── model mode UI ───────────────────────────────────────────────────
export function updateModelModeUI(mode) {
  const is29 = mode === "anima_2_9";

  if (els.btnAnimaBase) {
    els.btnAnimaBase.classList.toggle("is-active", !is29);
    els.btnAnimaBase.setAttribute("aria-pressed", String(!is29));
  }

  if (els.btnAnima29) {
    els.btnAnima29.classList.toggle("is-active", is29);
    els.btnAnima29.setAttribute("aria-pressed", String(is29));
  }

  // LoRAs are supported in Anima 2.9B mode via tag injection.
  if (els.btnAddLora) {
    els.btnAddLora.disabled = false;
    els.btnAddLora.title = "";
  }

  if (els.loraContainer) {
    els.loraContainer.classList.remove("is-disabled");
  }

  if (els.anima29Notice) {
    els.anima29Notice.hidden = !is29;
    if (is29) {
      els.anima29Notice.textContent = "Anima 2.9B loads LoRAs through the Anima LoRA Tag Loader with automatic 2.9B block remapping.";
    }
  }
}

// ── gallery ─────────────────────────────────────────────────────────
function defaultKey(img) {
  return [
    img?.meta?.prompt_id || "",
    img?.filename || "",
    img?.subfolder || "",
    img?.type || "output",
  ].join("|");
}

function createGalleryCard(img, key, imageUrlFn, index) {
  const card = document.createElement("div");
  card.className = "nexus-panel nexus-gallery-card";
  card.dataset.key = key;
  card.dataset.index = String(index);
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute(
    "aria-label",
    `Inspect ${img.filename || "generated image"}`
  );
  card.style.overflow = "hidden";
  card.style.cursor = "pointer";
  card.style.position = "relative";
  const imgEl = document.createElement("img");
  imgEl.className = "nexus-gallery-img";
  imgEl.src = imageUrlFn(img);
  imgEl.alt = img.filename || "Generated image";
  imgEl.loading = index < 8 ? "eager" : "lazy";
  imgEl.decoding = "async";
  imgEl.draggable = false;
  imgEl.setAttribute(
    "fetchpriority",
    index < 8 ? "high" : "low"
  );
  imgEl.style.width = "100%";
  imgEl.style.display = "block";
  imgEl.style.borderRadius = "var(--nexus-radius)";
  card.appendChild(imgEl);
  return card;
}

function updateGalleryCard(card, img, imageUrlFn, index) {
  card.dataset.index = String(index);
  card.setAttribute(
    "aria-label",
    `Inspect ${img.filename || "generated image"}`
  );
  const imgEl = card.querySelector("img");
  if (!imgEl) return;
  const src = imageUrlFn(img);
  if (imgEl.getAttribute("src") !== src) {
    imgEl.src = src;
  }
  imgEl.loading = index < 8 ? "eager" : "lazy";
  imgEl.setAttribute("fetchpriority", index < 8 ? "high" : "low");
}

/**
Keyed gallery renderer.
Preserves existing DOM nodes whenever possible.
*/
export function renderGallery(images, imageUrlFn, keyFn = defaultKey) {
  const grid = els.galleryGrid;
  if (!grid) return;
  if (!images || !images.length) {
    const empty = document.createElement("div");
    empty.className = "nexus-gallery-empty";
    empty.textContent = "◬ Connect uplink to render nodes";
    grid.replaceChildren(empty);
    return;
  }
  const existing = new Map();
  for (const child of grid.children) {
    if (child.dataset?.key) {
      existing.set(child.dataset.key, child);
    }
  }
  const fragment = document.createDocumentFragment();
  images.forEach((img, idx) => {
    const key = keyFn(img, idx);
    let card = existing.get(key);
    if (!card) {
      card = createGalleryCard(img, key, imageUrlFn, idx);
    } else {
      updateGalleryCard(card, img, imageUrlFn, idx);
    }
    fragment.appendChild(card);
  });
  grid.replaceChildren(fragment);
}

// ── toasts ──────────────────────────────────────────────────────────
export function toast(message, type = "info") {
  if (!els.toastStack) return;
  const el = document.createElement("div");
  el.className = `nexus-toast nexus-toast--${type}`;
  el.textContent = message;
  els.toastStack.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity 0.3s";
    setTimeout(() => el.remove(), 350);
  }, 4000);
}

// ── lora rows ───────────────────────────────────────────────────────
export function addLoraRow(
  loraNames,
  onRemove,
  selectedName = "",
  weight = 1.0
) {
  if (!els.loraContainer) return;
  const row = document.createElement("div");
  row.className = "nexus-lora-row";
  const select = document.createElement("select");
  select.className = "nexus-select nexus-select--compact";
  select.style.flex = "1";
  select.setAttribute("aria-label", "LoRA name");
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = "-- LoRA --";
  select.appendChild(ph);
  for (const name of loraNames || []) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }
  if (selectedName) {
    selectOrAddOption(select, selectedName);
  }
  const weightInput = document.createElement("input");
  weightInput.className = "nexus-input nexus-input--compact nexus-lora-weight";
  weightInput.type = "number";
  weightInput.min = "-2";
  weightInput.max = "2";
  weightInput.step = "0.05";
  weightInput.value = String(weight);
  weightInput.title = "Model weight";
  weightInput.setAttribute("aria-label", "LoRA weight");
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "nexus-btn nexus-btn-ghost";
  removeBtn.textContent = "✕";
  removeBtn.setAttribute("aria-label", "Remove LoRA");
  removeBtn.addEventListener("click", () => {
    row.remove();
    if (onRemove) onRemove();
  });
  row.appendChild(select);
  row.appendChild(weightInput);
  row.appendChild(removeBtn);
  els.loraContainer.appendChild(row);
}

export function clearLoraRows() {
  if (els.loraContainer) els.loraContainer.innerHTML = "";
}

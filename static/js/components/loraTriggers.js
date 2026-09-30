// static/js/components/loraTriggers.js
import * as api from "../api.js";
import state from "../state.js";
import * as ui from "../ui.js";

const els = { container: null, chips: null, pos: null };
const cache = new Map(); // loraName -> string[]
let refreshQueued = false;

export function initLoraTriggers() {
  els.container = document.getElementById("loraTriggerContainer");
  els.chips = document.getElementById("loraTriggerChips");
  els.pos = ui.els.posPrompt;

  if (!els.container || !els.chips) return;

  // Delegated click: append trigger word to the positive prompt.
  els.container.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-trigger-word]");
    if (!btn) return;
    appendTriggerToPrompt(btn.dataset.triggerWord || "");
  });

  // Keep "is-active" highlight in sync while typing / remixing.
  els.pos?.addEventListener("input", updateActiveStates);

  const loraContainer = ui.els.loraContainer;
  if (loraContainer) {
    loraContainer.addEventListener("change", (event) => {
      if (event.target.matches("select")) scheduleRefresh();
    });

    // Rows added / removed ("+ Inject LoRA" / "✕").
    new MutationObserver(() => scheduleRefresh()).observe(loraContainer, {
      childList: true,
      subtree: true,
    });
  }
}

function selectedLoraNames() {
  const selects = ui.els.loraContainer?.querySelectorAll("select") || [];
  const names = [];
  selects.forEach((sel) => {
    const value = (sel.value || "").trim();
    if (value && !names.includes(value)) names.push(value);
  });
  return names;
}

function scheduleRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  setTimeout(() => {
    refreshQueued = false;
    refreshLoraTriggers();
  }, 150);
}

async function refreshLoraTriggers() {
  if (!els.container) return;

  const names = selectedLoraNames();

  if (!names.length || !state.connected || !state.tunnelUrl) {
    els.chips.replaceChildren();
    els.container.hidden = true;
    return;
  }

  const missing = names.filter((name) => !cache.has(name));

  if (missing.length) {
    const results = await Promise.all(
      missing.map((name) =>
        api
          .getLoraTriggerWords(state.tunnelUrl, name)
          .then((res) => [
            name,
            Array.isArray(res?.trigger_words) ? res.trigger_words : [],
          ])
          .catch((err) => {
            console.warn("[LoraTriggers]", name, err?.message || err);
            return [name, []];
          })
      )
    );
    results.forEach(([name, words]) => cache.set(name, words));
  }

  renderChips(selectedLoraNames());
}

function renderChips(names) {
  const fragment = document.createDocumentFragment();
  const seen = new Set();
  let any = false;

  names.forEach((name) => {
    (cache.get(name) || []).forEach((word) => {
      const clean = String(word || "").trim();
      if (!clean || seen.has(clean.toLowerCase())) return;
      seen.add(clean.toLowerCase());
      any = true;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "nexus-btn nexus-btn-ghost nexus-civitai-tag nexus-trigger-chip";
      btn.textContent = clean;
      btn.title = `Append to prompt (from ${name})`;
      btn.dataset.triggerWord = clean;
      fragment.appendChild(btn);
    });
  });

  els.chips.replaceChildren(fragment);
  els.container.hidden = !any;
  updateActiveStates();
}

function promptTokens() {
  return (els.pos?.value || "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function appendTriggerToPrompt(word) {
  if (!els.pos || !word) return;

  if (promptTokens().includes(word.toLowerCase())) {
    ui.toast("Trigger word is already in the prompt.", "info");
    return;
  }

  const current = els.pos.value.trim();
  els.pos.value = current
    ? `${current.replace(/[\s,]+$/, "")}, ${word}`
    : word;
  els.pos.dispatchEvent(new Event("input", { bubbles: true }));
  updateActiveStates();
}

function updateActiveStates() {
  if (!els.chips) return;
  const tokens = promptTokens();
  els.chips.querySelectorAll("[data-trigger-word]").forEach((btn) => {
    const word = (btn.dataset.triggerWord || "").toLowerCase();
    btn.classList.toggle("is-active", tokens.includes(word));
  });
}

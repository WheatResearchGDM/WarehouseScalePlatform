(() => {
  "use strict";

  const STORAGE_KEY = "gdm-warehouse-scale-weights-v1";
  const state = { plots: [], selected: null, weights: loadWeights() };
  const byFeid = new Map();
  const byUuid = new Map();
  let toastTimer;

  const $ = (id) => document.getElementById(id);
  const refs = {
    scanForm: $("scan-form"), scanMode: $("scan-mode"), scanValue: $("scan-value"), scanError: $("scan-error"),
    plotCard: $("plot-card"), emptyState: $("empty-state"), weightForm: $("weight-form"), weight: $("plot-weight"),
    saveButton: $("save-button"), existingBadge: $("existing-badge"), lastSaved: $("last-saved"), toast: $("toast"),
    trialList: $("trial-list"),
  };

  function loadWeights() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch { return {}; }
  }

  function persistWeights() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.weights));
  }

  function normalize(value) { return String(value || "").trim().toUpperCase(); }
  function formatNumber(value) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value); }
  function text(id, value) { $(id).textContent = value ?? "—"; }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }

  function showToast(message, error = false) {
    clearTimeout(toastTimer);
    refs.toast.textContent = message;
    refs.toast.className = error ? "toast toast--error" : "toast";
    refs.toast.hidden = false;
    toastTimer = setTimeout(() => { refs.toast.hidden = true; }, 3200);
  }

  function showScanError(message) {
    refs.scanError.textContent = `⚠ ${message}`;
    refs.scanError.hidden = false;
    refs.scanValue.focus();
    refs.scanValue.select();
  }

  function selectPlot(plot) {
    state.selected = plot;
    refs.scanError.hidden = true;
    refs.emptyState.hidden = true;
    refs.plotCard.hidden = false;
    text("entity-name", plot.entityName);
    text("obs-name", plot.obsName);
    text("ger-name", plot.gerName || "—");
    text("location", `⌖ ${plot.location} · ${plot.site}`);
    text("block", plot.block);
    text("entry-code", plot.entryCode);
    text("row", plot.row);
    text("column", plot.column);
    text("feid", plot.feid);
    text("uuid", plot.uuid);

    const existing = state.weights[normalize(plot.uuid)];
    refs.weight.value = existing ? String(existing.weight).replace(".", ",") : "";
    refs.existingBadge.hidden = !existing;
    refs.existingBadge.textContent = existing ? `Já pesada: PW ${formatNumber(existing.weight)}` : "";
    refs.saveButton.textContent = existing ? "✓ Atualizar PW" : "✓ Salvar PW";
    setTimeout(() => refs.weight.focus(), 0);
  }

  function clearSelection() {
    state.selected = null;
    refs.plotCard.hidden = true;
    refs.emptyState.hidden = false;
    refs.scanValue.value = "";
    refs.weight.value = "";
    setTimeout(() => refs.scanValue.focus(), 0);
  }

  function renderProgress() {
    const grouped = new Map();
    for (const plot of state.plots) {
      const items = grouped.get(plot.entityName) || [];
      items.push(plot);
      grouped.set(plot.entityName, items);
    }

    const trials = [...grouped.entries()].map(([entityName, items]) => {
      const initial = Math.min(...items.map((item) => Number(item.initialPlot)));
      const final = Math.max(...items.map((item) => Number(item.finalPlot)));
      const total = final - initial + 1;
      const completed = items.filter((item) => state.weights[normalize(item.uuid)]).length;
      return {
        entityName, initial, final, total, completed,
        remaining: Math.max(total - completed, 0),
        percent: total ? Math.round(completed / total * 100) : 0,
        trialType: items[0].trialType,
        location: items[0].location,
      };
    });

    const total = trials.reduce((sum, trial) => sum + trial.total, 0);
    const completed = trials.reduce((sum, trial) => sum + trial.completed, 0);
    const remaining = Math.max(total - completed, 0);
    const percent = total ? Math.round(completed / total * 100) : 0;

    text("header-count", `${completed} de ${total}`);
    text("header-percent", `${percent}%`);
    text("overall-percent", `${percent}%`);
    text("overall-completed", completed);
    text("overall-remaining", remaining);
    $("overall-progress").style.width = `${percent}%`;

    refs.trialList.innerHTML = trials.map((trial) => `
      <article class="trial ${trial.percent === 100 ? "trial--done" : ""}">
        <div class="trial__top">
          <div>
            <span class="trial__type">${escapeHtml(trial.trialType)}</span>
            <h3>${escapeHtml(trial.entityName)}</h3>
            <p>${escapeHtml(trial.location)} · parcelas ${trial.initial}–${trial.final}</p>
          </div>
          <span class="trial__percent">${trial.percent}%</span>
        </div>
        <div class="progress"><span style="width:${trial.percent}%"></span></div>
        <div class="trial__footer"><span>${trial.completed} de ${trial.total}</span><span class="${trial.remaining === 0 ? "done" : ""}">${trial.remaining === 0 ? "Ensaio finalizado" : `${trial.remaining} faltam`}</span></div>
      </article>`).join("");
  }

  refs.scanForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const code = normalize(refs.scanValue.value);
    const plot = refs.scanMode.value === "uuid" ? byUuid.get(code) : byFeid.get(code);
    if (!plot) {
      state.selected = null;
      refs.plotCard.hidden = true;
      refs.emptyState.hidden = false;
      showScanError(`${refs.scanMode.value.toUpperCase()} não encontrado na base.`);
      showToast("Parcela não encontrada.", true);
      return;
    }
    selectPlot(plot);
  });

  refs.scanMode.addEventListener("change", () => {
    refs.scanValue.placeholder = refs.scanMode.value === "feid" ? "Leia ou digite o FEID" : "Leia ou digite o UUID";
    refs.scanValue.value = "";
    refs.scanError.hidden = true;
    refs.scanValue.focus();
  });

  refs.weightForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!state.selected) return;
    const weight = Number(refs.weight.value.trim().replace(",", "."));
    if (!Number.isFinite(weight) || weight <= 0) {
      showToast("Informe um peso maior que zero.", true);
      refs.weight.focus();
      refs.weight.select();
      return;
    }

    const plot = state.selected;
    state.weights[normalize(plot.uuid)] = {
      uuid: plot.uuid, feid: plot.feid, entityName: plot.entityName,
      obsName: plot.obsName, weight, updatedAt: new Date().toISOString(),
    };
    persistWeights();
    renderProgress();
    refs.lastSaved.textContent = `✓ Último PW salvo: ${plot.obsName} · ${formatNumber(weight)}`;
    refs.lastSaved.hidden = false;
    showToast(`PW ${formatNumber(weight)} salvo para a parcela ${plot.obsName}.`);
    clearSelection();
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    state.weights = loadWeights();
    renderProgress();
    if (state.selected) selectPlot(state.selected);
  });

  fetch("data/plots.json", { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error("Base de parcelas indisponível.");
      return response.json();
    })
    .then((plots) => {
      state.plots = plots;
      for (const plot of plots) {
        byFeid.set(normalize(plot.feid), plot);
        byUuid.set(normalize(plot.uuid), plot);
      }
      renderProgress();
      refs.scanValue.focus();
    })
    .catch((error) => {
      showScanError(error.message || "Falha ao carregar a base de parcelas.");
      showToast("Falha ao carregar a base de parcelas.", true);
    });
})();

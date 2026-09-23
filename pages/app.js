(() => {
  "use strict";

  const STORAGE_KEY = "gdm-warehouse-scale-weights-v1";
  const state = {
    plots: [], selected: null, weights: loadWeights(),
    serialPort: null, serialReader: null, readLoop: null, keepReading: false,
    serialBuffer: "", serialFlushTimer: null,
  };
  const byFeid = new Map();
  const byUuid = new Map();
  let toastTimer;

  const $ = (id) => document.getElementById(id);
  const refs = {
    scanForm: $("scan-form"), scanMode: $("scan-mode"), scanValue: $("scan-value"), scanError: $("scan-error"),
    plotCard: $("plot-card"), emptyState: $("empty-state"), weightForm: $("weight-form"), weight: $("plot-weight"),
    saveButton: $("save-button"), existingBadge: $("existing-badge"), lastSaved: $("last-saved"), toast: $("toast"),
    trialList: $("trial-list"), exportCsv: $("export-csv"), exportCount: $("export-count"),
    connectScale: $("connect-scale"), baudRate: $("baud-rate"), scaleStatus: $("scale-status"),
    scaleWeight: $("scale-weight"), scaleReadingNote: $("scale-reading-note"), serialHelp: $("serial-help"),
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

  function parseScaleWeight(rawLine) {
    const cleaned = String(rawLine || "").replace(/\u0000/g, " ").trim();
    if (!cleaned) return null;
    const matches = cleaned.match(/[-+]?\d+(?:[.,]\d+)?/g);
    if (!matches?.length) return null;
    const value = Number(matches[matches.length - 1].replace(",", "."));
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  function applyScaleWeight(value, rawLine) {
    refs.scaleWeight.textContent = formatNumber(value);
    refs.scaleWeight.classList.add("is-live");
    refs.scaleReadingNote.textContent = state.selected ? "PW preenchido automaticamente" : "Bipe uma parcela para aplicar";
    refs.scaleWeight.title = String(rawLine || "").trim();
    if (state.selected) refs.weight.value = String(value).replace(".", ",");
  }

  function consumeSerialText(chunk) {
    state.serialBuffer += chunk;
    const lines = state.serialBuffer.split(/\r\n|\n|\r/);
    state.serialBuffer = lines.pop() || "";
    for (const line of lines) {
      const value = parseScaleWeight(line);
      if (value !== null) applyScaleWeight(value, line);
    }
    clearTimeout(state.serialFlushTimer);
    state.serialFlushTimer = setTimeout(() => {
      const value = parseScaleWeight(state.serialBuffer);
      if (value !== null) applyScaleWeight(value, state.serialBuffer);
      state.serialBuffer = "";
    }, 180);
  }

  async function readFromScale() {
    const decoder = new TextDecoder();
    try {
      while (state.keepReading && state.serialPort?.readable) {
        state.serialReader = state.serialPort.readable.getReader();
        try {
          while (state.keepReading) {
            const { value, done } = await state.serialReader.read();
            if (done) break;
            if (value) consumeSerialText(decoder.decode(value, { stream: true }));
          }
        } finally {
          state.serialReader.releaseLock();
          state.serialReader = null;
        }
      }
    } catch (error) {
      if (state.keepReading) {
        showToast(error instanceof Error ? error.message : "A leitura da balança foi interrompida.", true);
      }
    }
  }

  function setScaleConnected(connected, label = "Não conectada") {
    refs.connectScale.dataset.connected = String(connected);
    refs.connectScale.textContent = connected ? "Desconectar" : "Conectar balança";
    refs.baudRate.disabled = connected;
    refs.scaleStatus.textContent = label;
    if (!connected) {
      refs.scaleWeight.textContent = "—";
      refs.scaleWeight.classList.remove("is-live");
      refs.scaleReadingNote.textContent = "Aguardando conexão";
    }
  }

  async function disconnectScale(quiet = false) {
    state.keepReading = false;
    clearTimeout(state.serialFlushTimer);
    try { await state.serialReader?.cancel(); } catch { /* reader may already be closed */ }
    try { await state.readLoop; } catch { /* error already surfaced by the read loop */ }
    try { await state.serialPort?.close(); } catch { /* disconnected device */ }
    state.serialReader = null;
    state.serialPort = null;
    state.readLoop = null;
    state.serialBuffer = "";
    setScaleConnected(false);
    if (!quiet) showToast("Balança desconectada.");
  }

  async function toggleScaleConnection() {
    if (state.serialPort) {
      await disconnectScale();
      return;
    }
    if (!("serial" in navigator)) {
      showToast("Use Google Chrome ou Microsoft Edge para conectar pela porta COM.", true);
      return;
    }
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: Number(refs.baudRate.value) });
      state.serialPort = port;
      state.keepReading = true;
      const info = port.getInfo?.() || {};
      const identifiers = [
        info.usbVendorId ? `VID ${info.usbVendorId.toString(16).toUpperCase().padStart(4, "0")}` : "",
        info.usbProductId ? `PID ${info.usbProductId.toString(16).toUpperCase().padStart(4, "0")}` : "",
      ].filter(Boolean).join(" · ");
      setScaleConnected(true, identifiers ? `Conectada · ${identifiers}` : "Conectada à porta selecionada");
      refs.scaleReadingNote.textContent = "Aguardando peso da balança";
      state.readLoop = readFromScale();
      showToast("Balança conectada. Aguardando leitura do peso.");
    } catch (error) {
      if (error?.name !== "NotFoundError") {
        showToast(error instanceof Error ? error.message : "Não foi possível conectar à balança.", true);
      }
      await disconnectScale(true);
    }
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function exportCsv() {
    const rows = state.plots
      .map((plot) => ({ plot, record: state.weights[normalize(plot.uuid)] }))
      .filter((item) => item.record);
    if (!rows.length) {
      showToast("Ainda não há pesagens para exportar.", true);
      return;
    }
    const header = ["Entity name", "(OBS) Name", "Block", "Entry code", "Row", "Column", "(GER) Name", "FEID", "UUID", "PW", "Atualizado em"];
    const content = [header, ...rows.map(({ plot, record }) => [
      plot.entityName, plot.obsName, plot.block, plot.entryCode, plot.row, plot.column,
      plot.gerName, plot.feid, plot.uuid, String(record.weight).replace(".", ","), record.updatedAt,
    ])].map((row) => row.map(csvCell).join(";")).join("\r\n");
    const blob = new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
    link.href = URL.createObjectURL(blob);
    link.download = `pesagens-trigo_${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    showToast(`${rows.length} pesagem(ns) exportada(s) em CSV.`);
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
    refs.exportCount.textContent = `(${completed})`;
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

  refs.connectScale.addEventListener("click", () => void toggleScaleConnection());
  refs.exportCsv.addEventListener("click", exportCsv);

  if (!("serial" in navigator)) {
    refs.serialHelp.textContent = "Este navegador não oferece conexão COM. Abra o aplicativo no Google Chrome ou Microsoft Edge.";
  }

  navigator.serial?.addEventListener("disconnect", (event) => {
    if (event.target === state.serialPort || event.port === state.serialPort) {
      void disconnectScale(true);
      showToast("A balança foi desconectada do computador.", true);
    }
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

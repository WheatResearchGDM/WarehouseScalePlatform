(function (global) {
  "use strict";

  const sourceColumns = [
    ["ID", "id"], ["FEID", "feid"], ["UUID", "uuid"], ["Entity name", "entityName"],
    ["Trial type", "trialType"], ["Site", "site"], ["Location", "location"], ["Row", "row"],
    ["Column", "column"], ["Entry code", "entryCode"], ["Block", "block"], ["(OBS) Name", "obsName"],
    ["GID", "gid"], ["(GER) Name", "gerName"], ["Initial plot", "initialPlot"], ["Final plot", "finalPlot"],
  ];

  function normalize(value) { return String(value || "").trim().toUpperCase(); }
  function byUuid(weights) { return new Map((weights || []).map((item) => [normalize(item.uuid), item])); }
  function groupProgress(plots, weights, key) {
    const weightMap = byUuid(weights);
    const trials = new Map();
    for (const plot of plots || []) {
      const trialKey = plot.entityName || "Unnamed trial";
      if (!trials.has(trialKey)) trials.set(trialKey, []);
      trials.get(trialKey).push(plot);
    }
    const trialProgress = Array.from(trials.entries()).map(([entityName, items]) => {
      const initial = Math.min(...items.map((item) => Number(item.initialPlot)));
      const final = Math.max(...items.map((item) => Number(item.finalPlot)));
      const total = Math.max(final - initial + 1, 0);
      const completed = items.filter((item) => weightMap.has(normalize(item.uuid))).length;
      return {
        key: entityName, label: entityName, trialType: items[0]?.trialType || "—", location: items[0]?.location || "Unspecified",
        initial, final, total, completed, remaining: Math.max(total - completed, 0),
        percent: total ? Math.min(Math.round((completed / total) * 100), 100) : 0,
      };
    });
    if (key === "trial") return trialProgress;
    const locations = new Map();
    for (const trial of trialProgress) {
      const location = trial.location || "Unspecified";
      const current = locations.get(location) || { key: location, label: location, total: 0, completed: 0 };
      current.total += trial.total;
      current.completed += trial.completed;
      locations.set(location, current);
    }
    return Array.from(locations.values()).map((item) => ({
      ...item, remaining: Math.max(item.total - item.completed, 0),
      percent: item.total ? Math.min(Math.round((item.completed / item.total) * 100), 100) : 0,
    }));
  }

  function overallProgress(plots, weights) {
    const trials = groupProgress(plots, weights, "trial");
    const total = trials.reduce((sum, item) => sum + item.total, 0);
    const completed = trials.reduce((sum, item) => sum + item.completed, 0);
    return { total, completed, remaining: Math.max(total - completed, 0), percent: total ? Math.min(Math.round((completed / total) * 100), 100) : 0 };
  }

  function prepareMerge(activePlots, currentWeights, importedWeights) {
    const plots = new Map((activePlots || []).map((plot) => [normalize(plot.uuid), plot]));
    const current = byUuid(currentWeights);
    const ready = [];
    const unresolved = [];
    let ignored = 0;
    let unchanged = 0;
    let keptCurrent = 0;
    for (const incoming of importedWeights || []) {
      const key = normalize(incoming.uuid);
      if (!plots.has(key)) { ignored += 1; continue; }
      const existing = current.get(key);
      if (!existing) { ready.push({ ...incoming, source: "import" }); continue; }
      if (Number(existing.weight) === Number(incoming.weight)) { unchanged += 1; continue; }
      const oldTime = Date.parse(existing.weighedAt || existing.updatedAt || "");
      const newTime = Date.parse(incoming.weighedAt || "");
      if (Number.isFinite(oldTime) && Number.isFinite(newTime) && oldTime !== newTime) {
        if (newTime > oldTime) ready.push({ ...incoming, source: "import" });
        else keptCurrent += 1;
      } else unresolved.push({ ...incoming, source: "import", weighedAt: incoming.weighedAt || new Date().toISOString() });
    }
    return { ready, unresolved, ignored, unchanged, keptCurrent };
  }

  function exportRows(session, weights) {
    const records = byUuid(weights);
    const exportedAt = new Date().toISOString();
    return session.plots.map((plot) => {
      const row = {};
      for (const [label, key] of sourceColumns) row[label] = plot[key] ?? "";
      const record = records.get(normalize(plot.uuid));
      row.PW = record ? Number(record.weight) : "";
      row["Weighing status"] = record ? "Weighed" : "Pending";
      row["Weighed at"] = record?.weighedAt || record?.updatedAt || "";
      row["Session ID"] = session.id;
      row["Session name"] = session.name;
      row["Exported at"] = exportedAt;
      return row;
    });
  }

  function fileStamp(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  }
  function slug(value) {
    return String(value || "weighing-session").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "weighing-session";
  }
  function downloadBlob(blob, name) {
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 0);
  }
  function exportSession(session, weights, format) {
    if (!global.XLSX) throw new Error("The spreadsheet writer is unavailable.");
    const rows = exportRows(session, weights);
    const stamp = fileStamp();
    const name = `${slug(session.name)}_${stamp}`;
    const sheet = global.XLSX.utils.json_to_sheet(rows);
    if (format === "xlsx") {
      const workbook = global.XLSX.utils.book_new();
      global.XLSX.utils.book_append_sheet(workbook, sheet, "Weighing Data");
      const info = global.XLSX.utils.json_to_sheet([
        { Field: "Session ID", Value: session.id }, { Field: "Session name", Value: session.name },
        { Field: "Source file", Value: session.sourceFileName }, { Field: "Created at", Value: session.createdAt },
        { Field: "Exported at", Value: rows[0]?.["Exported at"] || new Date().toISOString() },
      ]);
      global.XLSX.utils.book_append_sheet(workbook, info, "Session Info");
      global.XLSX.writeFile(workbook, `${name}.xlsx`, { compression: true });
    } else {
      const csv = global.XLSX.utils.sheet_to_csv(sheet, { FS: ",", RS: "\r\n" });
      downloadBlob(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }), `${name}.csv`);
    }
    return rows.length;
  }

  global.GdmWeighingUtils = { normalize, byUuid, groupProgress, overallProgress, prepareMerge, exportRows, exportSession };
})(window);

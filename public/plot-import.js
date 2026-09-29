(function (global) {
  "use strict";

  const fields = [
    ["id", "ID"],
    ["feid", "FEID"],
    ["uuid", "UUID"],
    ["entityName", "Entity name"],
    ["trialType", "Trial type"],
    ["site", "Site"],
    ["location", "Location"],
    ["row", "Row"],
    ["column", "Column"],
    ["entryCode", "Entry code"],
    ["block", "Block"],
    ["obsName", "(OBS) Name"],
    ["gid", "GID"],
    ["gerName", "(GER) Name"],
    ["initialPlot", "Initial plot"],
    ["finalPlot", "Final plot"],
    ["pw", "PW"],
  ];

  function normalizeHeader(value) {
    return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function cellText(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }

  function numericCell(value) {
    const parsed = Number(cellText(value).replace(",", "."));
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  async function parseExcelFile(file) {
    if (!global.XLSX) throw new Error("Leitor de Excel indisponível. Atualize a página e tente novamente.");
    if (!file) throw new Error("Selecione um arquivo Excel.");

    const workbook = global.XLSX.read(await file.arrayBuffer(), { type: "array", raw: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error("A planilha não possui abas para importar.");

    const rows = global.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: "",
      raw: true,
    });
    if (!rows.length) throw new Error("A primeira aba da planilha está vazia.");

    const requiredNames = fields.map(([, label]) => normalizeHeader(label));
    const headerRowIndex = rows.findIndex((row) => {
      const values = new Set(row.map(normalizeHeader));
      return requiredNames.every((name) => values.has(name));
    });
    if (headerRowIndex < 0) {
      const available = new Set(rows.slice(0, 20).flat().map(normalizeHeader));
      const missing = fields.filter(([, label]) => !available.has(normalizeHeader(label))).map(([, label]) => label);
      throw new Error(`Cabeçalhos ausentes: ${missing.join(", ")}.`);
    }

    const headers = rows[headerRowIndex].map(normalizeHeader);
    const indexes = Object.fromEntries(fields.map(([key, label]) => [key, headers.indexOf(normalizeHeader(label))]));
    const plots = [];
    const invalidRows = [];
    const feids = new Set();
    const uuids = new Set();

    for (let index = headerRowIndex + 1; index < rows.length; index += 1) {
      const row = rows[index];
      if (!row.some((value) => cellText(value))) continue;

      const plot = {
        id: cellText(row[indexes.id]),
        feid: cellText(row[indexes.feid]),
        uuid: cellText(row[indexes.uuid]).toUpperCase(),
        entityName: cellText(row[indexes.entityName]),
        trialType: cellText(row[indexes.trialType]),
        site: cellText(row[indexes.site]),
        location: cellText(row[indexes.location]),
        row: cellText(row[indexes.row]),
        column: cellText(row[indexes.column]),
        entryCode: cellText(row[indexes.entryCode]),
        block: cellText(row[indexes.block]),
        obsName: cellText(row[indexes.obsName]),
        gid: cellText(row[indexes.gid]),
        gerName: cellText(row[indexes.gerName]),
        initialPlot: numericCell(row[indexes.initialPlot]),
        finalPlot: numericCell(row[indexes.finalPlot]),
      };

      const invalid = !plot.feid || !plot.uuid || !plot.entityName || !plot.obsName
        || !Number.isFinite(plot.initialPlot) || !Number.isFinite(plot.finalPlot)
        || plot.finalPlot < plot.initialPlot || feids.has(plot.feid.toUpperCase()) || uuids.has(plot.uuid);
      if (invalid) {
        invalidRows.push(index + 1);
        continue;
      }

      feids.add(plot.feid.toUpperCase());
      uuids.add(plot.uuid);
      plots.push(plot);
    }

    if (invalidRows.length) {
      const sample = invalidRows.slice(0, 8).join(", ");
      const suffix = invalidRows.length > 8 ? "…" : "";
      throw new Error(`Existem ${invalidRows.length} linha(s) inválida(s) ou duplicada(s): ${sample}${suffix}.`);
    }
    if (!plots.length) throw new Error("Nenhuma parcela válida foi encontrada na primeira aba.");

    return { plots, fileName: file.name, sheetName };
  }

  global.GdmPlotImport = {
    parseExcelFile,
    requiredHeaders: fields.map(([, label]) => label),
  };
})(window);

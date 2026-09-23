"use client";

import {
  Barcode,
  Cable,
  Check,
  CircleAlert,
  Cloud,
  CloudOff,
  Download,
  Gauge,
  LoaderCircle,
  MapPin,
  Scale,
  ScanLine,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { Toaster } from "@/components/ui/sonner";
import plots from "@/data/plots.json";

type Plot = (typeof plots)[number];
type ScanMode = "feid" | "uuid";
type WeightRecord = {
  uuid: string;
  feid: string;
  entityName: string;
  obsName: string;
  weight: number;
  updatedAt: string;
};

type SerialPortLike = {
  readable: ReadableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
};

type SerialLike = {
  requestPort(): Promise<SerialPortLike>;
  addEventListener(type: "disconnect", listener: (event: Event) => void): void;
  removeEventListener(type: "disconnect", listener: (event: Event) => void): void;
};

type ModelTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute(input: unknown): unknown | Promise<unknown>;
};

type ModelContext = {
  registerTool(tool: ModelTool, options?: { signal?: AbortSignal }): void | Promise<void>;
};

const byFeid = new Map(plots.map((plot) => [plot.feid.toUpperCase(), plot]));
const byUuid = new Map(plots.map((plot) => [plot.uuid.toUpperCase(), plot]));

function parseWeight(value: string) {
  return Number(value.trim().replace(",", "."));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Horário indisponível";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function getSerial() {
  return (navigator as Navigator & { serial?: SerialLike }).serial;
}

function parseScaleWeight(rawLine: string) {
  const cleaned = rawLine.replace(/\u0000/g, " ").trim();
  if (!cleaned) return null;
  const matches = cleaned.match(/[-+]?\d+(?:[.,]\d+)?/g);
  if (!matches?.length) return null;
  const value = Number(matches[matches.length - 1].replace(",", "."));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export default function Home() {
  const [scanMode, setScanMode] = useState<ScanMode>("feid");
  const [scanValue, setScanValue] = useState("");
  const [selected, setSelected] = useState<Plot | null>(null);
  const [weightValue, setWeightValue] = useState("");
  const [weights, setWeights] = useState<WeightRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connected, setConnected] = useState(true);
  const [scanError, setScanError] = useState("");
  const [baudRate, setBaudRate] = useState("9600");
  const [scaleConnected, setScaleConnected] = useState(false);
  const [scaleStatus, setScaleStatus] = useState("Não conectada");
  const [scaleWeight, setScaleWeight] = useState<number | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const weightRef = useRef<HTMLInputElement>(null);
  const weightsRef = useRef<WeightRecord[]>([]);
  const selectedRef = useRef<Plot | null>(null);
  const serialPortRef = useRef<SerialPortLike | null>(null);
  const serialReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const serialReadTaskRef = useRef<Promise<void> | null>(null);
  const serialKeepReadingRef = useRef(false);
  const serialBufferRef = useRef("");
  const serialFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const weightsByUuid = useMemo(
    () => new Map(weights.map((item) => [item.uuid.toUpperCase(), item])),
    [weights],
  );

  const recentWeights = useMemo(
    () => [...weights]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 10),
    [weights],
  );

  useEffect(() => {
    weightsRef.current = weights;
  }, [weights]);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const refreshWeights = useCallback(async (quiet = false) => {
    try {
      const response = await fetch("/api/weights", { cache: "no-store" });
      const payload = (await response.json()) as { weights?: WeightRecord[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível atualizar as pesagens.");
      setWeights(payload.weights ?? []);
      setConnected(true);
    } catch (error) {
      setConnected(false);
      if (!quiet) {
        toast.error(error instanceof Error ? error.message : "Falha ao carregar pesagens.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshWeights();
    const interval = window.setInterval(() => void refreshWeights(true), 5000);
    return () => window.clearInterval(interval);
  }, [refreshWeights]);

  const findPlot = useCallback((mode: ScanMode, rawCode: string) => {
    const code = rawCode.trim().toUpperCase();
    return mode === "feid" ? byFeid.get(code) : byUuid.get(code);
  }, []);

  const selectPlot = useCallback(
    (plot: Plot) => {
      setSelected(plot);
      setScanError("");
      setScanValue("");
      const existing = weightsRef.current.find(
        (item) => item.uuid.toUpperCase() === plot.uuid.toUpperCase(),
      );
      setWeightValue(existing ? String(existing.weight).replace(".", ",") : "");
      window.setTimeout(() => scanRef.current?.focus(), 0);
    },
    [],
  );

  const persistWeight = useCallback(async (plot: Plot, weight: number) => {
    const response = await fetch("/api/weights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uuid: plot.uuid, weight }),
    });
    const payload = (await response.json()) as { weight?: WeightRecord; error?: string };
    if (!response.ok || !payload.weight) {
      throw new Error(payload.error ?? "Não foi possível salvar o peso.");
    }
    const saved = payload.weight;
    setWeights((current) => [saved, ...current.filter((item) => item.uuid !== saved.uuid)]);
    setConnected(true);
    return saved;
  }, []);

  const applyScaleWeight = useCallback((value: number) => {
    setScaleWeight(value);
    if (selectedRef.current) setWeightValue(String(value).replace(".", ","));
  }, []);

  const consumeSerialText = useCallback((chunk: string) => {
    serialBufferRef.current += chunk;
    const lines = serialBufferRef.current.split(/\r\n|\n|\r/);
    serialBufferRef.current = lines.pop() ?? "";
    for (const line of lines) {
      const value = parseScaleWeight(line);
      if (value !== null) applyScaleWeight(value);
    }
    if (serialFlushTimerRef.current) clearTimeout(serialFlushTimerRef.current);
    serialFlushTimerRef.current = setTimeout(() => {
      const value = parseScaleWeight(serialBufferRef.current);
      if (value !== null) applyScaleWeight(value);
      serialBufferRef.current = "";
    }, 180);
  }, [applyScaleWeight]);

  const disconnectScale = useCallback(async (quiet = false) => {
    serialKeepReadingRef.current = false;
    if (serialFlushTimerRef.current) clearTimeout(serialFlushTimerRef.current);
    try { await serialReaderRef.current?.cancel(); } catch { /* reader may already be closed */ }
    try { await serialReadTaskRef.current; } catch { /* surfaced by the read loop */ }
    try { await serialPortRef.current?.close(); } catch { /* device may already be gone */ }
    serialReaderRef.current = null;
    serialReadTaskRef.current = null;
    serialPortRef.current = null;
    serialBufferRef.current = "";
    setScaleConnected(false);
    setScaleStatus("Não conectada");
    setScaleWeight(null);
    if (!quiet) toast.success("Balança desconectada.");
  }, []);

  const toggleScaleConnection = useCallback(async () => {
    if (serialPortRef.current) {
      await disconnectScale();
      return;
    }
    const serial = getSerial();
    if (!serial) {
      toast.error("Use Google Chrome ou Microsoft Edge para conectar pela porta COM.");
      return;
    }

    try {
      const port = await serial.requestPort();
      await port.open({ baudRate: Number(baudRate) });
      serialPortRef.current = port;
      serialKeepReadingRef.current = true;
      setScaleConnected(true);
      const info = port.getInfo?.() ?? {};
      const identifiers = [
        info.usbVendorId ? `VID ${info.usbVendorId.toString(16).toUpperCase().padStart(4, "0")}` : "",
        info.usbProductId ? `PID ${info.usbProductId.toString(16).toUpperCase().padStart(4, "0")}` : "",
      ].filter(Boolean).join(" · ");
      setScaleStatus(identifiers ? `Conectada · ${identifiers}` : "Conectada à porta selecionada");

      serialReadTaskRef.current = (async () => {
        const decoder = new TextDecoder();
        try {
          while (serialKeepReadingRef.current && port.readable) {
            const reader = port.readable.getReader();
            serialReaderRef.current = reader;
            try {
              while (serialKeepReadingRef.current) {
                const { value, done } = await reader.read();
                if (done) break;
                if (value) consumeSerialText(decoder.decode(value, { stream: true }));
              }
            } finally {
              reader.releaseLock();
              serialReaderRef.current = null;
            }
          }
        } catch (error) {
          if (serialKeepReadingRef.current) {
            toast.error(error instanceof Error ? error.message : "A leitura da balança foi interrompida.");
          }
        }
      })();
      toast.success("Balança conectada. Aguardando leitura do peso.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") return;
      toast.error(error instanceof Error ? error.message : "Não foi possível conectar à balança.");
      await disconnectScale(true);
    }
  }, [baudRate, consumeSerialText, disconnectScale]);

  useEffect(() => {
    const serial = getSerial();
    if (!serial) return;
    const handleDisconnect = (event: Event) => {
      if (event.target !== serialPortRef.current as unknown as EventTarget) return;
      void disconnectScale(true);
      toast.error("A balança foi desconectada do computador.");
    };
    serial.addEventListener("disconnect", handleDisconnect);
    return () => {
      serial.removeEventListener("disconnect", handleDisconnect);
      void disconnectScale(true);
    };
  }, [disconnectScale]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;

    const lifecycle = new AbortController();
    const report = () => undefined;

    void Promise.resolve(
      context.registerTool(
        {
          name: "scan_plot",
          title: "Localizar parcela",
          description: "Localiza e abre uma parcela pelo FEID ou UUID.",
          inputSchema: {
            type: "object",
            properties: {
              mode: { type: "string", enum: ["feid", "uuid"] },
              code: { type: "string" },
            },
            required: ["mode", "code"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute(input) {
            const value = input as { mode?: ScanMode; code?: string };
            if (!value.mode || !value.code) throw new Error("mode e code são obrigatórios");
            const plot = findPlot(value.mode, value.code);
            if (!plot) throw new Error("Parcela não encontrada");
            setScanMode(value.mode);
            setScanValue(value.code);
            selectPlot(plot);
            return { uuid: plot.uuid, feid: plot.feid, entityName: plot.entityName, obsName: plot.obsName };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(report);

    void Promise.resolve(
      context.registerTool(
        {
          name: "record_plot_weight",
          title: "Registrar peso da parcela",
          description: "Registra ou atualiza o PW de uma parcela identificada por UUID.",
          inputSchema: {
            type: "object",
            properties: { uuid: { type: "string" }, weight: { type: "number", exclusiveMinimum: 0 } },
            required: ["uuid", "weight"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          async execute(input) {
            const value = input as { uuid?: string; weight?: number };
            const plot = value.uuid ? byUuid.get(value.uuid.trim().toUpperCase()) : undefined;
            if (!plot || !Number.isFinite(value.weight) || Number(value.weight) <= 0) {
              throw new Error("UUID ou peso inválido");
            }
            const saved = await persistWeight(plot, Number(value.weight));
            selectPlot(plot);
            setWeightValue(String(saved.weight).replace(".", ","));
            return { uuid: saved.uuid, weight: saved.weight, updatedAt: saved.updatedAt };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(report);

    return () => lifecycle.abort();
  }, [findPlot, persistWeight, selectPlot]);

  function handleScan(event: FormEvent) {
    event.preventDefault();
    const code = scanValue.trim().toUpperCase();
    const selectedCode = selected
      ? (scanMode === "feid" ? selected.feid : selected.uuid).toUpperCase()
      : "";

    if (selected && (!code || code === selectedCode)) {
      void saveCurrentWeight();
      return;
    }

    const plot = findPlot(scanMode, scanValue);
    if (!plot) {
      setSelected(null);
      setScanError(`${scanMode.toUpperCase()} não encontrado na base.`);
      toast.error("Parcela não encontrada");
      scanRef.current?.select();
      return;
    }
    selectPlot(plot);
  }

  async function saveCurrentWeight() {
    if (!selected || saving) return;
    const weight = parseWeight(weightValue);
    if (!Number.isFinite(weight) || weight <= 0) {
      toast.error("Aguardando um peso válido da balança.");
      weightRef.current?.focus();
      return;
    }

    setSaving(true);
    try {
      const saved = await persistWeight(selected, weight);
      toast.success(`PW ${formatNumber(saved.weight)} salvo para a parcela ${selected.obsName}.`);
      setSelected(null);
      setScanValue("");
      setWeightValue("");
      window.setTimeout(() => scanRef.current?.focus(), 0);
    } catch (error) {
      setConnected(false);
      toast.error(error instanceof Error ? error.message : "Falha ao salvar o peso.");
    } finally {
      setSaving(false);
    }
  }

  function handleSave(event: FormEvent) {
    event.preventDefault();
    void saveCurrentWeight();
  }

  function exportCsv() {
    const rows = plots
      .map((plot) => ({ plot, record: weightsByUuid.get(plot.uuid.toUpperCase()) }))
      .filter((item): item is { plot: Plot; record: WeightRecord } => Boolean(item.record));
    if (!rows.length) {
      toast.error("Ainda não há pesagens para exportar.");
      return;
    }

    const header = ["Entity name", "(OBS) Name", "Block", "Entry code", "Row", "Column", "(GER) Name", "FEID", "UUID", "PW", "Atualizado em"];
    const content = [header, ...rows.map(({ plot, record }) => [
      plot.entityName, plot.obsName, plot.block, plot.entryCode, plot.row, plot.column,
      plot.gerName, plot.feid, plot.uuid, String(record.weight).replace(".", ","), record.updatedAt,
    ])].map((row) => row.map(csvCell).join(";")).join("\r\n");
    const blob = new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
    link.href = href;
    link.download = `pesagens-trigo_${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
    toast.success(`${rows.length} pesagem(ns) exportada(s) em CSV.`);
  }

  const trials = useMemo(() => {
    const grouped = new Map<string, Plot[]>();
    for (const plot of plots) {
      grouped.set(plot.entityName, [...(grouped.get(plot.entityName) ?? []), plot]);
    }
    return Array.from(grouped.entries()).map(([entityName, items]) => {
      const initial = Math.min(...items.map((item) => item.initialPlot));
      const final = Math.max(...items.map((item) => item.finalPlot));
      const total = final - initial + 1;
      const completed = items.filter((item) => weightsByUuid.has(item.uuid.toUpperCase())).length;
      const remaining = Math.max(total - completed, 0);
      return {
        entityName,
        trialType: items[0].trialType,
        location: items[0].location,
        initial,
        final,
        total,
        completed,
        remaining,
        percent: total ? Math.round((completed / total) * 100) : 0,
      };
    });
  }, [weightsByUuid]);

  const totalPlots = trials.reduce((sum, trial) => sum + trial.total, 0);
  const totalCompleted = trials.reduce((sum, trial) => sum + trial.completed, 0);
  const overallPercent = totalPlots ? Math.round((totalCompleted / totalPlots) * 100) : 0;
  const existingWeight = selected ? weightsByUuid.get(selected.uuid.toUpperCase()) : undefined;

  return (
    <main className="min-h-screen bg-[#edf3f8] text-[#17365a]">
      <Toaster position="top-center" richColors />

      <header className="mx-3 mt-2 rounded-lg bg-[#1f4269] text-white shadow-[0_14px_28px_rgba(24,55,88,0.17)]">
        <div className="mx-auto flex max-w-[1780px] items-center justify-between gap-6 px-5 py-[18px] sm:px-12">
          <div className="flex items-center gap-3">
            <img src="/gdm-logo.svg" alt="GDM" className="h-12 w-[68px] object-contain" />
            <div>
              <p className="text-[22px] font-black tracking-[-0.02em]">Pesagem de Ensaios</p>
              <p className="text-sm text-white/75">GDM Field Operations · Trigo</p>
            </div>
          </div>

          <div className="hidden items-center gap-4 rounded-xl bg-white/10 px-4 py-2.5 sm:flex">
            <div className="text-right">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/60">Avanço geral</p>
              <p className="text-lg font-bold">{totalCompleted} de {totalPlots}</p>
            </div>
            <div className="grid size-12 place-items-center rounded-full border-4 border-[#8bb7df] text-sm font-black">
              {overallPercent}%
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] gap-6 px-[18px] py-6 lg:grid-cols-[minmax(0,1.32fr)_minmax(380px,.98fr)]">
        <section className="min-w-0 space-y-5">
          <div className="rounded-lg border border-[#cbdcec] bg-white p-5 shadow-[0_10px_28px_rgba(26,59,93,0.08)] sm:p-6">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-4 border-b-2 border-[#d6e3ef] pb-3">
              <div>
                <p className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.1em] text-[#315b86]">
                  <ScanLine className="size-4" /> Operação de pesagem
                </p>
                <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-[#173a61] sm:text-[29px]">
                  Leitura da parcela
                </h1>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button type="button" onClick={exportCsv} className="h-9 rounded-[5px] bg-[#c88918] px-3 text-sm font-bold text-white hover:bg-[#b77710]">
                  <Download className="size-4" /> Exportar CSV ({totalCompleted})
                </Button>
                <div className={`flex items-center gap-2 rounded-[5px] px-3 py-1.5 text-sm font-semibold ${connected ? "bg-[#eaf3fb] text-[#315f8b]" : "bg-[#fff0ed] text-[#a63a2b]"}`}>
                  {connected ? <Cloud className="size-4" /> : <CloudOff className="size-4" />}
                  {connected ? "Sincronizado" : "Sem conexão"}
                </div>
              </div>
            </div>

            <section className="mb-2 grid gap-3 rounded-[5px] border border-[#cbdcec] border-l-4 border-l-[#78a9d8] bg-[#eaf2f9] p-3.5 md:grid-cols-[minmax(190px,.8fr)_minmax(300px,1.2fr)_minmax(145px,.55fr)] md:items-center">
              <div className="flex items-center gap-3">
                <div className="grid size-11 shrink-0 place-items-center rounded-[5px] bg-[#d6e6f3] text-[#25537f]"><Cable className="size-5" /></div>
                <div className="min-w-0">
                  <p className="font-extrabold text-[#173a61]">Balança serial</p>
                  <p className="truncate text-xs text-[#60768d]" title={scaleStatus}>{scaleStatus}</p>
                </div>
              </div>
              <div className="grid grid-cols-[minmax(130px,.72fr)_minmax(150px,1fr)] items-end gap-2">
                <label className="text-[11px] font-extrabold uppercase tracking-[.08em] text-[#587064]">
                  Velocidade
                  <NativeSelect value={baudRate} onChange={(event) => setBaudRate(event.target.value)} disabled={scaleConnected} className="mt-1 h-10 w-full rounded-[5px] border-[#cbdcec] bg-white px-2 text-sm font-bold normal-case tracking-normal text-[#173a61]">
                    {[1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].map((rate) => <NativeSelectOption key={rate} value={String(rate)}>{rate} baud</NativeSelectOption>)}
                  </NativeSelect>
                </label>
                <Button type="button" onClick={() => void toggleScaleConnection()} className={`h-10 rounded-[5px] text-sm font-extrabold ${scaleConnected ? "bg-[#d63b38] hover:bg-[#b92f2d]" : "bg-[#1f4269] hover:bg-[#173754]"}`}>
                  {scaleConnected ? "Desconectar" : "Conectar balança"}
                </Button>
              </div>
              <div className="border-t border-[#d5dfd0] pt-2 md:border-l md:border-t-0 md:pl-4 md:pt-0">
                <p className="text-[10px] font-bold uppercase tracking-[.08em] text-[#75867c]">Leitura atual</p>
                <p className={`text-3xl font-black leading-none tracking-[-.02em] ${scaleWeight === null ? "text-[#173a61]" : "text-[#237a63]"}`}>{scaleWeight === null ? "—" : formatNumber(scaleWeight)}</p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-[.08em] text-[#75867c]">{scaleConnected ? (selected ? "PW preenchido automaticamente" : "Bipe uma parcela para aplicar") : "Aguardando conexão"}</p>
              </div>
            </section>
            <p className="mb-4 text-xs text-[#647a90]">Conecte a balança, selecione FEID ou UUID e bipe a parcela para preencher o PW automaticamente.</p>

            <form onSubmit={handleScan} className="grid gap-3 rounded-[5px] border border-[#cbdcec] bg-[#f8fbfe] p-3.5 sm:grid-cols-[190px_minmax(0,1fr)]">
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-[#345647]">Identificador</span>
                <NativeSelect
                  value={scanMode}
                  onChange={(event) => {
                    setScanMode(event.target.value as ScanMode);
                    setSelected(null);
                    setScanError("");
                    setScanValue("");
                    window.setTimeout(() => scanRef.current?.focus(), 0);
                  }}
                  className="h-14 w-full rounded-[5px] border-2 border-[#d1dfed] bg-white px-4 text-base font-bold text-[#173a61]"
                  aria-label="Tipo de código"
                >
                  <NativeSelectOption value="feid">FEID da parcela</NativeSelectOption>
                  <NativeSelectOption value="uuid">UUID da parcela</NativeSelectOption>
                </NativeSelect>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-bold text-[#345647]">Código lido</span>
                <div className="relative">
                  <Barcode className="pointer-events-none absolute left-4 top-1/2 size-6 -translate-y-1/2 text-[#6e94b9]" />
                  <Input
                    ref={scanRef}
                    autoFocus
                    value={scanValue}
                    onChange={(event) => setScanValue(event.target.value)}
                    className="h-14 rounded-[5px] border-2 border-[#d1dfed] bg-white pl-13 pr-4 font-mono text-lg font-semibold tracking-wide text-[#173a61] focus-visible:border-[#7fa9d2] focus-visible:ring-[#669dcf]/20"
                    placeholder={scanMode === "feid" ? "Leia ou digite o FEID" : "Leia ou digite o UUID"}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={Boolean(scanError)}
                  />
                </div>
              </label>

            </form>

            <p className="mt-3 text-sm text-[#657b90]"><strong>Fluxo rápido:</strong> bipe para carregar a parcela. Com o peso preenchido, pressione Enter ou bipe a mesma parcela novamente para salvar.</p>

            {scanError && (
              <div role="alert" className="mt-5 flex items-center gap-3 rounded-xl border border-[#f2c8be] bg-[#fff4f1] px-4 py-3 text-[#963827]">
                <CircleAlert className="size-5 shrink-0" />
                <span className="font-semibold">{scanError}</span>
              </div>
            )}
          </div>

          {selected && (
            <article className="overflow-hidden rounded-lg border border-[#cbdcec] bg-white shadow-[0_10px_28px_rgba(26,59,93,0.08)]">
              <div className="border-b border-[#2f5a84] bg-[#1f4269] p-5 text-white sm:p-6">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 rounded-[5px] bg-[#d9e9f6] px-3 py-1.5 text-sm font-black uppercase tracking-[0.08em] text-[#173f66]">
                    <Check className="size-4" /> Parcela encontrada
                  </span>
                  {existingWeight && (
                    <span className="rounded-[5px] bg-[#f5cf77] px-3 py-1.5 text-sm font-bold text-[#6a4700]">
                      Já pesada: PW {formatNumber(existingWeight.weight)}
                    </span>
                  )}
                </div>

                <div className="grid gap-5 md:grid-cols-[minmax(0,1.45fr)_minmax(220px,0.55fr)]">
                  <div>
                    <p className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-[#bbcee1]">Entity name</p>
                    <h2 className="break-words text-2xl font-extrabold leading-tight tracking-[-0.025em] text-white sm:text-3xl">{selected.entityName}</h2>
                    <p className="mb-1 mt-5 text-xs font-bold uppercase tracking-[0.14em] text-[#bbcee1]">(OBS) Name</p>
                    <p className="text-4xl font-black tracking-[-0.04em] text-white sm:text-5xl">{selected.obsName}</p>
                  </div>
                  <div className="rounded-md border border-white/20 bg-white/10 p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#bbcee1]">(GER) Name</p>
                    <p className="mt-2 break-words text-xl font-extrabold leading-tight text-white">{selected.gerName || "—"}</p>
                    <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-[#c7d7e7]"><MapPin className="size-4" /> {selected.location} · {selected.site}</p>
                  </div>
                </div>
              </div>

              <div className="grid gap-6 p-5 sm:p-7 xl:grid-cols-[minmax(0,1fr)_330px]">
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    ["Block", selected.block],
                    ["Entry code", selected.entryCode],
                    ["Row", selected.row],
                    ["Column", selected.column],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-md border border-[#cfdeeb] bg-[#f7fafe] p-4">
                      <dt className="text-xs font-bold uppercase tracking-[0.1em] text-[#6d8195]">{label}</dt>
                      <dd className="mt-1 text-2xl font-black text-[#173a61]">{value || "—"}</dd>
                    </div>
                  ))}
                  <div className="col-span-2 rounded-md border border-[#cfdeeb] bg-[#f7fafe] p-4 sm:col-span-4">
                    <dt className="text-xs font-bold uppercase tracking-[0.1em] text-[#6d8195]">Identificadores</dt>
                    <dd className="mt-2 grid gap-2 text-sm text-[#375b7d] sm:grid-cols-2">
                      <span><strong>FEID:</strong> {selected.feid}</span>
                      <span className="break-all"><strong>UUID:</strong> {selected.uuid}</span>
                    </dd>
                  </div>
                </dl>

                <form onSubmit={handleSave} className="rounded-md border border-[#cbdcec] bg-[#eaf2f9] p-5 text-[#173a61]">
                  <label htmlFor="plot-weight" className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.1em] text-[#365c81]">
                    <Scale className="size-4" /> Peso da parcela (PW)
                  </label>
                  <Input
                    id="plot-weight"
                    ref={weightRef}
                    inputMode="decimal"
                    value={weightValue}
                    onChange={(event) => setWeightValue(event.target.value)}
                    className="mt-3 h-16 rounded-[5px] border-2 border-[#d1dfed] bg-white px-4 text-3xl font-black text-[#173a61] placeholder:text-[#8ca0b5] focus-visible:border-[#7fa9d2] focus-visible:ring-[#669dcf]/20"
                    placeholder="0,000"
                    autoComplete="off"
                  />
                  <Button type="submit" disabled={saving} className="mt-3 h-12 w-full rounded-[5px] bg-[#1f4269] text-base font-black text-white hover:bg-[#173754]">
                    {saving ? <LoaderCircle className="animate-spin" /> : <Check />}
                    {existingWeight ? "Atualizar PW" : "Salvar PW"}
                  </Button>
                </form>
              </div>
            </article>
          )}

          <section aria-labelledby="recent-title" className="rounded-lg border border-[#cbdcec] bg-white p-5 shadow-[0_10px_28px_rgba(26,59,93,0.08)] sm:p-6">
            <div className="flex items-center justify-between gap-4 border-b-2 border-[#d6e3ef] pb-3">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.1em] text-[#315b86]">◷ Histórico recente</p>
                <h2 id="recent-title" className="mt-1 text-2xl font-extrabold tracking-[-0.02em] text-[#173a61]">Últimas pesagens</h2>
              </div>
              <span className="rounded-[5px] bg-[#eaf3fb] px-2.5 py-1 text-xs font-bold text-[#315f8b]">10 mais recentes</span>
            </div>

            {recentWeights.length ? (
              <div className="divide-y divide-[#dbe6f0]">
                {recentWeights.map((record) => (
                  <article key={record.uuid} className="grid items-center gap-3 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-5">
                    <div className="min-w-0">
                      <p className="truncate text-lg font-extrabold text-[#173a61]">Parcela {record.obsName || "—"}</p>
                      <p className="mt-1 truncate text-xs text-[#657b90]">{record.entityName || "Ensaio não informado"} · FEID {record.feid || "—"}</p>
                    </div>
                    <div className="text-left sm:min-w-24 sm:text-right">
                      <p className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[#6d8195]">PW</p>
                      <p className="text-xl font-black text-[#1f4269]">{formatNumber(record.weight)}</p>
                    </div>
                    <time dateTime={record.updatedAt} className="text-xs text-[#657b90] sm:min-w-28 sm:text-right">{formatDateTime(record.updatedAt)}</time>
                  </article>
                ))}
              </div>
            ) : (
              <div className="grid min-h-[190px] place-content-center justify-items-center text-center">
                <div className="grid size-14 place-items-center rounded-lg bg-[#dceaf6] text-[#285882]"><Scale className="size-7" /></div>
                <p className="mt-4 font-extrabold text-[#173a61]">Nenhuma pesagem registrada</p>
                <p className="mt-1 text-sm text-[#647a90]">As pesagens salvas aparecerão aqui automaticamente.</p>
              </div>
            )}
          </section>
        </section>

        <aside className="h-fit rounded-lg border border-[#cbdcec] bg-white p-5 shadow-[0_10px_28px_rgba(26,59,93,0.08)] sm:p-6 lg:sticky lg:top-[18px] lg:max-h-[calc(100vh-36px)] lg:overflow-auto">
          <div className="flex items-start justify-between gap-4 border-b-2 border-[#d6e3ef] pb-3">
            <div>
              <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.1em] text-[#315b86]"><Gauge className="size-4" /> Relatório em tempo real</p>
              <h2 className="mt-1 text-2xl font-extrabold tracking-[-0.02em] text-[#173a61]">Avanço por ensaio</h2>
            </div>
            <span className="mt-1 inline-flex items-center gap-1.5 rounded-[5px] bg-[#eaf3fb] px-2.5 py-1 text-xs font-bold text-[#315f8b]">
              <span className="size-2 rounded-full bg-[#4d91cf]" /> Ao vivo
            </span>
          </div>

          <div className="my-4 rounded-[7px] bg-[#1f4269] p-5 text-white">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-white/65">Total concluído</p>
                <p className="mt-1 text-4xl font-black tracking-[-0.04em]">{overallPercent}%</p>
              </div>
              <p className="text-right text-sm text-white/75"><strong className="text-lg text-white">{totalCompleted}</strong> pesadas<br />{Math.max(totalPlots - totalCompleted, 0)} faltam</p>
            </div>
            <Progress value={overallPercent} className="mt-4 h-3 bg-white/15 [&_[data-slot=progress-indicator]]:bg-[#8bb7df]" />
          </div>

          <div className="space-y-3">
            {trials.map((trial) => (
              <article key={trial.entityName} className="rounded-[7px] border border-[#cfdeeb] bg-[#f8fbfe] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="inline-flex rounded bg-[#dceaf6] px-2 py-1 text-xs font-black text-[#285882]">{trial.trialType}</span>
                    <h3 className="mt-2 break-words text-base font-extrabold leading-tight text-[#173a61]">{trial.entityName}</h3>
                    <p className="mt-1 text-sm text-[#657b90]">{trial.location} · parcelas {trial.initial}–{trial.final}</p>
                  </div>
                  <div className={`grid size-14 shrink-0 place-items-center rounded-[7px] text-sm font-black ${trial.percent === 100 ? "bg-[#2c8069] text-white" : "bg-[#e4eef7] text-[#315a80]"}`}>
                    {trial.percent}%
                  </div>
                </div>
                <Progress value={trial.percent} className="mt-4 h-2.5 bg-[#dde7f0] [&_[data-slot=progress-indicator]]:bg-[#4f8fc9]" />
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="font-bold text-[#365b80]">{trial.completed} de {trial.total}</span>
                  <span className={trial.remaining === 0 ? "font-black text-[#237a63]" : "font-semibold text-[#657b90]"}>
                    {trial.remaining === 0 ? "Ensaio finalizado" : `${trial.remaining} faltam`}
                  </span>
                </div>
              </article>
            ))}
          </div>

          <p className="mt-4 text-center text-xs text-[#6d8195]">
            {loading ? "Carregando pesagens…" : "Atualização automática a cada 5 segundos"}
          </p>
        </aside>
      </div>
    </main>
  );
}

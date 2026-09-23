"use client";

import {
  Barcode,
  Check,
  CircleAlert,
  Cloud,
  CloudOff,
  Gauge,
  Leaf,
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
  const [lastSaved, setLastSaved] = useState<WeightRecord | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const weightRef = useRef<HTMLInputElement>(null);
  const weightsRef = useRef<WeightRecord[]>([]);

  const weightsByUuid = useMemo(
    () => new Map(weights.map((item) => [item.uuid.toUpperCase(), item])),
    [weights],
  );

  useEffect(() => {
    weightsRef.current = weights;
  }, [weights]);

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
      const existing = weightsRef.current.find(
        (item) => item.uuid.toUpperCase() === plot.uuid.toUpperCase(),
      );
      setWeightValue(existing ? String(existing.weight).replace(".", ",") : "");
      window.setTimeout(() => weightRef.current?.focus(), 0);
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
    setLastSaved(saved);
    setConnected(true);
    return saved;
  }, []);

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

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const weight = parseWeight(weightValue);
    if (!Number.isFinite(weight) || weight <= 0) {
      toast.error("Informe um peso maior que zero.");
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
    <main className="min-h-screen bg-[#f2f5ed] text-[#17352a]">
      <Toaster position="top-center" richColors />

      <header className="border-b border-white/10 bg-[#0b4b33] text-white shadow-[0_8px_30px_rgba(6,45,30,0.16)]">
        <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-6 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-xl bg-[#d7de28] text-[#0b4b33] shadow-inner">
              <Leaf className="size-6" strokeWidth={2.5} />
            </div>
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black tracking-[-0.04em]">GDM</span>
                <span className="hidden text-sm font-medium text-white/70 sm:inline">Pesquisa &amp; Desenvolvimento</span>
              </div>
              <p className="text-sm text-white/75">Pesagem de ensaios de trigo</p>
            </div>
          </div>

          <div className="hidden items-center gap-4 rounded-xl bg-white/10 px-4 py-2.5 sm:flex">
            <div className="text-right">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/60">Avanço geral</p>
              <p className="text-lg font-bold">{totalCompleted} de {totalPlots}</p>
            </div>
            <div className="grid size-12 place-items-center rounded-full border-4 border-[#d7de28] text-sm font-black">
              {overallPercent}%
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1480px] gap-6 px-4 py-5 sm:px-8 lg:grid-cols-[minmax(0,1fr)_410px] lg:py-8">
        <section className="min-w-0 space-y-5">
          <div className="rounded-[24px] border border-[#dce5d6] bg-white p-5 shadow-[0_18px_45px_rgba(21,66,45,0.08)] sm:p-7">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.12em] text-[#6d7f75]">
                  <ScanLine className="size-4 text-[#668900]" /> Leitura da parcela
                </p>
                <h1 className="text-2xl font-extrabold tracking-[-0.025em] text-[#123e2d] sm:text-3xl">
                  Bipe o código para começar
                </h1>
              </div>
              <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ${connected ? "bg-[#edf6d4] text-[#426700]" : "bg-[#fff0ed] text-[#a63a2b]"}`}>
                {connected ? <Cloud className="size-4" /> : <CloudOff className="size-4" />}
                {connected ? "Sincronizado" : "Sem conexão"}
              </div>
            </div>

            <form onSubmit={handleScan} className="grid gap-3 sm:grid-cols-[190px_minmax(0,1fr)_auto]">
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
                  className="h-14 w-full rounded-xl border-[#cbd9c6] bg-[#f8faf5] px-4 text-base font-bold text-[#173e2e]"
                  aria-label="Tipo de código"
                >
                  <NativeSelectOption value="feid">FEID da parcela</NativeSelectOption>
                  <NativeSelectOption value="uuid">UUID da parcela</NativeSelectOption>
                </NativeSelect>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-bold text-[#345647]">Código lido</span>
                <div className="relative">
                  <Barcode className="pointer-events-none absolute left-4 top-1/2 size-6 -translate-y-1/2 text-[#709077]" />
                  <Input
                    ref={scanRef}
                    autoFocus
                    value={scanValue}
                    onChange={(event) => setScanValue(event.target.value)}
                    className="h-14 rounded-xl border-[#cbd9c6] bg-[#f8faf5] pl-13 pr-4 font-mono text-lg font-semibold tracking-wide text-[#173e2e] focus-visible:border-[#7c9b16] focus-visible:ring-[#d7de28]/35"
                    placeholder={scanMode === "feid" ? "Leia ou digite o FEID" : "Leia ou digite o UUID"}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={Boolean(scanError)}
                  />
                </div>
              </label>

              <Button type="submit" className="mt-auto h-14 rounded-xl bg-[#0b4b33] px-7 text-base font-bold hover:bg-[#136344]">
                Conferir
              </Button>
            </form>

            <p className="mt-3 text-sm text-[#6a7d72]">O leitor envia o código como teclado. Mantenha este campo selecionado e finalize a leitura com Enter.</p>

            {scanError && (
              <div role="alert" className="mt-5 flex items-center gap-3 rounded-xl border border-[#f2c8be] bg-[#fff4f1] px-4 py-3 text-[#963827]">
                <CircleAlert className="size-5 shrink-0" />
                <span className="font-semibold">{scanError}</span>
              </div>
            )}
          </div>

          {selected ? (
            <article className="overflow-hidden rounded-[24px] border border-[#dce5d6] bg-white shadow-[0_18px_45px_rgba(21,66,45,0.08)]">
              <div className="border-b border-[#e3eadf] bg-[linear-gradient(120deg,#f5f8e7_0%,#f8fbf5_70%)] p-5 sm:p-7">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 rounded-full bg-[#d7de28] px-3 py-1.5 text-sm font-black uppercase tracking-[0.08em] text-[#264a17]">
                    <Check className="size-4" /> Parcela encontrada
                  </span>
                  {existingWeight && (
                    <span className="rounded-full bg-[#fff0c8] px-3 py-1.5 text-sm font-bold text-[#785b00]">
                      Já pesada: PW {formatNumber(existingWeight.weight)}
                    </span>
                  )}
                </div>

                <div className="grid gap-5 md:grid-cols-[minmax(0,1.45fr)_minmax(220px,0.55fr)]">
                  <div>
                    <p className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-[#708477]">Entity name</p>
                    <h2 className="break-words text-2xl font-extrabold leading-tight tracking-[-0.025em] text-[#0d4a34] sm:text-3xl">{selected.entityName}</h2>
                    <p className="mb-1 mt-5 text-xs font-bold uppercase tracking-[0.14em] text-[#708477]">(OBS) Name</p>
                    <p className="text-4xl font-black tracking-[-0.04em] text-[#17382b] sm:text-5xl">{selected.obsName}</p>
                  </div>
                  <div className="rounded-2xl border border-[#dbe5d7] bg-white/80 p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#708477]">(GER) Name</p>
                    <p className="mt-2 break-words text-xl font-extrabold leading-tight text-[#204c39]">{selected.gerName || "—"}</p>
                    <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-[#61766a]"><MapPin className="size-4" /> {selected.location} · {selected.site}</p>
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
                    <div key={label} className="rounded-2xl border border-[#e0e8dc] bg-[#f8faf6] p-4">
                      <dt className="text-xs font-bold uppercase tracking-[0.1em] text-[#718177]">{label}</dt>
                      <dd className="mt-1 text-2xl font-black text-[#173d2d]">{value || "—"}</dd>
                    </div>
                  ))}
                  <div className="col-span-2 rounded-2xl border border-[#e0e8dc] bg-[#f8faf6] p-4 sm:col-span-4">
                    <dt className="text-xs font-bold uppercase tracking-[0.1em] text-[#718177]">Identificadores</dt>
                    <dd className="mt-2 grid gap-2 text-sm text-[#315444] sm:grid-cols-2">
                      <span><strong>FEID:</strong> {selected.feid}</span>
                      <span className="break-all"><strong>UUID:</strong> {selected.uuid}</span>
                    </dd>
                  </div>
                </dl>

                <form onSubmit={handleSave} className="rounded-2xl bg-[#0b4b33] p-5 text-white shadow-lg shadow-[#0b4b33]/15">
                  <label htmlFor="plot-weight" className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.1em] text-white/70">
                    <Scale className="size-4 text-[#d7de28]" /> Peso da parcela (PW)
                  </label>
                  <Input
                    id="plot-weight"
                    ref={weightRef}
                    inputMode="decimal"
                    value={weightValue}
                    onChange={(event) => setWeightValue(event.target.value)}
                    className="mt-3 h-16 rounded-xl border-white/20 bg-white px-4 text-3xl font-black text-[#123d2c] placeholder:text-[#8ca096] focus-visible:border-[#d7de28] focus-visible:ring-[#d7de28]/35"
                    placeholder="0,000"
                    autoComplete="off"
                  />
                  <Button type="submit" disabled={saving} className="mt-3 h-12 w-full rounded-xl bg-[#d7de28] text-base font-black text-[#244b18] hover:bg-[#e6eb49]">
                    {saving ? <LoaderCircle className="animate-spin" /> : <Check />}
                    {existingWeight ? "Atualizar PW" : "Salvar PW"}
                  </Button>
                </form>
              </div>
            </article>
          ) : (
            <div className="grid min-h-[330px] place-items-center rounded-[24px] border border-dashed border-[#bdcdb8] bg-white/55 p-8 text-center">
              <div>
                <div className="mx-auto grid size-20 place-items-center rounded-full bg-[#eaf0df] text-[#688614]"><Scale className="size-9" /></div>
                <h2 className="mt-5 text-xl font-extrabold text-[#214535]">Aguardando leitura</h2>
                <p className="mx-auto mt-2 max-w-md text-[#687c70]">Os dados da parcela aparecerão aqui para conferência antes de registrar o peso.</p>
                {lastSaved && (
                  <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#edf6d4] px-4 py-2 text-sm font-bold text-[#456400]">
                    <Check className="size-4" /> Último PW salvo: {lastSaved.obsName} · {formatNumber(lastSaved.weight)}
                  </p>
                )}
              </div>
            </div>
          )}
        </section>

        <aside className="h-fit rounded-[24px] border border-[#dce5d6] bg-white p-5 shadow-[0_18px_45px_rgba(21,66,45,0.08)] sm:p-6 lg:sticky lg:top-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.12em] text-[#687c70]"><Gauge className="size-4 text-[#688900]" /> Relatório em tempo real</p>
              <h2 className="mt-1 text-2xl font-extrabold tracking-[-0.025em] text-[#123e2d]">Avanço por ensaio</h2>
            </div>
            <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-[#edf6d4] px-2.5 py-1 text-xs font-bold text-[#496a00]">
              <span className="size-2 rounded-full bg-[#75a000]" /> Ao vivo
            </span>
          </div>

          <div className="my-5 rounded-2xl bg-[#0b4b33] p-5 text-white">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-white/65">Total concluído</p>
                <p className="mt-1 text-4xl font-black tracking-[-0.04em]">{overallPercent}%</p>
              </div>
              <p className="text-right text-sm text-white/75"><strong className="text-lg text-white">{totalCompleted}</strong> pesadas<br />{Math.max(totalPlots - totalCompleted, 0)} faltam</p>
            </div>
            <Progress value={overallPercent} className="mt-4 h-3 bg-white/15 [&_[data-slot=progress-indicator]]:bg-[#d7de28]" />
          </div>

          <div className="space-y-3">
            {trials.map((trial) => (
              <article key={trial.entityName} className="rounded-2xl border border-[#e0e8dc] bg-[#fafcf8] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="inline-flex rounded-md bg-[#e7eedb] px-2 py-1 text-xs font-black text-[#4d6813]">{trial.trialType}</span>
                    <h3 className="mt-2 break-words text-base font-extrabold leading-tight text-[#173e2e]">{trial.entityName}</h3>
                    <p className="mt-1 text-sm text-[#6a7d71]">{trial.location} · parcelas {trial.initial}–{trial.final}</p>
                  </div>
                  <div className={`grid size-14 shrink-0 place-items-center rounded-full text-sm font-black ${trial.percent === 100 ? "bg-[#d7de28] text-[#284b18]" : "bg-[#e8eee4] text-[#3b5b49]"}`}>
                    {trial.percent}%
                  </div>
                </div>
                <Progress value={trial.percent} className="mt-4 h-2.5 bg-[#e1e8dc] [&_[data-slot=progress-indicator]]:bg-[#78a000]" />
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="font-bold text-[#365545]">{trial.completed} de {trial.total}</span>
                  <span className={trial.remaining === 0 ? "font-black text-[#4d7100]" : "font-semibold text-[#6c7f73]"}>
                    {trial.remaining === 0 ? "Ensaio finalizado" : `${trial.remaining} faltam`}
                  </span>
                </div>
              </article>
            ))}
          </div>

          <p className="mt-4 text-center text-xs text-[#7a8a81]">
            {loading ? "Carregando pesagens…" : "Atualização automática a cada 5 segundos"}
          </p>
        </aside>
      </div>
    </main>
  );
}

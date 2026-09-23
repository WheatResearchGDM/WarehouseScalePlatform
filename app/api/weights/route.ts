import { desc } from "drizzle-orm";
import plots from "@/data/plots.json";
import { getDb } from "@/db";
import { plotWeights } from "@/db/schema";

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Erro inesperado";
  return message.includes("no such table")
    ? "A base de pesagens ainda não está disponível."
    : message;
}

export async function GET() {
  try {
    const weights = await getDb()
      .select()
      .from(plotWeights)
      .orderBy(desc(plotWeights.updatedAt));
    return Response.json({ weights });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { uuid?: string; weight?: number };
    const uuid = payload.uuid?.trim().toUpperCase() ?? "";
    const weight = Number(payload.weight);
    const plot = plots.find((item) => item.uuid === uuid);

    if (!plot) {
      return Response.json({ error: "Parcela não encontrada." }, { status: 404 });
    }
    if (!Number.isFinite(weight) || weight <= 0) {
      return Response.json(
        { error: "Informe um peso maior que zero." },
        { status: 400 },
      );
    }

    const updatedAt = new Date().toISOString();
    const record = {
      uuid: plot.uuid,
      feid: plot.feid,
      entityName: plot.entityName,
      obsName: plot.obsName,
      weight,
      updatedAt,
    };

    await getDb()
      .insert(plotWeights)
      .values(record)
      .onConflictDoUpdate({
        target: plotWeights.uuid,
        set: {
          weight,
          updatedAt,
          feid: plot.feid,
          entityName: plot.entityName,
          obsName: plot.obsName,
        },
      });

    return Response.json({ weight: record });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

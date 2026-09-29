import { desc } from "drizzle-orm";
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
    const payload = (await request.json()) as {
      uuid?: string;
      feid?: string;
      entityName?: string;
      obsName?: string;
      weight?: number;
    };
    const uuid = payload.uuid?.trim().toUpperCase() ?? "";
    const feid = payload.feid?.trim() ?? "";
    const entityName = payload.entityName?.trim() ?? "";
    const obsName = payload.obsName?.trim() ?? "";
    const weight = Number(payload.weight);

    if (!uuid || !feid || !entityName || !obsName) {
      return Response.json({ error: "Dados da parcela incompletos." }, { status: 400 });
    }
    if (!Number.isFinite(weight) || weight <= 0) {
      return Response.json(
        { error: "Informe um peso maior que zero." },
        { status: 400 },
      );
    }

    const updatedAt = new Date().toISOString();
    const record = {
      uuid,
      feid,
      entityName,
      obsName,
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
          feid,
          entityName,
          obsName,
        },
      });

    return Response.json({ weight: record });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

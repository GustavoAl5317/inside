// app/api/logs/capture/route.ts
import type { NextRequest } from "next/server";
import { logCaptureService } from "@/lib/log-capture";
import { unifiedLogService } from "@/lib/unified-log-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Level = "info" | "error" | "success" | "warning" | "debug";
type LegacyLevel = "info" | "error" | "debug" | "warn";
type Source = "system" | "transaction" | "aws-lambda" | "omie" | "bitrix" | "client";

// -------------------- helpers --------------------

const toLevel = (v: any): Level => {
  const s = String(v ?? "info").toLowerCase();
  if (s === "warn") return "warning"; // legacy -> unificado
  if (s === "log") return "info";
  return (["info", "error", "success", "warning", "debug"] as const).includes(s as Level)
    ? (s as Level)
    : "info";
};

const toLegacyLevel = (l: Level): LegacyLevel => {
  if (l === "warning") return "warn";
  if (l === "success") return "info";
  return l as LegacyLevel;
};

const toSource = (v: any): Source => {
  const s = String(v ?? "client").toLowerCase();
  return (["system", "transaction", "aws-lambda", "omie", "bitrix", "client"] as const).includes(s as Source)
    ? (s as Source)
    : "client";
};

const toStr = (v: any) => (v === undefined || v === null ? "" : String(v));

function inferTypeFromMessage(message: string): string {
  const s = (message || "").toLowerCase();

  // 1) URLs do Omie (linhas "requestOmie config|params|response|catch")
  if (s.includes("requestomie")) {
    if (s.includes("/geral/produtos/")) return "checkProduto";
    if (s.includes("/servicos/servico/")) return "checkServico";
    if (s.includes("/servicos/os/")) return "createOSResult";
    if (s.includes("/produtos/pedidocompra/")) return "createOCResult";
  }

  // 2) Padrões de etapas pelo próprio texto
  const squashed = s.replace(/\s+/g, "");

  // fornecedor
  if (squashed.includes("checkfornecedor"))  return "checkFornecedor";
  if (squashed.includes("createfornecedor")) return "createFornecedor";

  // check cliente/produto/serviço
  if (squashed.includes("checkcliente")) return "checkCliente";
  if (squashed.includes("checkproduto")) return "checkProduto";
  if (squashed.includes("checkservico"))  return "checkServico";

  // create cliente/produto/OS/OV/OC
  if (squashed.includes("createcliente")) return "createCliente";
  if (squashed.includes("createprodutoresult") || squashed.includes("createproduto"))
    return "createProdutoResult";

  // OC
  if (squashed.includes("checkoc")) return "checkOC";
  if (squashed.includes("createocresult") || squashed.includes("createoc") ||
      squashed.includes("incluirpedcompra") || squashed.includes("alterarpedcompra") ||
      squashed.includes("upsertpedcompra") ||
      squashed.includes("pedidocompra"))
    return "createOCResult";

  // OV
  if (squashed.includes("checkov")) return "checkOV";
  if (squashed.includes("createovresult") || squashed.includes("createov") ||
      squashed.includes("incluirpedido") || squashed.includes("alterarpedidovenda") ||
      squashed.includes("pedidovenda"))
    return "createOVResult";

  // OS
  if (squashed.includes("checkos")) return "checkOS";
  if (squashed.includes("createosresult") || squashed.includes("createos") ||
      squashed.includes("incluiros") || squashed.includes("alteraros") ||
      squashed.includes("ordemservico"))
    return "createOSResult";

  // resultado final
  if (squashed.includes("result:") || squashed.includes("processamentoconcluido")) return "result";

  // 3) Heurística por endpoints mesmo sem "requestOmie"
  if (s.includes("geral/produtos")) return "checkProduto";
  if (s.includes("servicos/servico")) return "checkServico";
  if (s.includes("servicos/os")) return "createOSResult";
  if (s.includes("produtos/pedidocompra")) return "createOCResult";

  return "";
}

const toISO = (t: any) => {
  try {
    const d = typeof t === "number" ? new Date(t) : new Date(String(t));
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  } catch {
    return new Date().toISOString();
  }
};

function dedupe<T extends { id?: string; timestamp: string; message: string; source: string; transactionId?: any }>(
  arr: T[]
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of arr) {
    const key = `${item.id ?? ""}::${item.transactionId ?? ""}::${item.timestamp}::${item.source}::${item.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

// Verifica se o log tem conteúdo "cru" (request/response) ou veio explicitamente da Lambda
function isRaw(details: any, source: string): boolean {
  const meta = details ?? {};
  const rawBlock = meta.omie ?? meta.raw ?? null;
  const req = rawBlock?.requestBodyRaw ?? rawBlock?.request ?? null;
  const res = rawBlock?.responseBodyRaw ?? rawBlock?.response ?? null;
  const hasReq = typeof req === "string" && req.trim().length > 0;
  const hasRes = typeof res === "string" && res.trim().length > 0;
  const from = String(meta.from ?? "");
  const fromLambda = from.startsWith("lambda.");
  return Boolean(hasReq || hasRes || fromLambda || source === "aws-lambda");
}

// -------------------- POST --------------------

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body?.message || !body?.level) {
      return Response.json({ error: "Dados de log inválidos" }, { status: 400 });
    }

    const level = toLevel(body.level);
    const source = toSource(body.source);
    const metadata = body.metadata ?? {};

    const transactionId =
      body.transactionId ??
      metadata.transactionId ??
      body.processId ??
      metadata.processId;

    const _type = metadata._type ?? body.type ?? inferTypeFromMessage(body.message);

    // Compat com serviço "legacy"
    logCaptureService.captureLog(body.processId || "client", {
      timestamp: Date.now(),
      level: toLegacyLevel(level),
      message: body.message,
      source,
      metadata: {
        ...metadata,
        transactionId,
        _type,
      },
    });

    // Espelha no serviço unificado (usado pelo modal/UI)
    unifiedLogService.addLog({
      level,
      message: body.message,
      source,
      transactionId,
      metadata: {
        ...metadata,
        _type,
      },
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error("Erro ao processar captura de log:", error);
    return Response.json({ error: "Erro ao processar requisição" }, { status: 500 });
  }
}

// -------------------- GET --------------------

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const transactionId = searchParams.get("transactionId");
    const sourceParam = searchParams.get("source");
    const keyword = searchParams.get("keyword");
    const levelParam = searchParams.get("level");
    const limitParam = searchParams.get("limit");
    const typeParam = searchParams.get("type");
    const orderParam = (searchParams.get("order") || "desc").toLowerCase() as "asc" | "desc";
    const rawOnly = searchParams.get("rawOnly") === "1";

    const level = levelParam ? toLevel(levelParam) : undefined;
    const srcFilter = sourceParam ? toSource(sourceParam) : undefined;
    const wantTx = toStr(transactionId);
    const kw = (keyword || "").toLowerCase();
    const limit = limitParam ? Math.max(1, parseInt(limitParam)) : undefined;
    const typeFilter = typeParam ? String(typeParam) : undefined;

    // 1) Buscar logs do unificado (buffer em memória + DB)
    const unifiedFilters = {
      transactionId: wantTx || undefined,
      source: srcFilter,
      level,
      keyword: kw || undefined,
      limit,
      types: typeFilter ? [typeFilter] : undefined,
    };

    let unifiedRaw: any[] = [];
    try {
      const buffered = unifiedLogService.getBufferedLogs(unifiedFilters);
      const fromDb = await unifiedLogService.getLogs(unifiedFilters);
      unifiedRaw = [...(Array.isArray(buffered) ? buffered : []), ...(Array.isArray(fromDb) ? fromDb : [])];
    } catch {
      try {
        unifiedRaw = unifiedLogService.getBufferedLogs(unifiedFilters);
      } catch {
        unifiedRaw = [];
      }
    }

    let unified = unifiedRaw.map((log: any, i: number) => {
      const meta = log?.metadata ?? {};
      const _type = log?.type ?? meta?._type ?? inferTypeFromMessage(String(log?.message ?? ""));
      return {
        id: log?.id ?? `unified-${i}-${log?.timestamp ?? Date.now()}`,
        timestamp: toISO(log?.timestamp),
        level: toLevel(log?.level),
        message: String(log?.message ?? ""),
        source: toSource(log?.source),
        transactionId: log?.transactionId ?? wantTx,
        type: _type,
        details: meta,
      };
    });

    // 2) Agregar também os "legacy" (em memória)
    const legacyBuckets = [
      logCaptureService.getLogs("system"),
      logCaptureService.getLogs("transaction"),
      logCaptureService.getLogs("aws-lambda"),
      logCaptureService.getLogs("client"),
      logCaptureService.getLogs("omie"),
      logCaptureService.getLogs("bitrix"),
    ];

    let legacy = legacyBuckets
      .flat()
      .map((log: any, i: number) => {
        const _type = log?.metadata?._type ?? inferTypeFromMessage(String(log?.message ?? ""));
        return {
          id: `legacy-${i}-${log.timestamp}`,
          timestamp: toISO(log.timestamp),
          level: toLevel(log.level),
          message: String(log.message ?? ""),
          source: toSource(log.source),
          transactionId: log.metadata?.transactionId ?? undefined,
          type: _type,
          details: log.metadata ?? {},
        };
      });

    // Filtros também no legacy
    if (srcFilter) legacy = legacy.filter((l) => l.source === srcFilter);
    if (level) legacy = legacy.filter((l) => l.level === level);
    if (wantTx) legacy = legacy.filter((l) => toStr(l.transactionId) === wantTx);
    if (typeFilter) legacy = legacy.filter((l) => l.type === typeFilter);
    if (kw)
      legacy = legacy.filter(
        (l) =>
          l.message.toLowerCase().includes(kw) ||
          JSON.stringify(l.details || {}).toLowerCase().includes(kw)
      );

    // 3) Merge
    let all = [...unified, ...legacy];

    // 4) rawOnly: mantém APENAS logs realmente crus
    if (rawOnly) {
      all = all.filter((l) => isRaw(l.details, l.source));
    }

    // 5) Garantia extra de filtro por type no merged
    if (typeFilter) all = all.filter((l) => l.type === typeFilter);

    // 6) Dedupe + ordenação
    all = dedupe(all);
    all.sort((a, b) => {
      const da = new Date(a.timestamp).getTime();
      const db = new Date(b.timestamp).getTime();
      return orderParam === "asc" ? da - db : db - da;
    });

    // 7) Limit aplicado por último (após ordenar)
    if (limit) all = all.slice(0, limit);

    return Response.json({
      success: true,
      logs: all,
      total: all.length,
      filtered: !!(transactionId || sourceParam || keyword || levelParam || limitParam || typeParam || rawOnly),
      filters: {
        transactionId: wantTx || undefined,
        source: srcFilter,
        level,
        keyword: kw || undefined,
        limit,
        type: typeFilter,
        order: orderParam,
        rawOnly: rawOnly || undefined,
      },
    });
  } catch (error) {
    console.error("Erro ao buscar logs:", error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro desconhecido",
        logs: [],
      },
      { status: 500 }
    );
  }
}

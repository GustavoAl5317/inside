// lib/unified-log-service.ts
import 'server-only';
import { Pool } from 'pg';

// ---------- Conexão Postgres (lazy — criada só na primeira query) ----------
let _pool: Pool | null = null;
function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL ? { rejectUnauthorized: false } : undefined,
    });
  }
  return _pool;
}

// ---------- Tipos ----------
export type LogLevel = 'info' | 'error' | 'success' | 'warning' | 'debug';
export type LogSource = 'system' | 'transaction' | 'aws-lambda' | 'omie' | 'bitrix' | 'client' | 'webhook';

export interface UnifiedLog {
  id: string;
  timestamp: string; // ISO
  level: LogLevel;
  message: string;
  source: LogSource;
  transactionId?: string | number;
  metadata?: any;
  type?: string;
}

export interface UnifiedLogFilters {
  transactionId?: string | number;
  source?: string;   // lido de payload.source
  level?: string;    // mapeado de status
  keyword?: string;
  limit?: number;
  from?: string;     // ISO
  to?: string;       // ISO
  types?: string[];  // lido de payload._type
}

// ---------- Helpers ----------
function coerceLevel(v?: string): LogLevel {
  const lv = (v || '').toLowerCase();
  if (lv === 'error' || lv === 'success' || lv === 'warning' || lv === 'debug' || lv === 'info') return lv as LogLevel;
  return 'info';
}

function statusToLevel(status?: string): LogLevel {
  const s = (status || '').toLowerCase();
  if (s === 'failed' || s === 'error') return 'error';
  if (s === 'success' || s === 'sent' || s === 'ok') return 'success';
  if (s === 'warning') return 'warning';
  if (s === 'debug') return 'debug';
  return 'info'; // pending, processing, etc.
}

function levelToStatus(level?: LogLevel): string {
  switch (level) {
    case 'error': return 'failed';
    case 'success': return 'success';
    case 'warning': return 'warning';
    case 'debug': return 'debug';
    default: return 'pending';
  }
}

function sortByTimestampAsc<T extends { timestamp?: string }>(arr: T[]) {
  return [...arr].sort(
    (a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime()
  );
}

// ---------- Insert usando public.webhook_logs ----------
async function insertLog(row: {
  timestamp: string;
  level: LogLevel;
  message: string;
  source: LogSource;
  transactionId: string | number | null;
  metadata: any;
}) {
  // transaction_id é NOT NULL na sua tabela
  if (row.transactionId == null) {
    throw new Error('transactionId é obrigatório para inserir em public.webhook_logs');
  }

  // Guardamos message/source/type dentro de payload (JSONB) para não alterar o schema
  const payload = {
    message: row.message,
    source: row.source,
    _type: row?.metadata?._type ?? null,
    ...(row.metadata || {}),
  };

  await getPool().query(
    `
      INSERT INTO public.webhook_logs
        (transaction_id, payload, status, target_url, created_at, sent_at, response)
      VALUES ($1, $2::jsonb, $3, $4, $5::timestamptz, $6, $7)
    `,
    [
      Number(row.transactionId),
      JSON.stringify(payload),
      levelToStatus(row.level),
      row.metadata?.target_url ?? null,
      row.timestamp,
      row.metadata?.sent_at ?? null,
      row.metadata?.response ?? null,
    ]
  );
}

// ---------- Serviço ----------
class UnifiedLogService {
  private static instance: UnifiedLogService | null = null;
  private logs: UnifiedLog[] = [];
  private maxLogs = 10000;

  private constructor() {
    console.log('UnifiedLogService inicializado');
    // Opcional: garantir a existência da tabela
    // ensureWebhookLogsTable().catch(e => console.error('Falha ao garantir tabela webhook_logs', e));
  }

  public static getInstance(): UnifiedLogService {
    if (!UnifiedLogService.instance) UnifiedLogService.instance = new UnifiedLogService();
    return UnifiedLogService.instance;
  }

  // Adiciona no buffer e persiste em webhook_logs
  public async addLog(log: Omit<UnifiedLog, 'id' | 'timestamp'>): Promise<void> {
    const newLog: UnifiedLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date().toISOString(),
      ...log,
      level: coerceLevel((log as any)?.level),
      source: (log.source || 'webhook') as LogSource,
    };

    this.logs.push(newLog);
    if (this.logs.length > this.maxLogs) this.logs = this.logs.slice(-this.maxLogs);

    try {
      await insertLog({
        timestamp: newLog.timestamp,
        level: newLog.level,
        message: newLog.message,
        source: newLog.source,
        transactionId: newLog.transactionId ?? null, // vai validar no insert
        metadata: newLog.metadata ?? null,
      });
    } catch (error) {
      console.error('Erro ao salvar log no banco (webhook_logs):', error);
    }

    try {
      const tx = newLog.transactionId ? ` tx=${newLog.transactionId}` : '';
      const t = newLog.type ? ` type=${newLog.type}` : '';
      console.log(
        `[${newLog.source.toUpperCase()}][${newLog.level.toUpperCase()}]${tx}${t} ${newLog.message}`,
        newLog.metadata || ''
      );
    } catch { /* ignore */ }
  }

  // Logs ainda não persistidos (buffer em memória) — útil para polling em tempo real
  public getBufferedLogs(filters?: UnifiedLogFilters): UnifiedLog[] {
    let arr = [...this.logs];
    if (!filters) return sortByTimestampAsc(arr);

    const { transactionId, source, level, keyword, limit, types } = filters;
    if (transactionId != null) {
      const tx = String(transactionId);
      arr = arr.filter(l => String(l.transactionId ?? '') === tx);
    }
    if (source) arr = arr.filter(l => l.source === source);
    if (level) arr = arr.filter(l => l.level === level);
    if (types?.length) arr = arr.filter(l => (l.type ?? l.metadata?._type) && types.includes(String(l.type ?? l.metadata?._type)));
    if (keyword) {
      const kw = keyword.toLowerCase();
      arr = arr.filter(l =>
        l.message.toLowerCase().includes(kw) ||
        JSON.stringify(l.metadata ?? {}).toLowerCase().includes(kw)
      );
    }
    arr = sortByTimestampAsc(arr);
    if (limit) arr = arr.slice(-limit);
    return arr;
  }

  // Busca no banco (webhook_logs) com filtros compatíveis
  public async getLogs(filters?: UnifiedLogFilters): Promise<UnifiedLog[]> {
    try {
      const conditions: string[] = [];
      const params: any[] = [];

      if (filters) {
        const { transactionId, source, level, keyword, limit, from, to, types } = filters;

        if (transactionId != null) {
          conditions.push(`(wl.transaction_id = $${params.length + 1})`);
          params.push(Number(transactionId));
        }

        if (source) {
          // source está dentro de payload.source
          conditions.push(`LOWER(wl.payload->>'source') = LOWER($${params.length + 1})`);
          params.push(source);
        }

        if (level) {
          // level mapeia para status
          conditions.push(`LOWER(wl.status) = LOWER($${params.length + 1})`);
          params.push(levelToStatus(level as LogLevel));
        }

        if (keyword) {
          conditions.push(
            `(LOWER(wl.payload::text) LIKE LOWER($${params.length + 1}) OR LOWER(COALESCE(wl.response,'')) LIKE LOWER($${params.length + 2}))`
          );
          params.push(`%${keyword}%`, `%${keyword}%`);
        }

        if (from) {
          conditions.push(`wl.created_at >= $${params.length + 1}::timestamptz`);
          params.push(from);
        }

        if (to) {
          conditions.push(`wl.created_at <= $${params.length + 1}::timestamptz`);
          params.push(to);
        }

        if (types && types.length > 0) {
          conditions.push(`(wl.payload->>'_type') = ANY($${params.length + 1})`);
          params.push(types);
        }
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const limitClause = filters?.limit ? `LIMIT $${params.length + 1}` : '';
      if (filters?.limit) params.push(filters.limit);

      const query = `
        SELECT
          wl.id,
          wl.created_at::text AS created_at,
          wl.status,
          wl.transaction_id,
          wl.payload,
          wl.target_url,
          wl.response,
          wl.sent_at
        FROM public.webhook_logs wl
        ${whereClause}
        ORDER BY wl.created_at ASC
        ${limitClause}
      `;

      const result = await getPool().query(query, params);

      // Mapear webhook_logs → UnifiedLog
      const mapped: UnifiedLog[] = result.rows.map((row: any) => {
        const payload = row.payload || {};
        const msg = payload?.message ?? `Webhook ${row.status ?? 'event'}`;
        const src = (payload?.source as LogSource) || 'webhook';
        const meta = {
          ...payload,
          target_url: row.target_url,
          response: row.response,
          sent_at: row.sent_at,
          status: row.status,
        };

        return {
          id: String(row.id),
          timestamp: row.created_at,
          level: statusToLevel(row.status),
          message: msg,
          source: src,
          transactionId: row.transaction_id,
          metadata: meta,
          type: payload?._type ?? undefined,
        };
      });

      return mapped;
    } catch (error) {
      console.error('Erro ao buscar logs no banco (webhook_logs):', error);
      return [];
    }
  }

  // Busca “steps” do Omie apenas do buffer em memória
  public getOmieLogs(transactionId: string | number): UnifiedLog[] {
    const txId = transactionId.toString();

    const byTransaction = (log: UnifiedLog) =>
      log.transactionId?.toString() === txId ||
      log.message.includes(`transactionId: ${txId}`) ||
      log.message.includes(`Transaction #${txId}`) ||
      (log.metadata && JSON.stringify(log.metadata).includes(txId));

    const KNOWN_TYPES = new Set([
      'checkCliente',
      'createCliente',
      'checkProduto',
      'checkServico',
      'createProdutoResult',
      'createOSResult',
      'createOCResult',
      'result',
    ]);

    const isOmieStep = (log: UnifiedLog) => {
      const metaType = (log.metadata?._type || '').toString();
      if (log.type && KNOWN_TYPES.has(log.type)) return true;
      if (metaType && KNOWN_TYPES.has(metaType)) return true;

      const msg = (log.message || '').toLowerCase();
      const needles = [
        'checkcliente',
        'createcliente',
        'checkproduto',
        'checkservico',
        'createprodutoresult',
        'createosresult',
        'create os result',
        'createocresult',
        'create oc result',
        'result',
      ];
      return needles.some((n) => msg.includes(n));
    };

    const res = this.logs.filter((log) => byTransaction(log) && isOmieStep(log));
    return sortByTimestampAsc(res);
  }

  public clearOldLogs(olderThanHours: number = 24): void {
    const cutoffTime = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
    this.logs = this.logs.filter((log) => new Date(log.timestamp) > cutoffTime);
  }

  /** Remove logs em memória de uma transação (usado antes de reenvio ao Omie). */
  public clearTransactionLogs(transactionId: string | number): void {
    const tx = String(transactionId);
    this.logs = this.logs.filter(l => String(l.transactionId ?? '') !== tx);
  }

  public getStats(): {
    totalLogs: number;
    logsBySource: Record<string, number>;
    logsByLevel: Record<string, number>;
  } {
    const logsBySource: Record<string, number> = {};
    const logsByLevel: Record<string, number> = {};

    this.logs.forEach((log) => {
      logsBySource[log.source] = (logsBySource[log.source] || 0) + 1;
      const lv = coerceLevel(log.level);
      logsByLevel[lv] = (logsByLevel[lv] || 0) + 1;
    });

    return {
      totalLogs: this.logs.length,
      logsBySource,
      logsByLevel,
    };
  }
}

// ---------- Tipagem/Helper pra RAW do Omie ----------
export interface OmieMetadata {
  _type?: string; // step (ex.: 'checkCliente')
  omie?: {
    endpoint: string;
    httpStatus: number;
    requestBodyRaw: string;
    responseBodyRaw: string;
    responseHeaders?: Record<string,string>;
    requestHeaders?: Record<string,string>;
  };
  // + seus campos (target_url, response, sent_at, etc.)
}

// Salva um log contendo o RAW do Omie
export async function addOmieRawLog(params: {
  transactionId: string | number;
  step: string;                  // 'checkCliente', 'createOSResult', etc.
  level: LogLevel;               // 'info' | 'success' | 'error'...
  message: string;               // resumo curto
  runId?: string | null;         // identificador da execução (para separar reenvios)
  raw: {
    endpoint: string;
    httpStatus: number;
    requestBodyRaw: string;
    responseBodyRaw: string;
    requestHeaders?: Record<string,string>;
    responseHeaders?: Record<string,string>;
  }
}) {
  await unifiedLogService.addLog({
    level: params.level,
    message: params.message,
    source: 'omie',
    transactionId: params.transactionId,
    type: params.step,
    metadata: {
      _type: params.step,
      runId: params.runId ?? null,
      omie: {
        endpoint: params.raw.endpoint,
        httpStatus: params.raw.httpStatus,
        requestBodyRaw: params.raw.requestBodyRaw,
        responseBodyRaw: params.raw.responseBodyRaw,
        requestHeaders: params.raw.requestHeaders,
        responseHeaders: params.raw.responseHeaders,
      },
    },
  });
}

// (Opcional) Auto-create se precisar
async function ensureWebhookLogsTable() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS public.webhook_logs (
      id             SERIAL PRIMARY KEY,
      transaction_id INTEGER NOT NULL,
      payload        JSONB   NOT NULL,
      status         VARCHAR(20) NOT NULL DEFAULT 'pending',
      target_url     VARCHAR(255),
      created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sent_at        TIMESTAMP,
      response       TEXT
    );
  `);
  await getPool().query(`CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at ON public.webhook_logs (created_at);`);
  await getPool().query(`CREATE INDEX IF NOT EXISTS idx_webhook_logs_status     ON public.webhook_logs (status);`);
  await getPool().query(`CREATE INDEX IF NOT EXISTS idx_webhook_logs_tx         ON public.webhook_logs (transaction_id);`);
}

// ---------- Singleton ----------
export const unifiedLogService = UnifiedLogService.getInstance();

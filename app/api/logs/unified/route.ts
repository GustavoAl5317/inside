import { NextRequest, NextResponse } from 'next/server';
import { unifiedLogService } from '@/lib/unified-log-service';

export const dynamic = 'force-dynamic'
// opcional: se você tem o logCaptureService (app/api/logs/capture)
// descomente para agregar também esses logs.
// import { logCaptureService } from '@/lib/log-capture'

type UiLevel = 'info' | 'error' | 'success' | 'warning' | 'debug';

interface UiLog {
  id: string;
  timestamp: string;
  level: UiLevel;
  message: string;
  type: string;
  data?: any;
}

// -------------------- DEDUÇÃO DE LEVEL E TYPE PELO TEXTO --------------------

const RX = {
  // marcadores CloudWatch
  init: /\bINIT_START\b/i,
  start: /\bSTART\b/i,
  end: /\bEND\b/i,
  report: /\bREPORT\b/i,

  // níveis / erros
  error: /\b(ERROR|faultstring|faultcode|catch error|exception)\b/i,
  warn: /\bWARN(ING)?\b/i,
  info: /\bINFO\b/i,
  successHints: /\b(sucesso|conclu[ií]do|ok)\b/i,

  // steps Omie (flexíveis / case-insensitive)
  checkCliente: /check\s*cliente/i,
  createCliente: /create\s*cliente/i,
  checkProduto: /check\s*produto/i,
  checkServico: /check\s*servi[cç]o/i,

  // OS/OC – vários formatos que aparecem nos seus logs
  createOS: /(create\s*os|incluir\s*os|servicos\/os|IncluirOS)/i,
  createOC: /(create\s*oc|pedidocompra|IncluirPedCompra)/i,

  // produto criado/consultado
  createProduto: /(create\s*produto|ConsultarProduto|createProdutoResult|produto\s+processad)/i,

  // resultado final marcado explicitamente
  result: /\bresult\b/i,
};

function inferLevelFromText(line: string, fallback: UiLevel = 'info'): UiLevel {
  if (RX.error.test(line)) return 'error';
  if (RX.warn.test(line)) return 'warning';
  if (RX.init.test(line) || RX.start.test(line) || RX.end.test(line) || RX.report.test(line)) return 'debug';
  if (RX.successHints.test(line) && !RX.error.test(line)) return 'success';
  if (RX.info.test(line)) return 'info';
  return fallback;
}

function inferTypeFromText(line: string): string {
  if (RX.checkCliente.test(line)) return 'checkCliente';
  if (RX.createCliente.test(line)) return 'createCliente';
  if (RX.checkProduto.test(line)) return 'checkProduto';
  if (RX.checkServico.test(line)) return 'checkServico';
  if (RX.createOS.test(line)) return 'createOSResult';
  if (RX.createOC.test(line)) return 'createOC'; // modal normaliza para createOCResult
  if (RX.createProduto.test(line)) return 'createProdutoResult';
  if (RX.result.test(line)) return 'result';

  // fallback por endpoints comuns
  if (/servicos\/os/i.test(line)) return 'createOSResult';
  if (/produtos\/pedidocompra/i.test(line)) return 'createOC';
  if (/geral\/produtos/i.test(line)) return 'checkProduto';

  return 'result';
}

function normalizeIncomingLevel(v: any): UiLevel {
  if (v === 'warn') return 'warning';
  if (v === 'success') return 'success';
  if (v === 'error' || v === 'info' || v === 'warning' || v === 'debug') return v;
  return 'info';
}

function dedupe<T extends { timestamp?: any; message?: any }>(arr: T[]) {
  const set = new Set<string>();
  return arr.filter((e) => {
    const key = `${new Date(e.timestamp ?? Date.now()).toISOString().slice(0, 19)}|${String(e.message ?? '')}`;
    if (set.has(key)) return false;
    set.add(key);
    return true;
  });
}

// -------------------- HANDLER --------------------

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const transactionId = searchParams.get('transactionId');
    const source = searchParams.get('source');
    const level = searchParams.get('level');
    const keyword = searchParams.get('keyword');
    const limit = searchParams.get('limit');
    const action = searchParams.get('action');
    const order = (searchParams.get('order') || 'asc').toLowerCase(); // asc|desc

    // ---------- AÇÃO ESPECIAL: OMIE (com classificação pós-fato) ----------
    if (action === 'omie' && transactionId) {
      const txId = transactionId.toString();

      // 1) coleta: unified logs (AGORA COM AWAIT)
      const unifiedRaw = await unifiedLogService.getLogs({});
      const unified: any[] = Array.isArray(unifiedRaw) ? unifiedRaw : [];

      // 2) coleta extra do logCaptureService (se você usa esse storage também)
      // let captured: any[] = [];
      // try {
      //   const sys = logCaptureService.getLogs('system') as any[];
      //   const trx = logCaptureService.getLogs('transaction') as any[];
      //   const aws = logCaptureService.getLogs('aws-lambda') as any[];
      //   captured = [...sys, ...trx, ...aws];
      // } catch { /* ok se não existir */ }

      const combined = [
        ...unified,
        // ...captured,
      ];

      // 3) filtra por transactionId em metadata/message
      let filtered = combined.filter((log: any) => {
        const inMeta =
          log.transactionId?.toString() === txId ||
          (log.metadata && JSON.stringify(log.metadata).includes(txId));
        const inMsg =
          typeof log.message === 'string' &&
          (log.message.includes(txId) ||
            log.message.includes(`Transaction #${txId}`) ||
            log.message.includes(`transactionId: ${txId}`));
        return inMeta || inMsg;
      });

      // 4) filtros opcionais
      if (source) filtered = filtered.filter((l: any) => l.source === source);
      if (keyword) {
        const k = keyword.toLowerCase();
        filtered = filtered.filter(
          (l: any) =>
            String(l.message ?? '').toLowerCase().includes(k) ||
            JSON.stringify(l.metadata ?? {}).toLowerCase().includes(k)
        );
      }
      if (level) {
        filtered = filtered.filter(
          (l: any) => normalizeIncomingLevel(l.level) === normalizeIncomingLevel(level)
        );
      }

      // 5) ordena conforme query param
      filtered.sort((a: any, b: any) => {
        const ta = new Date(a.timestamp ?? a.time ?? Date.now()).getTime();
        const tb = new Date(b.timestamp ?? b.time ?? Date.now()).getTime();
        return order === 'desc' ? tb - ta : ta - tb;
      });

      // 6) mapeia → formato do modal (deduzindo level/type pós-fato)
      const formatted: UiLog[] = filtered.map((raw: any, idx: number) => {
        const msg = typeof raw.message === 'string' ? raw.message : JSON.stringify(raw.message);
        const ts = raw.timestamp ?? raw.time ?? new Date().toISOString();
        const lvl = normalizeIncomingLevel(raw.level);
        const deducedLevel = inferLevelFromText(msg, lvl);
        const type = raw.metadata?._type || inferTypeFromText(msg);

        const finalLevel: UiLevel =
          type === 'result' && /sucesso|conclu[ií]do/i.test(msg) && !/error|fault/i.test(msg)
            ? 'success'
            : deducedLevel;

        return {
          id: raw.id || `omie-${idx}-${Date.parse(ts) || Date.now()}`,
          timestamp: new Date(ts).toISOString(),
          level: finalLevel,
          message: msg,
          type,
          data: raw.metadata ?? { source: raw.source },
        };
      });

      // 7) dedup e limit
      let logs = dedupe(formatted);
      if (limit) {
        const n = parseInt(limit, 10);
        if (!Number.isNaN(n) && n > 0) logs = order === 'desc' ? logs.slice(0, n) : logs.slice(-n);
      }

      return NextResponse.json({
        success: true,
        logs,
        total: logs.length,
        transactionId: txId,
      });
    }

    // ---------- BUSCA GERAL PADRÃO ----------
    const filters: any = {};
    if (transactionId) filters.transactionId = transactionId;
    if (source) filters.source = source;
    if (level) filters.level = level;
    if (keyword) filters.keyword = keyword;
    if (limit) {
      const n = parseInt(limit, 10);
      if (!Number.isNaN(n)) filters.limit = n;
    }

    const serviceLogsRaw = await unifiedLogService.getLogs(filters);
    const logs: any[] = Array.isArray(serviceLogsRaw) ? serviceLogsRaw : [];

    // ordena conforme order (o serviço já retorna ASC por created_at, mas mantemos o param)
    logs.sort((a: any, b: any) => {
      const ta = new Date(a.timestamp ?? Date.now()).getTime();
      const tb = new Date(b.timestamp ?? Date.now()).getTime();
      return order === 'desc' ? tb - ta : ta - tb;
    });

    return NextResponse.json({
      success: true,
      logs,
      total: logs.length,
      filters,
    });
  } catch (error) {
    console.error('Erro ao buscar logs:', error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

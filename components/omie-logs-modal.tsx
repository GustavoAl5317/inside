'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Loader2, CheckCircle, XCircle, Download, RefreshCw, Eye, List, Search, ChevronDown, ChevronRight, Wrench, Trash2 } from 'lucide-react';
import { getDealPayloadAction, updateDealPayloadAndStatusAction, clearTransactionLogsAction } from '@/lib/actions';
import type { PayloadChange } from '@/lib/deal-payload-diff';

type Level = 'info' | 'error' | 'success' | 'warning' | 'debug';

interface OmieLog {
  id: string;
  timestamp: string;          // ISO
  level: Level;
  message: string;
  type: string;
  source?: string;
  transactionId?: string | number;
  runId?: string | null;
  data?: any;
  omieRequestRaw?: string | null;
  omieResponseRaw?: string | null;
  fromLambda?: boolean;
}

interface OmieLogsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transactionId: number;
  runKey?: number;
  runId?: string;
  changes?: PayloadChange[];
  showChangesPanel?: boolean;
  onComplete?: () => void;
}

const steps = [
  { key: 'checkFornecedor',     label: 'Verificando Fornecedor',    icon: '🏢' },
  { key: 'createFornecedor',    label: 'Criando Fornecedor',        icon: '🏗️' },
  { key: 'checkCliente',        label: 'Verificando Cliente',       icon: '👤' },
  { key: 'createCliente',       label: 'Criando Cliente',           icon: '✨' },
  { key: 'checkProduto',        label: 'Verificando Produtos',      icon: '📦' },
  { key: 'checkServico',        label: 'Verificando Serviços',      icon: '🔧' },
  { key: 'createProdutoResult', label: 'Criando Produtos',          icon: '🏭' },
  { key: 'createOCResult',      label: 'Criando Ordem de Compra',   icon: '📄' },
  { key: 'createOVResult',      label: 'Criando Ordem de Venda',    icon: '🛒' },
  { key: 'createOSResult',      label: 'Criando Ordem de Serviço',  icon: '📋' },
  { key: 'result',              label: 'Finalizando',               icon: '🎉' },
] as const;

type StepKey = typeof steps[number]['key'];

const normalizeType = (t: string): StepKey | '' =>
  (t === 'createOC' ? 'createOCResult' : (steps.some(s => s.key === t) ? (t as StepKey) : ''));

/** Overlay 3D exibido no fim do envio ao Omie: emblema holográfico girando
 *  em perspectiva com anéis neon (sucesso) ou glitch com tremor 3D (erro). */
const Result3DOverlay: React.FC<{ kind: 'success' | 'error' }> = ({ kind }) => {
  const ok = kind === 'success';
  const color = ok ? '#10b981' : '#ef4444';
  const glow = ok ? 'rgba(16,185,129,0.55)' : 'rgba(239,68,68,0.55)';
  const particles = Array.from({ length: 14 }, (_, i) => {
    const angle = (i / 14) * Math.PI * 2;
    return { x: Math.cos(angle) * 130, y: Math.sin(angle) * 130, delay: 0.25 + (i % 5) * 0.05 };
  });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[60] flex items-center justify-center pointer-events-none"
      style={{ perspective: 1000, background: 'radial-gradient(ellipse at center, rgba(11,16,41,0.72), rgba(11,16,41,0.45))', backdropFilter: 'blur(6px)' }}
    >
      {/* Anéis neon expandindo em 3D */}
      {[0, 0.18, 0.36].map((d, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full border-2"
          style={{ width: 120, height: 120, borderColor: color, transformStyle: 'preserve-3d' }}
          initial={{ scale: 0.4, opacity: 0.9, rotateX: 55 }}
          animate={{ scale: 2.6 + i * 0.5, opacity: 0, rotateX: 55 }}
          transition={{ duration: 1.4, delay: d, ease: 'easeOut', repeat: Infinity, repeatDelay: 0.4 }}
        />
      ))}

      {/* Partículas orbitando */}
      {particles.map((p, i) => (
        <motion.div
          key={`p${i}`}
          className="absolute w-1.5 h-1.5 rounded-full"
          style={{ background: color, boxShadow: `0 0 8px 2px ${glow}` }}
          initial={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
          animate={{ x: p.x, y: p.y, opacity: [0, 1, 0], scale: [0.4, 1.1, 0.3] }}
          transition={{ duration: 1.3, delay: p.delay, ease: 'easeOut' }}
        />
      ))}

      {/* Emblema central com flip 3D */}
      <motion.div
        className="relative flex flex-col items-center gap-3"
        style={{ transformStyle: 'preserve-3d' }}
        initial={{ rotateY: -180, scale: 0.3, opacity: 0 }}
        animate={
          ok
            ? { rotateY: 0, scale: 1, opacity: 1 }
            : { rotateY: 0, scale: 1, opacity: 1, x: [0, -12, 12, -8, 8, -4, 4, 0], rotateZ: [0, -2, 2, -1.5, 1.5, 0] }
        }
        transition={
          ok
            ? { type: 'spring', stiffness: 190, damping: 16 }
            : { rotateY: { type: 'spring', stiffness: 190, damping: 16 }, scale: { type: 'spring', stiffness: 190, damping: 16 }, x: { duration: 0.55, delay: 0.35 }, rotateZ: { duration: 0.55, delay: 0.35 } }
        }
      >
        <div
          className="w-24 h-24 rounded-3xl flex items-center justify-center"
          style={{
            background: ok
              ? 'linear-gradient(135deg, rgba(16,185,129,0.25), rgba(34,211,238,0.18))'
              : 'linear-gradient(135deg, rgba(239,68,68,0.28), rgba(139,92,246,0.15))',
            border: `2px solid ${color}`,
            boxShadow: `0 0 42px 6px ${glow}, inset 0 0 24px ${glow}`,
            transform: 'translateZ(40px)',
          }}
        >
          {ok
            ? <CheckCircle className="w-12 h-12" style={{ color, filter: `drop-shadow(0 0 10px ${glow})` }} />
            : <XCircle className="w-12 h-12" style={{ color, filter: `drop-shadow(0 0 10px ${glow})` }} />}
        </div>
        <motion.p
          className="text-base font-bold tracking-wide"
          style={{ color, textShadow: `0 0 18px ${glow}`, transform: 'translateZ(30px)' }}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
        >
          {ok ? 'Enviado ao Omie com sucesso!' : 'Falha no envio ao Omie'}
        </motion.p>
      </motion.div>
    </motion.div>
  );
};

// tenta inferir o step pelo TEXTO quando _type vem genérico
const inferStepFromMessage = (msg?: string): StepKey | '' => {
  if (!msg) return '';
  const m = msg.toLowerCase().replace(/\s+/g, '');
  if (m.includes('checkfornecedor'))  return 'checkFornecedor';
  if (m.includes('createfornecedor')) return 'createFornecedor';
  if (m.includes('checkservico'))     return 'checkServico';
  if (m.includes('checkproduto'))     return 'checkProduto';
  if (m.includes('checkcliente'))     return 'checkCliente';
  if (m.includes('createcliente'))    return 'createCliente';
  if (m.includes('createocresult') || m.includes('createoc') || m.includes('ordemdecompra') || m.includes('incluirpedcompra') || m.includes('upsertpedcompra') || m.includes('alterarpedcompra')) return 'createOCResult';
  if (m.includes('createovresult') || m.includes('createov') || m.includes('ordemdevenda') || m.includes('incluirpedido') || m.includes('alterarpedidovenda')) return 'createOVResult';
  if (m.includes('createosresult') || m.includes('createos') || m.includes('ordemdeservico') || m.includes('incluiros') || m.includes('alteraros')) return 'createOSResult';
  if (m.includes('createprodutoresult') || m.includes('createproduto')) return 'createProdutoResult';
  if (m.includes('processamentoconcluído') || m.includes('processamentoconcluido') || m.includes('result:')) return 'result';
  return '';
};

// Badge que indica se o pedido foi criado ou atualizado no Omie
const AcaoBadge: React.FC<{ acao?: string }> = ({ acao }) => {
  const atualizado = acao === 'updated';
  return (
    <span
      className={`ml-1.5 inline-block text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ring-1 ${
        atualizado
          ? 'bg-amber-100 text-amber-700 ring-amber-200'
          : 'bg-emerald-100 text-emerald-700 ring-emerald-200'
      }`}
    >
      {atualizado ? 'Atualizado' : 'Criado'}
    </span>
  );
};

function ChangesPanel({ items, forceShow = false }: { items: PayloadChange[]; forceShow?: boolean }) {
  if (!items.length && !forceShow) return null
  if (!items.length) {
    return (
      <div className="bg-white rounded border border-amber-200 p-3">
        <p className="font-semibold text-amber-800 mb-1 text-xs uppercase tracking-wide">
          ✏️ Alterações enviadas ao Omie
        </p>
        <p className="text-xs text-gray-500">Nenhuma alteração detectada nos dados do formulário.</p>
      </div>
    )
  }
  return (
    <div className="bg-white rounded border border-amber-200 p-3 space-y-2">
      <p className="font-semibold text-amber-800 mb-1 text-xs uppercase tracking-wide">
        ✏️ Alterações enviadas ao Omie
      </p>
      <ul className="space-y-1.5 max-h-48 overflow-y-auto">
        {items.map((c, i) => (
          <li key={i} className="text-xs border-b border-amber-50 pb-1.5 last:border-0 last:pb-0">
            <span className="font-medium text-gray-800">{c.label}</span>
            {c.kind === 'added' ? (
              <p className="text-emerald-700 mt-0.5">+ {c.after}</p>
            ) : c.kind === 'removed' ? (
              <p className="text-red-600 mt-0.5 line-through">{c.before}</p>
            ) : (
              <p className="text-gray-600 mt-0.5">
                <span className="line-through text-red-500/80">{c.before}</span>
                <span className="mx-1 text-gray-400">→</span>
                <span className="text-emerald-700 font-medium">{c.after}</span>
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

const OmieLogsModal: React.FC<OmieLogsModalProps> = ({
  open,
  onOpenChange,
  transactionId,
  runKey = 0,
  runId = "",
  changes = [],
  showChangesPanel = false,
  onComplete,
}) => {
  const [rawLogs, setRawLogs] = useState<OmieLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const [currentStep, setCurrentStep] = useState<StepKey | ''>('');
  const [completedSteps, setCompletedSteps] = useState<Set<StepKey>>(new Set());
  const [failedSteps, setFailedSteps] = useState<Set<StepKey>>(new Set());
  const [touchedSteps, setTouchedSteps] = useState<Set<StepKey>>(new Set());
  const [isComplete, setIsComplete] = useState(false);
  const [hasError, setHasError] = useState(false);

  // Overlay 3D de resultado (sucesso/erro) — dispara na transição do estado
  const [resultFx, setResultFx] = useState<'success' | 'error' | null>(null);
  const prevCompleteRef = useRef(false);
  const prevErrorRef = useRef(false);
  useEffect(() => {
    const rose = isComplete && !prevCompleteRef.current;
    prevCompleteRef.current = isComplete;
    if (rose) {
      setResultFx('success');
      const t = setTimeout(() => setResultFx(null), 2400);
      return () => clearTimeout(t);
    }
  }, [isComplete]);
  useEffect(() => {
    const rose = hasError && !isComplete && !prevErrorRef.current;
    prevErrorRef.current = hasError;
    if (rose) {
      setResultFx('error');
      const t = setTimeout(() => setResultFx(null), 2400);
      return () => clearTimeout(t);
    }
  }, [hasError, isComplete]);

  const [resumo, setResumo] = useState<{ oc: any[]; ov: any[]; os: any[]; alteracoes?: PayloadChange[] } | null>(null);
  const [showDetailedLogs, setShowDetailedLogs] = useState(false);
  const [selectedLogType, setSelectedLogType] = useState<'all' | StepKey>('all');
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [visible, setVisible] = useState(500);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());

  // ---- PAINEL DE CORREÇÃO ----
  type FixProduct = {
    partnumber: string;
    description: string;
    ncm: string;
    cfop: string;
    unit: string;
    errorMsg: string;
  };
  const [showFixPanel, setShowFixPanel] = useState(false);
  const [fixProducts, setFixProducts] = useState<FixProduct[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  // ---- CONTROLE DE POLLING ----
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchingRef = useRef(false);
  const delayRef = useRef(1500);
  const lastHashRef = useRef<string>('');
  const isCompleteRef = useRef(false);
  const runStartedAtRef = useRef<string>('');

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const scheduleNext = (ms: number) => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      if (document.visibilityState === 'hidden') {
        scheduleNext(5000);
        return;
      }
      void fetchOmieLogs(true);
    }, ms);
  };

  const fetchOmieLogs = async (fromPoll = false) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    if (!fromPoll) setLoadingLogs(true);

    try {
      // 🔧 CORREÇÃO: Removido filtros restritivos para mostrar TODOS os logs da transação
      const url = `/api/logs/capture?transactionId=${transactionId}&order=asc`;
      const response = await fetch(url, { cache: 'no-store' });
      const data = await response.json();

      const rawList: any[] = Array.isArray(data?.logs) ? (data.logs as any[]) : [];

      const toLog = (l: any): OmieLog => {
        const meta = l?.details ?? l?.metadata ?? {};
        const rawBlock = meta?.omie ?? meta?.raw ?? l?.raw ?? l?.omie ?? {};
        const omieRequestRaw =
          (typeof rawBlock?.requestBodyRaw === 'string' && rawBlock.requestBodyRaw) ||
          (typeof rawBlock?.request === 'string' && rawBlock.request) ||
          null;
        const omieResponseRaw =
          (typeof rawBlock?.responseBodyRaw === 'string' && rawBlock.responseBodyRaw) ||
          (typeof rawBlock?.response === 'string' && rawBlock.response) ||
          null;
        const fromLambda =
          typeof (meta?.from || '') === 'string' && String(meta.from).startsWith('lambda.');

        const originalType = (l.type || meta?._type || '') as string;
        const typed = normalizeType(originalType);
        const hinted = inferStepFromMessage(String(l.message ?? ''));
        const resolvedType = (typed || hinted || 'result') as StepKey | 'result';

        return {
          id: String(l.id ?? `${l.timestamp ?? Date.now()}-${Math.random()}`),
          timestamp: (l.timestamp || l.created_at || new Date().toISOString()) as string,
          level: (l.level as Level) || 'info',
          message: String(l.message ?? ''),
          type: resolvedType,
          source: l.source,
          transactionId: l.transactionId ?? l.transaction_id,
          runId: meta?.runId ?? null,
          data: meta, // aqui chegam `stream` e `ts` quando vierem do CloudWatch
          omieRequestRaw,
          omieResponseRaw,
          fromLambda,
        };
      };

      const parsedAll: OmieLog[] = rawList.map(toLog);
      // Escopo da execução atual:
      // 1) Preferimos filtrar pelo runId desta execução (robusto a diferença de
      //    relógio entre cliente e servidor).
      // 2) Se não houver runId (execuções antigas), caímos no filtro por timestamp.
      let scopedLogs: OmieLog[];
      if (runId) {
        scopedLogs = parsedAll.filter(l => l.runId === runId);
      } else {
        const runStartedAt = runStartedAtRef.current
          ? new Date(runStartedAtRef.current).getTime()
          : 0;
        scopedLogs = runStartedAt > 0
          ? parsedAll.filter(l => new Date(l.timestamp).getTime() >= runStartedAt - 500)
          : parsedAll;
      }

      const newHash = JSON.stringify(
        scopedLogs.map((l) => [l.id, l.timestamp, l.level, l.message, l.type])
      );
      const changed = newHash !== lastHashRef.current;

      if (changed) {
        lastHashRef.current = newHash;
      }

      const omieLogs = scopedLogs.filter(l => l.source === 'omie');
      const logsToUse = omieLogs.length > 0 ? omieLogs : scopedLogs;
      if (logsToUse.length > 0) {
        setRawLogs(logsToUse);
        processStepsFromLogs(logsToUse);
      }

      // Marca como carregado após a 1ª resposta (mesmo vazia) — evita spinner infinito
      if (!hasLoadedOnce) {
        setHasLoadedOnce(true);
      }

      if (changed) {
        delayRef.current = 1500;
      } else {
        delayRef.current = Math.min(delayRef.current + 1500, 10000);
      }
    } catch {
      delayRef.current = Math.min(delayRef.current + 2000, 12000);
    } finally {
      fetchingRef.current = false;
      if (!fromPoll) setLoadingLogs(false);
      if (open && !isCompleteRef.current) {
        scheduleNext(delayRef.current);
      }
    }
  };

  // Função para salvar logs quando processo for concluído
  const saveLogsForLater = async () => {
    if (!isComplete || rawLogs.length === 0) return;
    
    try {
      await fetch('/api/logs/save-completed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId,
          logs: rawLogs,
          completedAt: new Date().toISOString(),
          status: hasError ? 'error' : 'success'
        })
      });
    } catch (error) {
      console.error('Erro ao salvar logs:', error);
    }
  };

  useEffect(() => {
    if (!open || !transactionId) {
      clearTimer();
      return;
    }
    resetModalState();
    void fetchOmieLogs(false);
    scheduleNext(1500);
    return () => clearTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transactionId, runKey, runId]);

  useEffect(() => {
    isCompleteRef.current = isComplete;
  }, [isComplete]);

  useEffect(() => {
    const onVis = () => {
      if (!open) return;
      if (document.visibilityState === 'visible') {
        scheduleNext(1000);
      } else {
        clearTimer();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [open]);

  useEffect(() => {
    if (isComplete && onComplete) {
      // Salvar logs antes de chamar onComplete
      saveLogsForLater();
      const t = setTimeout(() => onComplete(), 3000);
      return () => clearTimeout(t);
    }
  }, [isComplete, onComplete]);

  // ------------- PROCESSAMENTO DOS STEPS MELHORADO -------------
  const processStepsFromLogs = (logsIn: OmieLog[]) => {
    if (!logsIn || logsIn.length === 0) {
      setCurrentStep('');
      setIsComplete(false);
      isCompleteRef.current = false;
      setHasError(false);
      setCompletedSteps(new Set());
      setFailedSteps(new Set());
      setTouchedSteps(new Set());
      return;
    }

    const ordered = [...logsIn].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const stepOrder: StepKey[] = steps.map(s => s.key);
    const touchedOrder: StepKey[] = [];
    const touched = new Set<StepKey>();
    const lastLevelByStep = new Map<StepKey, Level>();
    const failed = new Set<StepKey>();
    const stepLogs = new Map<StepKey, OmieLog[]>();

    // Inicializar mapa de logs por step
    stepOrder.forEach(step => stepLogs.set(step, []));

    let lastTouched: StepKey | '' = '';

    for (const log of ordered) {
      const t = normalizeType(log.type) || (log.type as StepKey | '');
      if (!t || !stepOrder.includes(t)) {
        // Se não conseguiu identificar o step mas há erro, marca o último step tocado como erro
        if (log.level === 'error' && lastTouched) {
          failed.add(lastTouched);
          lastLevelByStep.set(lastTouched, 'error');
        }
        continue;
      }

      // Adicionar log ao step correspondente
      const currentStepLogs = stepLogs.get(t) || [];
      currentStepLogs.push(log);
      stepLogs.set(t, currentStepLogs);

      touched.add(t);
      if (!touchedOrder.includes(t)) touchedOrder.push(t);
      lastLevelByStep.set(t, log.level);
      lastTouched = t;
      
      // Marcar como falha se houver erro
      if (log.level === 'error') {
        failed.add(t);
      }
    }

    const last = ordered[ordered.length - 1];
    const lastType = normalizeType(last.type) || (last.type as StepKey | '');
    const anyError = failed.size > 0 || last.level === 'error';
    setHasError(anyError);

    const finishedOk = lastType === 'result' && last.level === 'success';
    setIsComplete(finishedOk);
    isCompleteRef.current = finishedOk;

    // Extrai o resumo do log result quando concluído com sucesso
    if (finishedOk) {
      const resultLog = ordered.find(l => (normalizeType(l.type) || inferStepFromMessage(l.message)) === 'result' && l.level === 'success')
      if (resultLog) {
        const raw = resultLog.data?.omie?.responseBodyRaw || resultLog.omieResponseRaw
        try { if (raw) setResumo(JSON.parse(raw)) } catch {}
      }
    }

    // Lógica melhorada para determinar steps completados
    const completed = new Set<StepKey>();
    for (let i = 0; i < touchedOrder.length; i++) {
      const k = touchedOrder[i];
      const stepLogsForK = stepLogs.get(k) || [];

      // Step é considerado completo se:
      // 1. Tem logs de sucesso OU
      // 2. Foi avançado para o próximo step (não é o último) E não tem erros
      const hasSuccess = stepLogsForK.some(log => log.level === 'success');
      const advanced = i < touchedOrder.length - 1;
      const hasErrors = failed.has(k);

      if ((hasSuccess || advanced) && !hasErrors) {
        completed.add(k);
      }
    }

    // Determinar step atual
    let current: StepKey | '' = '';
    if (!finishedOk && touchedOrder.length > 0) {
      const lastTouchedStep = touchedOrder[touchedOrder.length - 1];
      const lastTouchedLevel = lastLevelByStep.get(lastTouchedStep);
      
      // Se o último step tocado ainda está em progresso (info/debug) e não falhou
      if ((lastTouchedLevel === 'info' || lastTouchedLevel === 'debug') && !failed.has(lastTouchedStep)) {
        current = lastTouchedStep;
      }
    }
    
    if (lastType === 'result' && (last.level === 'success' || last.level === 'error')) {
      current = '';
    }

    setCurrentStep(current);
    setCompletedSteps(completed);
    setFailedSteps(failed);
    setTouchedSteps(touched);
  };

  const getStepStatus = (stepKey: StepKey) => {
    if (failedSteps.has(stepKey)) return 'error';
    if (completedSteps.has(stepKey)) return 'completed';
    if (currentStep === stepKey) return 'current';
    if (touchedSteps.has(stepKey)) return 'touched'; // Novo status para steps que foram tocados mas não completados
    return 'pending';
  };

  const getStepIcon = (step: { key: StepKey }) => {
    const status = getStepStatus(step.key);
    switch (status) {
      case 'current':
        return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'touched':
        return <div className="w-4 h-4 rounded-full bg-yellow-400" />; // Amarelo para tocado mas não completo
      default:
        return <div className="w-4 h-4 rounded-full bg-gray-300" />;
    }
  };

  const getStepStatusColor = (stepKey: StepKey) => {
    const status = getStepStatus(stepKey);
    switch (status) {
      case 'current':
        return 'border-blue-500 bg-blue-50';
      case 'completed':
        return 'border-green-500 bg-green-50';
      case 'error':
        return 'border-red-500 bg-red-50';
      case 'touched':
        return 'border-yellow-500 bg-yellow-50';
      default:
        return 'border-gray-200 bg-gray-50';
    }
  };

  const getStepStatusText = (stepKey: StepKey) => {
    const status = getStepStatus(stepKey);
    switch (status) {
      case 'current':
        return 'Processando...';
      case 'completed':
        return 'Concluído';
      case 'error':
        return 'Erro';
      case 'touched':
        return 'Em andamento';
      default:
        return 'Aguardando';
    }
  };

  const downloadLogs = () => {
    const logText = rawLogs
      .map((log) => {
        const dt = new Date(log.timestamp).toLocaleString();
        const header = `[${dt}] [${log.level.toUpperCase()}] [${normalizeType(log.type) || 'RAW'}] ${log.message}`;
        const rawReq = log.omieRequestRaw ? `\n[Omie Request RAW]\n${log.omieRequestRaw}` : '';
        const rawRes = log.omieResponseRaw ? `\n[Omie Response RAW]\n${log.omieResponseRaw}` : '';
        const cloudwatch = `${log.data?.stream ? `\n[CloudWatch stream] ${log.data.stream}` : ''}${log.data?.ts ? `\n[CloudWatch ts] ${new Date(log.data.ts).toISOString()}` : ''}`;
        const source = log.source ? `\n[source] ${log.source}` : '';
        return `${header}${rawReq}${rawRes}${cloudwatch}${source}`;
      })
      .join('\n');
    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `omie-logs-${transactionId}-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filteredLogs = useMemo(() => {
    let arr = selectedLogType === 'all'
      ? rawLogs
      : rawLogs.filter((log) => normalizeType(log.type) === selectedLogType);
    
    if (onlyErrors) arr = arr.filter(l => l.level === 'error');
    
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      arr = arr.filter(log => 
        log.message.toLowerCase().includes(term) ||
        log.type.toLowerCase().includes(term) ||
        (log.omieRequestRaw && log.omieRequestRaw.toLowerCase().includes(term)) ||
        (log.omieResponseRaw && log.omieResponseRaw.toLowerCase().includes(term))
      );
    }
    
    return arr;
  }, [rawLogs, selectedLogType, onlyErrors, searchTerm]);

  useEffect(() => {
    // sempre que o filtro mudar, reseta a paginação
    setVisible(500);
  }, [selectedLogType, onlyErrors, searchTerm]);

  const getLogTypeColor = (type: StepKey | string) => {
    const t = normalizeType(type as string) || (type as StepKey);
    const colors: Record<StepKey, string> = {
      checkFornecedor:     'bg-orange-100 text-orange-800',
      createFornecedor:    'bg-amber-100 text-amber-800',
      checkCliente:        'bg-blue-100 text-blue-800',
      createCliente:       'bg-green-100 text-green-800',
      checkProduto:        'bg-purple-100 text-purple-800',
      checkServico:        'bg-cyan-100 text-cyan-800',
      createProdutoResult: 'bg-indigo-100 text-indigo-800',
      createOCResult:      'bg-yellow-100 text-yellow-800',
      createOVResult:      'bg-sky-100 text-sky-800',
      createOSResult:      'bg-pink-100 text-pink-800',
      result:              'bg-emerald-100 text-emerald-800',
    };
    // @ts-ignore
    return t ? colors[t] : 'bg-gray-100 text-gray-800';
  };

  const toggleLogExpansion = (logId: string) => {
    const newExpanded = new Set(expandedLogs);
    if (newExpanded.has(logId)) {
      newExpanded.delete(logId);
    } else {
      newExpanded.add(logId);
    }
    setExpandedLogs(newExpanded);
  };

  const resetModalState = () => {
    setRawLogs([]);
    setHasLoadedOnce(false);
    setIsComplete(false);
    isCompleteRef.current = false;
    runStartedAtRef.current = new Date().toISOString();
    setHasError(false);
    setCompletedSteps(new Set());
    setFailedSteps(new Set());
    setTouchedSteps(new Set());
    setShowFixPanel(false);
    setRetryError(null);
    setResumo(null);
    lastHashRef.current = '';
    delayRef.current = 1500;
  };

  const clearAndRestart = async () => {
    setClearing(true);
    setRetryError(null);
    try {
      // 1) Busca payload atual
      const result = await getDealPayloadAction(transactionId);
      if (!result.success) throw new Error(result.error);

      // 2) Incrementa o contador de tentativa → novos códigos OC/OV/OS no Omie
      const payload = result.payload;
      payload._retryCount = (payload._retryCount ?? 0) + 1;

      // 3) Limpa logs antigos da transação
      await clearTransactionLogsAction(transactionId);

      // 4) Salva payload com novo contador e reseta status para approved
      const upd = await updateDealPayloadAndStatusAction(transactionId, 'approved', payload);
      if (!upd.success) throw new Error(upd.error);

      // 5) Re-dispara o envio
      const res = await fetch('/api/omie/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId: transactionId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // 6) Reseta o modal para assistir os novos logs
      resetModalState();
      scheduleNext(1500);
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : String(err));
    } finally {
      setClearing(false);
    }
  };

  // Extrai produtos com erro dos logs de createProdutoResult
  const openFixPanel = () => {
    const errorLogs = rawLogs.filter(
      l => normalizeType(l.type) === 'createProdutoResult' && l.level === 'error' && l.omieRequestRaw
    );
    const seen = new Set<string>();
    const products: FixProduct[] = [];
    for (const log of errorLogs) {
      try {
        const req = JSON.parse(log.omieRequestRaw!);
        const pn: string = req.codigo ?? '';
        if (!pn || seen.has(pn)) continue;
        seen.add(pn);
        let errMsg = '';
        if (log.omieResponseRaw) {
          try { errMsg = JSON.parse(log.omieResponseRaw).faultstring ?? ''; } catch {}
        }
        products.push({
          partnumber:  pn,
          description: req.descricao ?? '',
          ncm:         req.ncm ?? '',
          cfop:        req.cfop ?? '',
          unit:        req.unidade ?? 'UN',
          errorMsg:    errMsg,
        });
      } catch {}
    }
    setFixProducts(products.length > 0 ? products : []);
    setRetryError(null);
    setShowFixPanel(true);
  };

  const updateFixProduct = (idx: number, field: keyof FixProduct, value: string) => {
    setFixProducts(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  };

  const saveAndRetry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      const result = await getDealPayloadAction(transactionId);
      if (!result.success) throw new Error(result.error);

      const payload = result.payload;
      // Atualiza NCM/CFOP/unit em todos os produtos correspondentes
      for (const fix of fixProducts) {
        for (const group of (payload.supplierGroups ?? []) as any[]) {
          for (const product of (group.products ?? []) as any[]) {
            if (product.partnumber === fix.partnumber) {
              product.ncm  = fix.ncm;
              product.cfop = fix.cfop;
              product.unit = fix.unit;
            }
          }
        }
      }

      const updateResult = await updateDealPayloadAndStatusAction(transactionId, 'approved', payload);
      if (!updateResult.success) throw new Error(updateResult.error);

      // Re-dispara o envio
      const res = await fetch('/api/omie/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId: transactionId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      resetModalState();
      scheduleNext(1500);
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) clearTimer(); onOpenChange(o); }}>
      <DialogContent className="w-[95vw] max-w-4xl max-h-[90vh] flex flex-col overflow-hidden p-0">
        {/* Efeito 3D de resultado (sucesso/erro) */}
        <AnimatePresence>
          {resultFx && <Result3DOverlay key={resultFx} kind={resultFx} />}
        </AnimatePresence>
        <DialogHeader className="px-4 pt-4 pb-3 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span>🚀</span>
            <span className="truncate">Processamento Omie — Transação #{transactionId}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          {!showDetailedLogs ? (
            <div className="p-4 space-y-4">
              {!hasLoadedOnce ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin mb-3" />
                  <p className="text-gray-600 text-sm">Aguardando primeiros logs do Omie…</p>
                </div>
              ) : rawLogs.filter(l => l.source === 'omie').length === 0 && !isComplete ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin mb-3" />
                  <p className="text-gray-600 text-sm">Processando envio ao Omie…</p>
                  <p className="text-gray-400 text-xs mt-1">Os logs aparecerão em instantes</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {steps.map((step, index) => (
                      <motion.div
                        key={step.key}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className={`p-2.5 rounded-lg border-2 transition-all duration-300 ${getStepStatusColor(step.key)}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-lg shrink-0">{step.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">{step.label}</div>
                            <div className="text-xs text-gray-500">{getStepStatusText(step.key)}</div>
                          </div>
                          <div className="shrink-0">{getStepIcon(step)}</div>
                        </div>
                      </motion.div>
                    ))}
                  </div>

                  <AnimatePresence>
                    {isComplete && (
                      <motion.div
                        initial={{ opacity: 0, rotateX: -35, y: 26, scale: 0.94 }}
                        animate={{ opacity: 1, rotateX: 0, y: 0, scale: 1 }}
                        transition={{ type: 'spring', stiffness: 160, damping: 18, delay: resultFx ? 1.6 : 0 }}
                        style={{ transformPerspective: 900, boxShadow: '0 18px 40px -14px rgba(16,185,129,0.35)' }}
                        className="rounded-lg border-2 border-green-200 bg-green-50 p-4 space-y-3"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xl">🎉</span>
                          <h3 className="text-base font-bold text-green-700">Processamento Concluído!</h3>
                        </div>
                        <ChangesPanel
                          items={changes.length > 0 ? changes : (resumo?.alteracoes ?? [])}
                          forceShow={showChangesPanel}
                        />
                        {resumo && (
                          <div className="space-y-2 text-sm">
                            {resumo.oc?.length > 0 && (
                              <div className="bg-white rounded border border-green-200 p-3">
                                <p className="font-semibold text-yellow-700 mb-1 text-xs uppercase tracking-wide">📄 Ordens de Compra (OC)</p>
                                {resumo.oc.map((o: any, i: number) => (
                                  <div key={i} className="text-gray-700 text-sm space-y-0.5">
                                    <p>
                                      <span className="font-mono font-bold text-yellow-800">{o.numero}</span>
                                      <AcaoBadge acao={o.acao} />
                                      {o.fornecedor && <span className="text-gray-500 text-xs"> — {o.fornecedor}</span>}
                                    </p>
                                    {o.codigoIntegracao && (
                                      <p className="text-xs text-gray-500">
                                        Cód. integração: <span className="font-mono text-yellow-700">{o.codigoIntegracao}</span>
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                            {resumo.ov?.length > 0 && (
                              <div className="bg-white rounded border border-green-200 p-3">
                                <p className="font-semibold text-blue-700 mb-1 text-xs uppercase tracking-wide">🛒 Ordens de Venda (OV)</p>
                                {resumo.ov.map((o: any, i: number) => (
                                  <div key={i} className="text-gray-700 text-sm space-y-0.5">
                                    <p>
                                      <span className="font-mono font-bold text-blue-800">{o.numero}</span>
                                      <AcaoBadge acao={o.acao} />
                                      {o.cliente && <span className="text-gray-500 text-xs"> — {o.cliente}</span>}
                                    </p>
                                    <p className="text-xs text-gray-500">
                                      Buscar no Omie: código <span className="font-mono text-blue-700">{o.codigoIntegracao}</span>
                                      {o.codigoPedido && (
                                        <> · cód. pedido <span className="font-mono">{o.codigoPedido}</span></>
                                      )}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            )}
                            {resumo.os?.length > 0 && (
                              <div className="bg-white rounded border border-green-200 p-3">
                                <p className="font-semibold text-purple-700 mb-1 text-xs uppercase tracking-wide">📋 Ordens de Serviço (OS)</p>
                                {resumo.os.map((o: any, i: number) => (
                                  <p key={i} className="text-gray-700 text-sm">
                                    <span className="font-mono font-bold text-purple-800">#{o.numero}</span>
                                    <span className="text-xs text-gray-400 ml-1">({o.nat})</span>
                                    <AcaoBadge acao={o.acao} />
                                    {o.cliente && <span className="text-gray-500 text-xs"> — {o.cliente}</span>}
                                  </p>
                                ))}
                              </div>
                            )}
                            {!resumo.oc?.length && !resumo.ov?.length && !resumo.os?.length && (
                              <p className="text-gray-500 text-sm">Transação enviada. Verifique o Omie para detalhes.</p>
                            )}
                          </div>
                        )}
                      </motion.div>
                    )}

                    {hasError && !isComplete && (
                      <motion.div
                        initial={{ opacity: 0, rotateX: 40, y: -18, scale: 0.9 }}
                        animate={{
                          opacity: 1, rotateX: 0, y: 0, scale: 1,
                          x: [0, -8, 8, -5, 5, -2, 0],
                        }}
                        transition={{
                          type: 'spring', stiffness: 170, damping: 15,
                          x: { duration: 0.5, delay: resultFx ? 1.7 : 0.25 },
                          delay: resultFx ? 1.5 : 0,
                        }}
                        style={{ transformPerspective: 900, boxShadow: '0 18px 40px -14px rgba(239,68,68,0.35)' }}
                        className="text-center py-6 rounded-lg border-2 border-red-200 bg-red-50"
                      >
                        <motion.div
                          className="text-5xl mb-3 inline-block"
                          animate={{ rotateY: [0, 360] }}
                          transition={{ duration: 0.9, delay: resultFx ? 1.6 : 0.1, ease: 'easeOut' }}
                          style={{ transformStyle: 'preserve-3d' }}
                        >
                          ❌
                        </motion.div>
                        <h3 className="text-lg font-bold text-red-600 mb-1">Erro no Processamento</h3>
                        <p className="text-gray-600 text-sm">Ocorreu um erro durante o envio para o Omie</p>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Painel de correção */}
                  <AnimatePresence>
                    {showFixPanel && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        className="rounded-lg border-2 border-orange-200 bg-orange-50 p-4 space-y-3"
                      >
                        <div className="flex items-center gap-2">
                          <Wrench className="w-4 h-4 text-orange-600" />
                          <h3 className="text-sm font-bold text-orange-700">Corrigir Erros e Reenviar</h3>
                        </div>

                        {fixProducts.length === 0 ? (
                          <p className="text-xs text-gray-500">Nenhum produto com erro detectado nos logs.</p>
                        ) : (
                          <div className="space-y-3">
                            {fixProducts.map((fp, idx) => (
                              <div key={fp.partnumber} className="bg-white rounded border border-orange-200 p-3 space-y-2">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                                  <div>
                                    <span className="font-mono font-bold text-sm text-gray-800">{fp.partnumber}</span>
                                    {fp.description && <span className="text-xs text-gray-500 ml-2">{fp.description}</span>}
                                  </div>
                                  {fp.errorMsg && (
                                    <span className="text-[10px] text-red-600 bg-red-50 border border-red-200 rounded px-2 py-0.5 max-w-[280px] truncate" title={fp.errorMsg}>
                                      {fp.errorMsg}
                                    </span>
                                  )}
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                  <div>
                                    <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">NCM</label>
                                    <Input
                                      value={fp.ncm}
                                      onChange={e => updateFixProduct(idx, 'ncm', e.target.value)}
                                      placeholder="ex: 8471.80.19"
                                      className="h-7 text-xs font-mono"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">CFOP</label>
                                    <Input
                                      value={fp.cfop}
                                      onChange={e => updateFixProduct(idx, 'cfop', e.target.value)}
                                      placeholder="ex: 5102"
                                      className="h-7 text-xs font-mono"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Unidade</label>
                                    <Input
                                      value={fp.unit}
                                      onChange={e => updateFixProduct(idx, 'unit', e.target.value)}
                                      placeholder="UN"
                                      className="h-7 text-xs"
                                    />
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {retryError && (
                          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{retryError}</p>
                        )}

                        <div className="flex gap-2 justify-end">
                          <Button variant="outline" size="sm" onClick={() => setShowFixPanel(false)} disabled={retrying}>
                            Cancelar
                          </Button>
                          <Button
                            size="sm"
                            className="bg-orange-600 hover:bg-orange-700 text-white"
                            onClick={saveAndRetry}
                            disabled={retrying || fixProducts.length === 0}
                          >
                            {retrying ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Reenviando…</> : <><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Salvar e Reenviar</>}
                          </Button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}
            </div>
          ) : (
            // ── LOGS DETALHADOS ────────────────────────────────────────────
            <div className="p-4 space-y-3">
              {/* Barra de controles — empilha em mobile */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowDetailedLogs(false)}>
                    <Eye className="w-3.5 h-3.5 mr-1.5" />
                    Voltar
                  </Button>
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={onlyErrors}
                      onChange={(e) => setOnlyErrors(e.target.checked)}
                      className="rounded"
                    />
                    Só erros
                  </label>
                  <select
                    value={selectedLogType}
                    onChange={(e) => setSelectedLogType(e.target.value as ('all' | StepKey))}
                    className="px-2 py-1 border rounded text-xs bg-white min-w-0 max-w-[160px] sm:max-w-none"
                  >
                    <option value="all">Todos ({rawLogs.length})</option>
                    {steps.map((step) => {
                      const count = rawLogs.filter((log) => normalizeType(log.type) === step.key).length;
                      return count > 0 ? (
                        <option key={step.key} value={step.key}>{step.label} ({count})</option>
                      ) : null;
                    })}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={downloadLogs} disabled={rawLogs.length === 0}>
                    <Download className="w-3.5 h-3.5 mr-1.5" />
                    <span className="hidden sm:inline">Download</span>
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => fetchOmieLogs(false)} disabled={loadingLogs}>
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingLogs ? 'animate-spin' : ''} sm:mr-1.5`} />
                    <span className="hidden sm:inline">Atualizar</span>
                  </Button>
                </div>
              </div>

              {/* Busca */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 w-3.5 h-3.5" />
                <Input
                  placeholder="Buscar nos logs..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 h-8 text-sm"
                />
              </div>

              {/* Lista de logs */}
              <div className="border rounded-lg overflow-hidden">
                <ScrollArea className="h-[50vh] min-h-48">
                  <div className="p-3">
                    {loadingLogs ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-5 h-5 animate-spin mr-2" />
                        <span className="text-sm text-gray-600">Carregando…</span>
                      </div>
                    ) : filteredLogs.length > 0 ? (
                      <div className="space-y-2">
                        {filteredLogs.slice(0, visible).map((log, index) => {
                          const isExpanded = expandedLogs.has(log.id);
                          const hasRawData = log.omieRequestRaw || log.omieResponseRaw;
                          return (
                            <motion.div
                              key={log.id}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              transition={{ delay: Math.min(index * 0.01, 0.3) }}
                              className="border rounded-lg bg-white overflow-hidden"
                            >
                              <div
                                className={`p-2.5 ${hasRawData ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                                onClick={() => hasRawData && toggleLogExpansion(log.id)}
                              >
                                <div className="flex items-start justify-between gap-2 mb-1.5">
                                  <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                    {hasRawData && (
                                      isExpanded
                                        ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                        : <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                    )}
                                    <Badge className={`text-[10px] py-0 px-1.5 ${getLogTypeColor(log.type)}`}>
                                      {steps.find((s) => s.key === normalizeType(log.type))?.label || (normalizeType(log.type) || 'RAW')}
                                    </Badge>
                                    <Badge
                                      variant={log.level === 'error' ? 'destructive' : log.level === 'success' ? 'default' : log.level === 'warning' ? 'secondary' : 'outline'}
                                      className="text-[10px] py-0 px-1.5"
                                    >
                                      {log.level.toUpperCase()}
                                    </Badge>
                                    {log.source && (
                                      <Badge variant="outline" className="text-[10px] py-0 px-1.5">{log.source}</Badge>
                                    )}
                                  </div>
                                  <span className="text-[10px] text-gray-400 shrink-0">
                                    {new Date(log.timestamp).toLocaleTimeString()}
                                  </span>
                                </div>
                                <p className="text-xs text-gray-700 break-all">{log.message}</p>
                                {(log.data?.stream || log.data?.ts) && (
                                  <div className="flex flex-wrap gap-2 text-[10px] text-gray-400 mt-1">
                                    {log.data?.stream && <span>stream: <code className="font-mono">{log.data.stream}</code></span>}
                                    {log.data?.ts && <span>· {new Date(log.data.ts).toLocaleTimeString()}</span>}
                                  </div>
                                )}
                              </div>
                              <AnimatePresence>
                                {isExpanded && hasRawData && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="border-t bg-gray-50"
                                  >
                                    <div className="p-2.5 space-y-2.5 text-xs">
                                      {log.omieRequestRaw && (
                                        <div>
                                          <div className="mb-1 text-gray-500 font-medium text-[11px] uppercase tracking-wide">Request</div>
                                          <pre className="p-2 rounded bg-white border whitespace-pre-wrap overflow-x-auto max-h-40 font-mono text-[10px] leading-relaxed">
                                            {log.omieRequestRaw}
                                          </pre>
                                        </div>
                                      )}
                                      {log.omieResponseRaw && (
                                        <div>
                                          <div className="mb-1 text-gray-500 font-medium text-[11px] uppercase tracking-wide">Response</div>
                                          <pre className="p-2 rounded bg-white border whitespace-pre-wrap overflow-x-auto max-h-52 font-mono text-[10px] leading-relaxed">
                                            {log.omieResponseRaw}
                                          </pre>
                                        </div>
                                      )}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </motion.div>
                          );
                        })}
                        {filteredLogs.length > visible && (
                          <div className="text-center pt-2">
                            <Button variant="outline" size="sm" onClick={() => setVisible(v => v + 500)}>
                              Carregar mais (+500)
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-gray-500 text-sm">
                        {searchTerm ? `Nenhum log para "${searchTerm}"` : 'Nenhum log para esta transação.'}
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>
          )}
        </div>

        {/* Erro fora do fix panel (ex: clearAndRestart) */}
        {retryError && !showFixPanel && (
          <div className="border-t px-4 py-2 bg-red-50 shrink-0">
            <p className="text-xs text-red-600">{retryError}</p>
          </div>
        )}

        {/* Rodapé fixo */}
        <div className="border-t px-4 py-3 flex items-center justify-between gap-2 shrink-0 bg-white flex-wrap">
          {!showDetailedLogs ? (
            <>
              <Button variant="outline" size="sm" onClick={() => fetchOmieLogs(false)} disabled={loadingLogs}>
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loadingLogs ? 'animate-spin' : ''}`} />
                Atualizar
              </Button>
              <div className="flex flex-wrap gap-2">
                {hasError && !showFixPanel && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-orange-300 text-orange-700 hover:bg-orange-50"
                    onClick={openFixPanel}
                    disabled={clearing}
                  >
                    <Wrench className="w-3.5 h-3.5 mr-1.5" />
                    Corrigir Erros
                  </Button>
                )}
                {hasError && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-red-300 text-red-700 hover:bg-red-50"
                    onClick={clearAndRestart}
                    disabled={clearing || retrying}
                    title="Apaga os logs desta tentativa e reenviar com novos códigos de integração (OC/OV/OS)"
                  >
                    {clearing
                      ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Limpando…</>
                      : <><Trash2 className="w-3.5 h-3.5 mr-1.5" />Limpar e Recomeçar</>}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setShowDetailedLogs(true)}>
                  <List className="w-3.5 h-3.5 mr-1.5" />
                  Logs ({rawLogs.length})
                </Button>
                <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                  Fechar
                </Button>
              </div>
            </>
          ) : (
            <div className="ml-auto">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default OmieLogsModal;
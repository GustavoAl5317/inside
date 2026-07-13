'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, CheckCircle, XCircle, Download, RefreshCw, Eye, List } from 'lucide-react';

type Level = 'info' | 'error' | 'success' | 'warning' | 'debug';

interface OmieLog {
  id: string;
  timestamp: string;          // ISO
  level: Level;
  message: string;
  type: string;               // metadata._type já vem do backend
  source?: string;
  transactionId?: string | number;
  data?: any;                 // fallback (JSON normal)
  omieRequestRaw?: string | null;   // RAW request Omie (quando disponível)
  omieResponseRaw?: string | null;  // RAW response Omie (quando disponível)
}

export interface OmieLogsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transactionId: number;
  isLoading: boolean;
  onComplete?: () => void;
}

const steps = [
  { key: 'checkCliente',        label: 'Verificando Cliente',       icon: '👤' },
  { key: 'createCliente',       label: 'Criando Cliente',           icon: '✨' },
  { key: 'checkProduto',        label: 'Verificando Produtos',      icon: '📦' },
  { key: 'checkServico',        label: 'Verificando Serviços',      icon: '🔧' },
  { key: 'createProdutoResult', label: 'Criando Produtos',          icon: '🏭' },
  { key: 'createOSResult',      label: 'Criando Ordem de Serviço',  icon: '📋' },
  { key: 'createOCResult',      label: 'Criando Ordem de Compra',   icon: '📄' },
  { key: 'result',              label: 'Finalizando',               icon: '🎉' },
];

// segurança: normaliza variantes antigas
const normalizeType = (t: string) =>
  t === 'createOC' ? 'createOCResult' : t;

const OmieLogsModal: React.FC<OmieLogsModalProps> = ({
  open,
  onOpenChange,
  transactionId,
  isLoading,
  onComplete,
}) => {
  const [logs, setLogs] = useState<OmieLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const [currentStep, setCurrentStep] = useState<string>('');
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [failedSteps, setFailedSteps] = useState<Set<string>>(new Set());
  const [isComplete, setIsComplete] = useState(false);
  const [hasError, setHasError] = useState(false);

  const [showDetailedLogs, setShowDetailedLogs] = useState(false);
  const [selectedLogType, setSelectedLogType] = useState<string>('all');

  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // ---------------- POLLING REAL ----------------
  const fetchOmieLogs = async () => {
    setLoadingLogs(true);
    try {
      // 🔁 Não filtramos por source aqui (para pegar "aws-lambda" e "omie")
      const url = `/api/logs/capture?transactionId=${transactionId}&order=asc`;
      const response = await fetch(url);
      const data = await response.json();

      const rawList = Array.isArray(data?.logs) ? data.logs : [];
      const parsed: OmieLog[] = rawList.map((l: any) => ({
        id: l.id,
        timestamp: l.timestamp || l.created_at || new Date().toISOString(),
        level: (l.level as Level) || 'info',
        message: l.message,
        type: normalizeType(l.type || l.metadata?._type || l.details?._type || ''),
        source: l.source,
        transactionId: l.transactionId ?? l.transaction_id,
        data: l.details ?? l.metadata, // fallback para inspeção JSON
        omieRequestRaw: l.metadata?.omie?.requestBodyRaw ?? null,
        omieResponseRaw: l.metadata?.omie?.responseBodyRaw ?? null,
      }));

      // ✅ marque como carregado mesmo se vier vazio (evita spinner infinito)
      setHasLoadedOnce(true);

      setLogs(parsed);
      // ✅ processa mesmo vazio (isso reseta os steps corretamente)
      processStepsFromLogs(parsed);
    } catch {
      // se der erro na primeira tentativa, mantenha o “aguardando”
      if (!hasLoadedOnce) setHasLoadedOnce(false);
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (!open || !transactionId) return;

    fetchOmieLogs();                             // primeira busca imediata
    pollRef.current = setInterval(fetchOmieLogs, 1500); // polling

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transactionId]);

  // auto callback on complete
  useEffect(() => {
    if (isComplete && onComplete) {
      const t = setTimeout(() => onComplete(), 3000);
      return () => clearTimeout(t);
    }
  }, [isComplete, onComplete]);

  // ------------- PROCESSAMENTO DOS STEPS PELOS LOGS -------------
  const processStepsFromLogs = (rawLogs: OmieLog[]) => {
    if (!rawLogs || rawLogs.length === 0) {
      setCurrentStep('');
      setIsComplete(false);
      setHasError(false);
      setCompletedSteps(new Set());
      setFailedSteps(new Set());
      return;
    }

    const ordered = [...rawLogs].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const stepOrder = steps.map(s => s.key);
    const touchedOrder: string[] = [];
    const lastLevelByStep = new Map<string, Level>();
    const failed = new Set<string>();

    for (const log of ordered) {
      const t = normalizeType(log.type);
      if (!stepOrder.includes(t)) continue;

      if (!touchedOrder.includes(t)) touchedOrder.push(t);
      lastLevelByStep.set(t, log.level);

      if (log.level === 'error') failed.add(t);
    }

    const last = ordered[ordered.length - 1];
    const lastType = normalizeType(last.type);
    const anyError = failed.size > 0 || last.level === 'error';
    setHasError(anyError);

    const finishedOk = lastType === 'result' && last.level === 'success';
    setIsComplete(finishedOk);

    const completed = new Set<string>();
    for (const k of touchedOrder) {
      const lvl = lastLevelByStep.get(k);
      if (lvl === 'success' && !failed.has(k)) completed.add(k);
    }

    let current = '';
    if (touchedOrder.length > 0) {
      const lastTouched = touchedOrder[touchedOrder.length - 1];
      const lastTouchedLevel = lastLevelByStep.get(lastTouched);
      if (lastTouchedLevel === 'info' || lastTouchedLevel === 'debug') current = lastTouched;
    }
    if (lastType === 'result') current = '';

    setCurrentStep(current);
    setCompletedSteps(completed);
    setFailedSteps(failed);
  };

  const getStepStatus = (stepKey: string) => {
    if (failedSteps.has(stepKey)) return 'error';
    if (completedSteps.has(stepKey)) return 'completed';
    if (currentStep === stepKey) return 'current';
    return 'pending';
  };

  const getStepIcon = (step: any) => {
    const status = getStepStatus(step.key);
    switch (status) {
      case 'current':
        return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <div className="w-4 h-4 rounded-full bg-gray-300" />;
    }
  };

  const downloadLogs = () => {
    const logText = logs
      .map((log) => {
        const dt = new Date(log.timestamp).toLocaleString();
        const header = `[${dt}] [${log.level.toUpperCase()}] [${normalizeType(log.type)}] ${log.message}`;
        const rawReq = log.omieRequestRaw ? `\n[Omie Request RAW]\n${log.omieRequestRaw}` : '';
        const rawRes = log.omieResponseRaw ? `\n[Omie Response RAW]\n${log.omieResponseRaw}` : '';
        return `${header}${rawReq}${rawRes}`;
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
    return selectedLogType === 'all'
      ? logs
      : logs.filter((log) => normalizeType(log.type) === selectedLogType);
  }, [logs, selectedLogType]);

  const getLogTypeColor = (type: string) => {
    const t = normalizeType(type);
    const colors: Record<string, string> = {
      checkCliente: 'bg-blue-100 text-blue-800',
      createCliente: 'bg-green-100 text-green-800',
      checkProduto: 'bg-purple-100 text-purple-800',
      checkServico: 'bg-orange-100 text-orange-800',
      createProdutoResult: 'bg-indigo-100 text-indigo-800',
      createOSResult: 'bg-pink-100 text-pink-800',
      createOCResult: 'bg-yellow-100 text-yellow-800',
      result: 'bg-emerald-100 text-emerald-800',
    };
    return colors[t] || 'bg-gray-100 text-gray-800';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-2xl">🚀</span>
            Processamento Omie - Transação #{transactionId}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!showDetailedLogs ? (
            <>
              {!hasLoadedOnce ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin mb-3" />
                  <p className="text-gray-600">Aguardando primeiros logs do Omie…</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    {steps.map((step, index) => (
                      <motion.div
                        key={step.key}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className={`p-3 rounded-lg border-2 transition-all duration-300 ${
                          getStepStatus(step.key) === 'current'
                            ? 'border-blue-500 bg-blue-50'
                            : getStepStatus(step.key) === 'completed'
                            ? 'border-green-500 bg-green-50'
                            : getStepStatus(step.key) === 'error'
                            ? 'border-red-500 bg-red-50'
                            : 'border-gray-200 bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="text-2xl">{step.icon}</div>
                          <div className="flex-1">
                            <div className="font-medium">{step.label}</div>
                            <div className="text-sm text-gray-500">
                              {getStepStatus(step.key) === 'current' && 'Processando...'}
                              {getStepStatus(step.key) === 'completed' && 'Concluído'}
                              {getStepStatus(step.key) === 'error' && 'Erro'}
                              {getStepStatus(step.key) === 'pending' && 'Aguardando'}
                            </div>
                          </div>
                          {getStepIcon(step)}
                        </div>
                      </motion.div>
                    ))}
                  </div>

                  <AnimatePresence>
                    {isComplete && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="text-center py-8"
                      >
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                          className="text-6xl mb-4"
                        >
                          🎉
                        </motion.div>
                        <h3 className="text-xl font-bold text-green-600 mb-2">Processamento Concluído!</h3>
                        <p className="text-gray-600">Transação enviada com sucesso para o Omie</p>
                      </motion.div>
                    )}

                    {hasError && !isComplete && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="text-center py-8"
                      >
                        <div className="text-6xl mb-4">❌</div>
                        <h3 className="text-xl font-bold text-red-600 mb-2">Erro no Processamento</h3>
                        <p className="text-gray-600">Ocorreu um erro durante o envio para o Omie</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}

              <div className="flex justify-between items-center pt-4 border-t">
                <Button variant="outline" onClick={fetchOmieLogs} disabled={loadingLogs}>
                  <RefreshCw className={`w-4 h-4 mr-2 ${loadingLogs ? 'animate-spin' : ''}`} />
                  Atualizar
                </Button>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowDetailedLogs(true)}
                    disabled={logs.length === 0}
                  >
                    <List className="w-4 h-4 mr-2" />
                    Ver Logs Detalhados ({logs.length})
                  </Button>

                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    Fechar
                  </Button>
                </div>
              </div>
            </>
          ) : (
            // ---------------- LOGS DETALHADOS ----------------
            <>
              <div className="flex items-center justify-between">
                <Button variant="outline" onClick={() => setShowDetailedLogs(false)} size="sm">
                  <Eye className="w-4 h-4 mr-2" />
                  Voltar para Animação
                </Button>

                <div className="flex items-center gap-2">
                  <select
                    value={selectedLogType}
                    onChange={(e) => setSelectedLogType(e.target.value)}
                    className="px-3 py-1 border rounded text-sm"
                  >
                    <option value="all">Todos os Logs ({logs.length})</option>
                    {steps.map((step) => {
                      const count = logs.filter((log) => normalizeType(log.type) === step.key).length;
                      return count > 0 ? (
                        <option key={step.key} value={step.key}>
                          {step.label} ({count})
                        </option>
                      ) : null;
                    })}
                  </select>

                  <Button variant="outline" size="sm" onClick={downloadLogs} disabled={logs.length === 0}>
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </Button>

                  <Button variant="outline" size="sm" onClick={fetchOmieLogs} disabled={loadingLogs}>
                    <RefreshCw className={`w-4 h-4 mr-2 ${loadingLogs ? 'animate-spin' : ''}`} />
                    Atualizar
                  </Button>
                </div>
              </div>

              <ScrollArea className="h-96 border rounded-lg p-4">
                {loadingLogs ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin mr-2" />
                    Carregando logs...
                  </div>
                ) : filteredLogs.length > 0 ? (
                  <div className="space-y-3">
                    {filteredLogs.map((log, index) => (
                      <motion.div
                        key={log.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.02 }}
                        className="p-3 border rounded-lg bg-white hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Badge className={getLogTypeColor(log.type)}>
                              {steps.find((s) => s.key === normalizeType(log.type))?.label || log.type}
                            </Badge>
                            <Badge
                              variant={
                                log.level === 'error'
                                  ? 'destructive'
                                  : log.level === 'success'
                                  ? 'default'
                                  : log.level === 'warning'
                                  ? 'secondary'
                                  : 'outline'
                              }
                            >
                              {log.level.toUpperCase()}
                            </Badge>
                          </div>
                          <span className="text-xs text-gray-500">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>
                        </div>

                        {/* Mensagem curta da timeline */}
                        <p className="text-sm text-gray-700 mb-2">{log.message}</p>

                        {/* RAW do Omie (exatamente como veio) */}
                        {(log.omieRequestRaw || log.omieResponseRaw) ? (
                          <div className="space-y-3 text-xs">
                            {log.omieRequestRaw && (
                              <div>
                                <div className="mb-1 text-gray-600">Omie Request (RAW)</div>
                                <pre className="p-2 rounded bg-gray-100 whitespace-pre overflow-auto max-h-48 font-mono text-[11px]">
                                  {log.omieRequestRaw}
                                </pre>
                              </div>
                            )}
                            {log.omieResponseRaw && (
                              <div>
                                <div className="mb-1 text-gray-600">Omie Response (RAW)</div>
                                <pre className="p-2 rounded bg-gray-100 whitespace-pre overflow-auto max-h-64 font-mono text-[11px]">
                                  {log.omieResponseRaw}
                                </pre>
                              </div>
                            )}
                          </div>
                        ) : log.data ? (
                          // Fallback: JSON legível quando não houver RAW
                          <details className="text-xs">
                            <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
                              Ver detalhes técnicos
                            </summary>
                            <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-x-auto">
                              {JSON.stringify(log.data, null, 2)}
                            </pre>
                          </details>
                        ) : null}
                      </motion.div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    {selectedLogType === 'all'
                      ? 'Nenhum log encontrado para esta transação'
                      : `Nenhum log encontrado para ${steps.find((s) => s.key === selectedLogType)?.label}`}
                  </div>
                )}
              </ScrollArea>

              <div className="flex justify-end pt-4 border-t">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Fechar
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default OmieLogsModal;

/**
 * SHIM de compatibilidade:
 * aceita as props antigas do RealTimeLogs e mapeia para o OmieLogsModal.
 */
export type RealTimeLogsProps = {
  processId: string;             // legado
  title?: string;                // ignorado no modal
  description?: string;          // ignorado no modal
  height?: string | number;      // ignorado no modal
};

export function RealTimeLogs(props: RealTimeLogsProps) {
  const { processId } = props;

  // estado local para abrir/fechar o modal
  const [open, setOpen] = React.useState(true);

  // mapeia processId (string) -> transactionId (number)
  const transactionId = Number.isFinite(Number(processId))
    ? Number(processId)
    : Date.now(); // fallback seguro

  return (
    <OmieLogsModal
      open={open}
      onOpenChange={setOpen}
      transactionId={transactionId}
      isLoading={false}
    />
  );
}

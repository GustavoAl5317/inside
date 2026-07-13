'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Loader2, Download, Search, ChevronDown, ChevronRight, Calendar, CheckCircle, XCircle } from 'lucide-react';

type Level = 'info' | 'error' | 'success' | 'warning' | 'debug';

interface SavedOmieLog {
  id: string;
  timestamp: string;
  level: Level;
  message: string;
  type: string;
  source?: string;
  transactionId?: string | number;
  data?: any;
  omieRequestRaw?: string | null;
  omieResponseRaw?: string | null;
  fromLambda?: boolean;
}

interface SavedLogsData {
  transactionId: number;
  logs: SavedOmieLog[];
  completedAt: string;
  status: 'success' | 'error';
  createdAt: string;
  updatedAt?: string;
}

interface SavedLogsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transactionId: number;
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
] as const;

type StepKey = typeof steps[number]['key'];

const normalizeType = (t: string): StepKey | '' =>
  (t === 'createOC' ? 'createOCResult' : (steps.some(s => s.key === t) ? (t as StepKey) : ''));

const SavedLogsModal: React.FC<SavedLogsModalProps> = ({
  open,
  onOpenChange,
  transactionId,
}) => {
  const [savedLogsData, setSavedLogsData] = useState<SavedLogsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [selectedLogType, setSelectedLogType] = useState<'all' | StepKey>('all');
  const [onlyErrors, setOnlyErrors] = useState(false);

  const fetchSavedLogs = async () => {
    if (!transactionId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/logs/save-completed?transactionId=${transactionId}`);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Erro ao carregar logs salvos');
      }
      
      setSavedLogsData(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && transactionId) {
      fetchSavedLogs();
    }
  }, [open, transactionId]);

  const filteredLogs = React.useMemo(() => {
    if (!savedLogsData?.logs) return [];
    
    let arr = selectedLogType === 'all'
      ? savedLogsData.logs
      : savedLogsData.logs.filter((log) => normalizeType(log.type) === selectedLogType);
    
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
  }, [savedLogsData?.logs, selectedLogType, onlyErrors, searchTerm]);

  const getLogTypeColor = (type: StepKey | string) => {
    const t = normalizeType(type as string) || (type as StepKey);
    const colors: Record<StepKey, string> = {
      checkCliente: 'bg-blue-100 text-blue-800',
      createCliente: 'bg-green-100 text-green-800',
      checkProduto: 'bg-purple-100 text-purple-800',
      checkServico: 'bg-orange-100 text-orange-800',
      createProdutoResult: 'bg-indigo-100 text-indigo-800',
      createOSResult: 'bg-pink-100 text-pink-800',
      createOCResult: 'bg-yellow-100 text-yellow-800',
      result: 'bg-emerald-100 text-emerald-800',
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

  const downloadLogs = () => {
    if (!savedLogsData?.logs) return;
    
    const logText = savedLogsData.logs
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
    a.download = `omie-logs-saved-${transactionId}-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-2xl">📋</span>
            Logs Salvos - Transação #{transactionId}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin mb-3" />
              <p className="text-gray-600">Carregando logs salvos...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12">
              <XCircle className="w-8 h-8 text-red-500 mb-3" />
              <p className="text-red-600 mb-4">{error}</p>
              <Button onClick={fetchSavedLogs} variant="outline">
                Tentar Novamente
              </Button>
            </div>
          ) : savedLogsData ? (
            <>
              {/* Informações do processo */}
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-lg">Informações do Processo</h3>
                  <Badge 
                    variant={savedLogsData.status === 'success' ? 'default' : 'destructive'}
                    className="flex items-center gap-1"
                  >
                    {savedLogsData.status === 'success' ? 
                      <CheckCircle className="w-3 h-3" /> : 
                      <XCircle className="w-3 h-3" />
                    }
                    {savedLogsData.status === 'success' ? 'Sucesso' : 'Erro'}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-gray-500" />
                    <span className="text-gray-600">Concluído em:</span>
                    <span>{new Date(savedLogsData.completedAt).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-600">Total de logs:</span>
                    <span className="font-medium">{savedLogsData.logs.length}</span>
                  </div>
                </div>
              </div>

              {/* Controles de filtro */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={onlyErrors}
                      onChange={(e) => setOnlyErrors(e.target.checked)}
                    />
                    Mostrar apenas erros
                  </label>

                  <select
                    value={selectedLogType}
                    onChange={(e) => setSelectedLogType(e.target.value as ('all' | StepKey))}
                    className="px-3 py-1 border rounded text-sm"
                  >
                    <option value="all">Todos os Logs ({savedLogsData.logs.length})</option>
                    {steps.map((step) => {
                      const count = savedLogsData.logs.filter((log) => normalizeType(log.type) === step.key).length;
                      return count > 0 ? (
                        <option key={step.key} value={step.key}>
                          {step.label} ({count})
                        </option>
                      ) : null;
                    })}
                  </select>
                </div>

                <Button variant="outline" size="sm" onClick={downloadLogs}>
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>
              </div>

              {/* Campo de busca */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Buscar nos logs (mensagem, tipo, request, response)..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Lista de logs */}
              <ScrollArea className="h-96 border rounded-lg p-4">
                {filteredLogs.length > 0 ? (
                  <div className="space-y-3">
                    {filteredLogs.map((log, index) => {
                      const isExpanded = expandedLogs.has(log.id);
                      const hasRawData = log.omieRequestRaw || log.omieResponseRaw;
                      
                      return (
                        <motion.div
                          key={log.id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: index * 0.01 }}
                          className="border rounded-lg bg-white hover:bg-gray-50 transition-colors"
                        >
                          <div 
                            className={`p-3 ${hasRawData ? 'cursor-pointer' : ''}`}
                            onClick={() => hasRawData && toggleLogExpansion(log.id)}
                          >
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center gap-2">
                                {hasRawData && (
                                  isExpanded ? 
                                    <ChevronDown className="w-4 h-4 text-gray-400" /> : 
                                    <ChevronRight className="w-4 h-4 text-gray-400" />
                                )}
                                <Badge className={getLogTypeColor(log.type)}>
                                  {steps.find((s) => s.key === normalizeType(log.type))?.label || (normalizeType(log.type) || 'RAW')}
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
                                {log.source && (
                                  <Badge variant="outline">{log.source}</Badge>
                                )}
                              </div>
                              <span className="text-xs text-gray-500">
                                {new Date(log.timestamp).toLocaleTimeString()}
                              </span>
                            </div>

                            <p className="text-sm text-gray-700 mb-2">{log.message}</p>

                            {/* CloudWatch extras */}
                            {(log.data?.stream || log.data?.ts) && (
                              <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500 mb-2">
                                {log.data?.stream && <span>stream: <code>{log.data.stream}</code></span>}
                                {log.data?.ts && <span>• {new Date(log.data.ts).toLocaleTimeString()}</span>}
                              </div>
                            )}
                          </div>

                          {/* Conteúdo expandível */}
                          {isExpanded && hasRawData && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="border-t bg-gray-50"
                            >
                              <div className="p-3 space-y-3 text-xs">
                                {log.omieRequestRaw && (
                                  <div>
                                    <div className="mb-1 text-gray-600 font-medium">Omie Request (RAW)</div>
                                    <pre className="p-2 rounded bg-white border whitespace-pre-wrap overflow-auto max-h-48 font-mono text-[11px]">
                                      {log.omieRequestRaw}
                                    </pre>
                                  </div>
                                )}
                                {log.omieResponseRaw && (
                                  <div>
                                    <div className="mb-1 text-gray-600 font-medium">Omie Response (RAW)</div>
                                    <pre className="p-2 rounded bg-white border whitespace-pre-wrap overflow-auto max-h-64 font-mono text-[11px]">
                                      {log.omieResponseRaw}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </motion.div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    {searchTerm ? 
                      `Nenhum log encontrado para "${searchTerm}"` : 
                      'Nenhum log encontrado com os filtros aplicados.'
                    }
                  </div>
                )}
              </ScrollArea>

              <div className="flex justify-end pt-4 border-t">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Fechar
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SavedLogsModal;
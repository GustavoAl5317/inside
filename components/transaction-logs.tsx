"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Loader2, RefreshCw, AlertCircle, Info, CheckCircle, ClipboardCopy, Check } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { ptBR } from "date-fns/locale"

interface LogEvent {
  id: string
  timestamp: number
  message: string
  logStreamName: string
}

interface TransactionLogsProps {
  transactionId: string | number
  autoRefresh?: boolean
}

export function TransactionLogs({ transactionId, autoRefresh = false }: TransactionLogsProps) {
  const [logs, setLogs] = useState<LogEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isAutoRefresh, setIsAutoRefresh] = useState(autoRefresh)
  const [refreshInterval, setRefreshInterval] = useState<NodeJS.Timeout | null>(null)
  const [copied, setCopied] = useState(false)
  const logsRef = useRef<HTMLDivElement>(null)

  // Função para buscar logs
  const fetchLogs = async () => {
    if (!transactionId) return

    try {
      setLoading(true)
      setError(null)

      // Obter configuração do grupo de logs do localStorage
      const logGroup = localStorage.getItem("cloudwatch_log_group")

      // Construir URL com parâmetros
      let url = `/api/aws/cloudwatch-logs/transaction?transactionId=${transactionId}`
      if (logGroup) {
        url += `&logGroup=${encodeURIComponent(logGroup)}`
      }

      const response = await fetch(url)

      if (!response.ok) {
        throw new Error(`Erro ao buscar logs: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()

      if (data.error) {
        throw new Error(data.error)
      }

      // Ordenar logs por timestamp (mais recentes primeiro)
      const sortedLogs = (data.events || []).sort((a: LogEvent, b: LogEvent) => b.timestamp - a.timestamp)
      setLogs(sortedLogs)
    } catch (err) {
      console.error("Erro ao buscar logs:", err)
      setError(err instanceof Error ? err.message : "Erro desconhecido ao buscar logs")
    } finally {
      setLoading(false)
    }
  }

  // Configurar atualização automática
  useEffect(() => {
    fetchLogs()

    if (isAutoRefresh) {
      const interval = setInterval(fetchLogs, 5000) // Atualizar a cada 5 segundos
      setRefreshInterval(interval)

      return () => clearInterval(interval)
    } else if (refreshInterval) {
      clearInterval(refreshInterval)
      setRefreshInterval(null)
    }

    return () => {
      if (refreshInterval) clearInterval(refreshInterval)
    }
  }, [transactionId, isAutoRefresh])

  // Função para determinar o tipo de log (erro, aviso, info, sucesso)
  const getLogType = (message: string) => {
    const lowerMessage = message.toLowerCase()
    if (lowerMessage.includes("error") || lowerMessage.includes("exception") || lowerMessage.includes("fail")) {
      return "error"
    }
    if (lowerMessage.includes("warn")) {
      return "warning"
    }
    if (lowerMessage.includes("success") || lowerMessage.includes("completed")) {
      return "success"
    }
    return "info"
  }

  // Função para formatar mensagem JSON
  const formatMessage = (message: string) => {
    try {
      // Tentar analisar como JSON
      const jsonStart = message.indexOf("{")
      if (jsonStart >= 0) {
        const jsonPart = message.substring(jsonStart)
        const parsed = JSON.parse(jsonPart)
        return <pre className="whitespace-pre-wrap text-xs overflow-x-auto">{JSON.stringify(parsed, null, 2)}</pre>
      }
    } catch {}

    // Se não for JSON ou ocorrer erro, retornar como texto
    return <span className="whitespace-pre-wrap">{message}</span>
  }

  // Função para copiar logs para clipboard
  const copyLogs = () => {
    const logsText = logs.map((log) => `[${new Date(log.timestamp).toISOString()}] ${log.message}`).join("\n")

    navigator.clipboard.writeText(logsText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // Renderizar ícone baseado no tipo de log
  const renderLogIcon = (type: string) => {
    switch (type) {
      case "error":
        return <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
      case "warning":
        return <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0" />
      case "success":
        return <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
      default:
        return <Info className="h-4 w-4 text-blue-500 flex-shrink-0" />
    }
  }

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-center">
          <div>
            <CardTitle>Logs da Transação #{transactionId}</CardTitle>
            <CardDescription>Logs do CloudWatch em tempo real</CardDescription>
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="outline" size="sm" onClick={() => setIsAutoRefresh(!isAutoRefresh)}>
              {isAutoRefresh ? "Parar Auto" : "Auto Refresh"}
            </Button>
            <Button variant="outline" size="sm" onClick={fetchLogs} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
            <Button variant="outline" size="sm" onClick={copyLogs} disabled={logs.length === 0}>
              {copied ? <Check className="h-4 w-4 text-green-500" /> : <ClipboardCopy className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading && logs.length === 0 ? (
          <div className="flex justify-center items-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <span className="ml-2">Buscando logs...</span>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-md p-4 text-red-700">
            <div className="flex">
              <AlertCircle className="h-5 w-5 mr-2" />
              <span>{error}</span>
            </div>
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mx-auto mb-4 text-gray-400"
            >
              <path d="M12 2H2v10h10V2z"></path>
              <path d="M12 12h10v10H12V12z"></path>
              <path d="M22 2h-8v8h8V2z"></path>
              <path d="M10 14H2v8h8v-8z"></path>
            </svg>
            <p>Nenhum log encontrado para a transação #{transactionId}</p>
            <p className="text-sm mt-2">Os logs podem levar alguns minutos para aparecer no CloudWatch</p>
            <Button variant="outline" size="sm" onClick={fetchLogs} className="mt-4">
              Tentar Novamente
            </Button>
          </div>
        ) : (
          <div
            ref={logsRef}
            className="space-y-2 max-h-[500px] overflow-y-auto border rounded-md p-3 bg-black text-gray-100"
          >
            {logs.map((log) => {
              const logType = getLogType(log.message)
              return (
                <div
                  key={log.id}
                  className={`p-2 rounded border-l-4 ${
                    logType === "error"
                      ? "border-l-red-500 bg-red-950/20"
                      : logType === "warning"
                        ? "border-l-amber-500 bg-amber-950/20"
                        : logType === "success"
                          ? "border-l-green-500 bg-green-950/20"
                          : "border-l-blue-500 bg-blue-950/20"
                  }`}
                >
                  <div className="flex items-start">
                    <div className="mr-2 mt-1">{renderLogIcon(logType)}</div>
                    <div className="flex-1 overflow-hidden">
                      <div className="text-xs text-gray-400 mb-1 flex justify-between">
                        <span>{new Date(log.timestamp).toLocaleString()}</span>
                        <span className="text-gray-500">
                          {formatDistanceToNow(new Date(log.timestamp), {
                            addSuffix: true,
                            locale: ptBR,
                          })}
                        </span>
                      </div>
                      <div className="text-sm font-mono">{formatMessage(log.message)}</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

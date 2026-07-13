"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, RefreshCw, AlertTriangle, Info, CheckCircle, XCircle } from "lucide-react"

interface CloudWatchLogsProps {
  transactionId?: number
  refreshTrigger?: number
}

export function CloudWatchLogs({ transactionId, refreshTrigger }: CloudWatchLogsProps) {
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchLogs = async () => {
    if (!transactionId) return

    setLoading(true)
    setError(null)

    try {
      // Buscar logs do CloudWatch relacionados à transação
      const response = await fetch(`/api/aws/cloudwatch-logs?transactionId=${transactionId}`)

      if (!response.ok) {
        throw new Error(`Erro ao buscar logs: ${response.status}`)
      }

      const data = await response.json()

      if (data.error) {
        throw new Error(data.error)
      }

      setLogs(data.events || [])
    } catch (err) {
      console.error("Erro ao buscar logs:", err)
      setError(err instanceof Error ? err.message : "Erro desconhecido ao buscar logs")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (transactionId) {
      fetchLogs()
    }
  }, [transactionId, refreshTrigger])

  // Função para determinar o tipo de log
  const getLogType = (message: string) => {
    const lowerMessage = message.toLowerCase()
    if (lowerMessage.includes("error") || lowerMessage.includes("exception") || lowerMessage.includes("fail")) {
      return "error"
    } else if (lowerMessage.includes("warn")) {
      return "warning"
    } else if (lowerMessage.includes("info")) {
      return "info"
    } else if (lowerMessage.includes("success") || lowerMessage.includes("completed")) {
      return "success"
    }
    return "default"
  }

  // Função para obter o ícone baseado no tipo de log
  const getLogIcon = (type: string) => {
    switch (type) {
      case "error":
        return <XCircle className="h-4 w-4 text-red-500" />
      case "warning":
        return <AlertTriangle className="h-4 w-4 text-amber-500" />
      case "info":
        return <Info className="h-4 w-4 text-blue-500" />
      case "success":
        return <CheckCircle className="h-4 w-4 text-green-500" />
      default:
        return <Info className="h-4 w-4 text-gray-400" />
    }
  }

  // Função para formatar a mensagem de log
  const formatLogMessage = (message: string) => {
    // Remover timestamps e prefixos comuns dos logs do Lambda
    return message.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s+\w+\s+/, "")
  }

  if (!transactionId) {
    return <div className="text-center p-4 text-gray-500">Selecione uma transação para visualizar os logs</div>
  }

  return (
    <div className="bg-gray-50 border rounded-md p-4 mt-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium">Logs do CloudWatch</h3>
        <Button variant="outline" size="sm" onClick={fetchLogs} disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Carregando...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Atualizar
            </>
          )}
        </Button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          <p className="flex items-center">
            <AlertTriangle className="h-4 w-4 mr-2" />
            {error}
          </p>
        </div>
      )}

      <div className="bg-white border rounded-md overflow-hidden">
        {loading ? (
          <div className="flex justify-center items-center h-32">
            <Loader2 className="h-6 w-6 animate-spin text-blue-500 mr-2" />
            <span>Carregando logs...</span>
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center p-8 text-gray-500">
            <Info className="h-8 w-8 mx-auto mb-2 text-gray-400" />
            <p>Nenhum log encontrado para esta transação</p>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-48"
                  >
                    Timestamp
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Mensagem
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {logs.map((log) => {
                  const logType = getLogType(log.message)
                  const logIcon = getLogIcon(logType)

                  return (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-sm">
                        <div className="flex items-start">
                          <div className="mr-2 mt-0.5 flex-shrink-0">{logIcon}</div>
                          <div
                            className={`
                              font-mono text-xs break-words
                              ${logType === "error" ? "text-red-600" : ""}
                              ${logType === "warning" ? "text-amber-600" : ""}
                              ${logType === "success" ? "text-green-600" : ""}
                              ${logType === "info" ? "text-blue-600" : ""}
                              ${logType === "default" ? "text-gray-600" : ""}
                            `}
                          >
                            {formatLogMessage(log.message)}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

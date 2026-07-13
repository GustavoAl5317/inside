"use client"

import { useState, useEffect, useRef } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Loader2, Download, RefreshCw, X, Search, Filter, Eye } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

interface LogEntry {
  id: string
  timestamp: string
  level: "info" | "warn" | "error" | "debug"
  message: string
  source?: string
  transactionId?: string
  details?: any
}

interface ServerLogsModalProps {
  isOpen: boolean
  onClose: () => void
  transactionId?: string
  title?: string
}

// Funções específicas para filtrar
const SPECIFIC_FUNCTIONS = [
  'checkCliente',
  'createCliente', 
  'checkProduto',
  'createProduto',
  'checkServico',
  'createServico',
  'createOC',
  'createOV',
  'createOS'
]

export function ServerLogsModal({ isOpen, onClose, transactionId, title = "Logs do Servidor" }: ServerLogsModalProps) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [filteredLogs, setFilteredLogs] = useState<LogEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [levelFilter, setLevelFilter] = useState<string>("all")
  const [showOnlySpecificFunctions, setShowOnlySpecificFunctions] = useState(true)
  const [selectedFunction, setSelectedFunction] = useState<string>("all")

  // Ref para armazenar o ID do timer do polling
  const pollingRef = useRef<NodeJS.Timeout | null>(null)

  const fetchLogs = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams()
      if (transactionId) {
        params.append('transactionId', transactionId)
      }
      // Buscar logs da AWS Lambda no CloudWatch
      params.append('action', 'lambda')
      params.append('functionName', 'inside-sales-webhook')
      params.append('limit', '500') // Aumentar limite para pegar mais logs

      const response = await fetch(`/api/logs/cloudwatch?${params}`)

      if (!response.ok) {
        throw new Error(`Erro ao buscar logs: ${response.statusText}`)
      }

      const data = await response.json()

      if (data.success && data.logs) {
        const formattedLogs: LogEntry[] = data.logs.map((log: any, index: number) => ({
          id: `${log.timestamp}-${index}`,
          timestamp: log.timestamp,
          level: log.level || 'info',
          message: log.message,
          source: 'CloudWatch',
          transactionId: log.transactionId || transactionId,
          details: log.details
        }))
        setLogs(formattedLogs)
      } else {
        throw new Error(data.error || 'Erro desconhecido ao buscar logs')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido')

      // Fallback para logs locais se CloudWatch falhar
      try {
        const fallbackResponse = await fetch('/api/logs/capture')
        if (fallbackResponse.ok) {
          const fallbackData = await fallbackResponse.json()
          if (fallbackData.logs) {
            const fallbackLogs: LogEntry[] = fallbackData.logs.map((log: any, index: number) => ({
              id: `fallback-${index}`,
              timestamp: log.timestamp || new Date().toISOString(),
              level: log.level || 'info',
              message: log.message || JSON.stringify(log),
              source: 'Local',
              transactionId: transactionId
            }))
            setLogs(fallbackLogs)
            setError(null)
          }
        }
      } catch (fallbackErr) {
        // fallback error ignored
      }
    } finally {
      setIsLoading(false)
    }
  }

  // Função para verificar se a mensagem contém 'checkCliente' (case insensitive)
  const containsCheckCliente = (message: string) => {
    if (!message) return false
    return message.toLowerCase().includes('checkcliente')
  }

  // Função MELHORADA para verificar se o log contém uma das funções específicas
  const containsSpecificFunction = (message: string) => {
    if (!message) return false

    const messageText = message.toLowerCase()

    return SPECIFIC_FUNCTIONS.some(func => {
      const funcLower = func.toLowerCase()
      return (
        messageText.includes(funcLower) ||
        messageText.includes(`"${funcLower}"`) ||
        messageText.includes(`'${funcLower}'`) ||
        messageText.includes(`${funcLower}(`) ||
        messageText.includes(`${funcLower}:`) ||
        messageText.includes(`${funcLower} `) ||
        messageText.includes(` ${funcLower}`) ||
        messageText.startsWith(funcLower)
      )
    })
  }

  // Função MELHORADA para extrair o nome da função do log
  const extractFunctionName = (message: string) => {
    if (!message) return null

    const messageText = message.toLowerCase()

    for (const func of SPECIFIC_FUNCTIONS) {
      const funcLower = func.toLowerCase()
      if (
        messageText.includes(funcLower) ||
        messageText.includes(`"${funcLower}"`) ||
        messageText.includes(`'${funcLower}'`) ||
        messageText.includes(`${funcLower}(`) ||
        messageText.includes(`${funcLower}:`) ||
        messageText.includes(`${funcLower} `) ||
        messageText.includes(` ${funcLower}`) ||
        messageText.startsWith(funcLower)
      ) {
        return func
      }
    }
    return null
  }

  // Filtrar logs baseado nos critérios - MELHORADO
  useEffect(() => {
    console.log('Aplicando filtros:', {
      totalLogs: logs.length,
      showOnlySpecificFunctions,
      selectedFunction,
      levelFilter,
      searchTerm
    })

    let filtered = [...logs]

    // Filtro por funções específicas
    if (showOnlySpecificFunctions) {
      filtered = filtered.filter(log => {
        const contains = containsSpecificFunction(log.message)
        if (contains) {
          console.log('Log com função específica:', log.message.substring(0, 100))
        }
        return contains
      })
      console.log(`Após filtro de funções específicas: ${filtered.length} logs`)
    }

    // Filtro por função específica selecionada
    if (selectedFunction !== "all") {
      filtered = filtered.filter(log => {
        const messageText = log.message.toLowerCase()
        const funcLower = selectedFunction.toLowerCase()
        return (
          messageText.includes(funcLower) ||
          messageText.includes(`"${funcLower}"`) ||
          messageText.includes(`'${funcLower}'`) ||
          messageText.includes(`${funcLower}(`) ||
          messageText.includes(`${funcLower}:`) ||
          messageText.includes(`${funcLower} `) ||
          messageText.includes(` ${funcLower}`) ||
          messageText.startsWith(funcLower)
        )
      })
      console.log(`Após filtro de função específica (${selectedFunction}): ${filtered.length} logs`)
    }

    // Filtro por nível
    if (levelFilter !== "all") {
      filtered = filtered.filter(log => log.level === levelFilter)
      console.log(`Após filtro de nível (${levelFilter}): ${filtered.length} logs`)
    }

    // Filtro por termo de busca
    if (searchTerm) {
      filtered = filtered.filter(log =>
        log.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.timestamp.includes(searchTerm) ||
        (log.transactionId && log.transactionId.includes(searchTerm))
      )
      console.log(`Após filtro de busca (${searchTerm}): ${filtered.length} logs`)
    }

    // Ordenar por timestamp (mais recente primeiro)
    filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    console.log(`Logs finais filtrados: ${filtered.length}`)
    setFilteredLogs(filtered)
  }, [logs, searchTerm, levelFilter, showOnlySpecificFunctions, selectedFunction])

  // Polling para atualizar os logs a cada 3 segundos enquanto o modal estiver aberto
  useEffect(() => {
    if (isOpen) {
      fetchLogs()
      pollingRef.current = setInterval(() => {
        fetchLogs()
      }, 3000)
    } else {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
    // Cleanup no unmount
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [isOpen, transactionId])

  const formatTimestamp = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3
      })
    } catch {
      return timestamp
    }
  }

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'error':
        return 'bg-red-100 text-red-800 border-red-200'
      case 'warn':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200'
      case 'info':
        return 'bg-blue-100 text-blue-800 border-blue-200'
      case 'debug':
        return 'bg-gray-100 text-gray-800 border-gray-200'
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  const getFunctionBadgeColor = (functionName: string) => {
    const colors = [
      'bg-purple-100 text-purple-800',
      'bg-green-100 text-green-800',
      'bg-orange-100 text-orange-800',
      'bg-pink-100 text-pink-800',
      'bg-indigo-100 text-indigo-800',
      'bg-teal-100 text-teal-800',
      'bg-cyan-100 text-cyan-800',
      'bg-lime-100 text-lime-800',
      'bg-amber-100 text-amber-800'
    ]
    const index = SPECIFIC_FUNCTIONS.indexOf(functionName)
    return index >= 0 ? colors[index % colors.length] : 'bg-gray-100 text-gray-800'
  }

  const downloadLogs = () => {
    const logText = filteredLogs.map(log => 
      `[${formatTimestamp(log.timestamp)}] ${log.level.toUpperCase()}: ${log.message}`
    ).join('\n')
    
    const blob = new Blob([logText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `server-logs-${transactionId || 'all'}-${new Date().toISOString().split('T')[0]}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Contar logs por função - MELHORADO
  const functionCounts = SPECIFIC_FUNCTIONS.reduce((acc, func) => {
    acc[func] = logs.filter(log => {
      const messageText = log.message.toLowerCase()
      const funcLower = func.toLowerCase()
      return (
        messageText.includes(funcLower) ||
        messageText.includes(`"${funcLower}"`) ||
        messageText.includes(`'${funcLower}'`) ||
        messageText.includes(`${funcLower}(`) ||
        messageText.includes(`${funcLower}:`) ||
        messageText.includes(`${funcLower} `) ||
        messageText.includes(` ${funcLower}`) ||
        messageText.startsWith(funcLower)
      )
    }).length
    return acc
  }, {} as Record<string, number>)

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] w-full max-h-[95vh] h-full flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg">
            {title}
            {transactionId && (
              <Badge variant="outline">
                Transação: {transactionId}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Controles - RESPONSIVO */}
        <div className="flex flex-col gap-3 mb-4 flex-shrink-0">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={fetchLogs}
                disabled={isLoading}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Atualizar
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                onClick={downloadLogs}
                disabled={filteredLogs.length === 0}
              >
                <Download className="h-4 w-4 mr-2" />
                Baixar
              </Button>
            </div>
            
            <div className="flex items-center gap-2 sm:ml-auto">
              <Badge variant="secondary" className="text-xs">
                {filteredLogs.length} de {logs.length} logs
              </Badge>
            </div>
          </div>

          {/* Filtro de funções específicas - RESPONSIVO */}
          <div className="flex flex-col lg:flex-row lg:items-center gap-3 p-3 bg-blue-50 rounded-lg border">
            <div className="flex items-center space-x-2">
              <Switch
                id="specific-functions"
                checked={showOnlySpecificFunctions}
                onCheckedChange={setShowOnlySpecificFunctions}
              />
              <Label htmlFor="specific-functions" className="text-sm font-medium">
                <Eye className="h-4 w-4 inline mr-1" />
                Mostrar apenas funções específicas
              </Label>
            </div>
            
            {showOnlySpecificFunctions && (
              <Select value={selectedFunction} onValueChange={setSelectedFunction}>
                <SelectTrigger className="w-full lg:w-64">
                  <SelectValue placeholder="Função específica" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as funções ({Object.values(functionCounts).reduce((a, b) => a + b, 0)})</SelectItem>
                  {SPECIFIC_FUNCTIONS.map(func => (
                    <SelectItem key={func} value={func}>
                      {func} ({functionCounts[func] || 0})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Filtros gerais - RESPONSIVO */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Buscar nos logs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger className="w-full sm:w-40">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="warn">Warning</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="debug">Debug</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Área de logs com SCROLL NATIVO e RESPONSIVIDADE CORRIGIDA */}
        <div 
          className="flex-1 border rounded-md bg-gray-50 p-2 sm:p-4 overflow-y-auto overflow-x-hidden"
          style={{ 
            minHeight: '400px', 
            maxHeight: 'calc(95vh - 300px)',
            overflowY: 'auto',
            overflowX: 'hidden',
            scrollBehavior: 'smooth'
          }}
        >
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              Carregando logs...
            </div>
          )}

          {error && (
            <div className="text-red-600 text-center py-8">
              <p className="font-medium">Erro ao carregar logs</p>
              <p className="text-sm mt-1">{error}</p>
              <p className="text-xs mt-2 text-gray-500">
                Tentando usar logs locais como fallback...
              </p>
            </div>
          )}

          {!isLoading && !error && filteredLogs.length === 0 && logs.length > 0 && (
            <div className="text-gray-500 text-center py-8">
              <p>Nenhum log encontrado com os filtros aplicados</p>
              <p className="text-sm mt-1">
                {showOnlySpecificFunctions 
                  ? "Tente desabilitar o filtro de funções específicas ou ajustar outros filtros"
                  : "Tente ajustar a busca ou filtros"
                }
              </p>
              <div className="mt-4 text-xs text-gray-400">
                <p>Logs totais: {logs.length}</p>
                <p className="break-words">Funções encontradas: {Object.entries(functionCounts).filter(([_, count]) => count > 0).map(([func, count]) => `${func}(${count})`).join(', ')}</p>
              </div>
            </div>
          )}

          {!isLoading && !error && logs.length === 0 && (
            <div className="text-gray-500 text-center py-8">
              Nenhum log encontrado para esta transação
            </div>
          )}

          {!isLoading && filteredLogs.length > 0 && (
            <div className="space-y-3">
              {filteredLogs.map((log) => {
                const functionName = extractFunctionName(log.message)
                const isCheckCliente = containsCheckCliente(log.message)
                return (
                  <div
                    key={log.id}
                    className={`border rounded-lg p-3 bg-white hover:bg-gray-50 transition-colors shadow-sm w-full ${isCheckCliente ? 'border-green-500 bg-green-50' : ''}`}
                  >
                    <div className="flex flex-col lg:flex-row lg:items-start gap-3">
                      <div className="flex-shrink-0">
                        <Badge className={getLevelColor(log.level)} variant="outline">
                          {log.level.toUpperCase()}
                        </Badge>
                      </div>

                      <div className="flex-1 min-w-0 w-full">
                        {/* Badges - RESPONSIVO */}
                        <div className="flex flex-wrap items-center gap-1 sm:gap-2 mb-2">
                          <span className="text-xs text-gray-500 font-mono break-all">
                            {formatTimestamp(log.timestamp)}
                          </span>
                          {log.source && (
                            <Badge variant="outline" className="text-xs">
                              {log.source}
                            </Badge>
                          )}
                          {log.transactionId && (
                            <Badge variant="secondary" className="text-xs">
                              ID: {log.transactionId}
                            </Badge>
                          )}
                          {functionName && (
                            <Badge className={`text-xs ${getFunctionBadgeColor(functionName)}`} variant="outline">
                              📋 {functionName}
                            </Badge>
                          )}
                        </div>

                        {/* Mensagem - RESPONSIVO com quebra de linha */}
                        <div
                          className="text-sm text-gray-900 font-mono bg-gray-50 p-3 rounded border w-full overflow-auto"
                          style={{
                            maxHeight: '150px',
                            overflowY: 'auto',
                            overflowX: 'auto',
                            wordBreak: 'break-all',
                            whiteSpace: 'pre-wrap',
                            maxWidth: '100%'
                          }}
                        >
                          {log.message}
                        </div>

                        {/* Detalhes - RESPONSIVO */}
                        {log.details && (
                          <details className="mt-2">
                            <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
                              Ver detalhes
                            </summary>
                            <pre className="mt-1 text-xs bg-gray-100 p-2 rounded border overflow-auto max-h-32 w-full">
                              {JSON.stringify(log.details, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <DialogFooter className="flex-shrink-0">
          <Button variant="outline" onClick={onClose}>
            <X className="h-4 w-4 mr-2" />
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
// Tipos para os logs
export interface LogEntry {
  timestamp: number
  level: "info" | "warn" | "error" | "debug"
  message: string
  source: string
  metadata?: Record<string, any>
}

// Função simulada para salvar logs em banco de dados
// 👉 substitua pelo seu insert real (ex: Prisma, Firestore, SQL, etc.)
async function insertLog(data: {
  timestamp: number
  level: string
  message: string
  source: string
  transactionId?: string | null
  metadata?: Record<string, any> | null
}) {
  // Exemplo: salvar no console
  console.log("[DB LOG]", data)
}

// Classe para gerenciar logs em tempo real
class LogCaptureService {
  private static instance: LogCaptureService | null = null
  private logs: Record<string, LogEntry[]> = {}
  private subscribers: Record<string, Set<(log: LogEntry) => void>> = {}
  private maxLogsPerProcess = 1000
  private initialized = false

  constructor() {
    // Inicializar com logs do sistema
    this.logs["system"] = []
    this.subscribers["system"] = new Set()

    // Marcar como inicializado
    this.initialized = true

    // Adicionar log inicial
    this.captureLog("system", {
      timestamp: Date.now(),
      level: "info",
      message: "Serviço de logs inicializado",
      source: "system",
    })

    console.log("LogCaptureService inicializado")
  }

  // Padrão Singleton
  public static getInstance(): LogCaptureService {
    if (!LogCaptureService.instance) {
      LogCaptureService.instance = new LogCaptureService()
    }
    return LogCaptureService.instance
  }

  // Verificar se o serviço está inicializado
  public isInitialized(): boolean {
    return this.initialized
  }

  // Capturar um novo log
  public async captureLog(processId: string, log: LogEntry): Promise<void> {
    try {
      // Garantir que o processId existe
      if (!this.logs[processId]) {
        this.logs[processId] = []
        this.subscribers[processId] = new Set()
      }

      // Adicionar timestamp se não existir
      if (!log.timestamp) {
        log.timestamp = Date.now()
      }

      // Adicionar o log em memória
      this.logs[processId].push(log)

      // Limitar o número de logs
      if (this.logs[processId].length > this.maxLogsPerProcess) {
        this.logs[processId] = this.logs[processId].slice(-this.maxLogsPerProcess)
      }

      // Salvar log no banco de dados
      await insertLog({
        timestamp: log.timestamp,
        level: log.level,
        message: log.message,
        source: log.source,
        transactionId: log.metadata?.transactionId || null,
        metadata: log.metadata || null,
      })

      // Notificar subscribers
      this.notifySubscribers(processId, log)
    } catch (error) {
      console.error("Erro ao capturar log:", error)
    }
  }

  // Obter logs de um processo
  public getLogs(processId: string): LogEntry[] {
    return this.logs[processId] || []
  }

  // Limpar logs de um processo
  public clearLogs(processId: string): void {
    if (this.logs[processId]) {
      this.logs[processId] = []
    }
  }

  // Assinar para receber novos logs
  public subscribe(processId: string, callback: (log: LogEntry) => void): () => void {
    if (!this.subscribers[processId]) {
      this.subscribers[processId] = new Set()
    }
    this.subscribers[processId].add(callback)

    // Retornar função para cancelar assinatura
    return () => {
      if (this.subscribers[processId]) {
        this.subscribers[processId].delete(callback)
      }
    }
  }

  // Notificar subscribers sobre um novo log
  private notifySubscribers(processId: string, log: LogEntry): void {
    try {
      if (this.subscribers[processId]) {
        this.subscribers[processId].forEach((callback) => {
          try {
            callback(log)
          } catch (error) {
            console.error("Erro ao notificar subscriber:", error)
          }
        })
      }

      if (processId !== "system" && this.subscribers["system"]) {
        this.subscribers["system"].forEach((callback) => {
          try {
            callback(log)
          } catch (error) {
            console.error("Erro ao notificar subscriber do sistema:", error)
          }
        })
      }
    } catch (error) {
      console.error("Erro ao notificar subscribers:", error)
    }
  }
}

// Criar instância singleton
export const logCaptureService = LogCaptureService.getInstance()

// Função auxiliar para adicionar logs
export function captureLog(
  message: string,
  level: "info" | "warn" | "error" | "debug" = "info",
  processId = "system",
  metadata?: any,
  source = "system",
): void {
  const log: LogEntry = {
    timestamp: Date.now(),
    level,
    message,
    source,
    metadata,
  }

  logCaptureService.captureLog(processId, log)
}

// Helpers
export const logInfo = (message: string, processId?: string, metadata?: any, source?: string) =>
  captureLog(message, "info", processId, metadata, source)

export const logWarn = (message: string, processId?: string, metadata?: any, source?: string) =>
  captureLog(message, "warn", processId, metadata, source)

export const logError = (message: string, processId?: string, metadata?: any, source?: string) =>
  captureLog(message, "error", processId, metadata, source)

export const logDebug = (message: string, processId?: string, metadata?: any, source?: string) =>
  captureLog(message, "debug", processId, metadata, source)

// Inicializar com alguns logs para teste
if (typeof window === "undefined") {
  logInfo("Servidor iniciado")
  logDebug("Ambiente: " + process.env.NODE_ENV)
}

// Utilitário para capturar logs no cliente e enviá-los para o servidor
let logBuffer: any[] = []
let isProcessing = false
const MAX_BUFFER_SIZE = 100
const FLUSH_INTERVAL = 2000 // 2 segundos

// Função para enviar logs para o servidor
async function flushLogs(processId: string) {
  if (isProcessing || logBuffer.length === 0) return

  isProcessing = true
  const logsToSend = [...logBuffer]
  logBuffer = []

  try {
    await fetch("/api/logs/capture", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        processId,
        logs: logsToSend,
      }),
    })
  } catch (error) {
    console.error("Erro ao enviar logs para o servidor:", error)
    // Adicionar logs de volta ao buffer para tentar novamente
    logBuffer = [...logsToSend, ...logBuffer].slice(0, MAX_BUFFER_SIZE)
  } finally {
    isProcessing = false
  }
}

// Configurar intervalo para enviar logs periodicamente
let flushInterval: NodeJS.Timeout | null = null

// Função para capturar logs no cliente
export function captureClientLogs(processId = "client") {
  if (typeof window === "undefined") return // Verificar se estamos no cliente

  // Limpar intervalo existente
  if (flushInterval) {
    clearInterval(flushInterval)
  }

  // Configurar novo intervalo
  flushInterval = setInterval(() => flushLogs(processId), FLUSH_INTERVAL)

  // Substituir console.log
  const originalConsoleLog = console.log
  const originalConsoleError = console.error
  const originalConsoleWarn = console.warn
  const originalConsoleInfo = console.info
  const originalConsoleDebug = console.debug

  console.log = (...args) => {
    const message = args.map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg))).join(" ")

    logBuffer.push({
      timestamp: Date.now(),
      level: "info",
      message,
      source: "stdout",
    })

    if (logBuffer.length >= MAX_BUFFER_SIZE) {
      flushLogs(processId)
    }

    originalConsoleLog.apply(console, args)
  }

  console.error = (...args) => {
    const message = args.map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg))).join(" ")

    logBuffer.push({
      timestamp: Date.now(),
      level: "error",
      message,
      source: "stderr",
    })

    if (logBuffer.length >= MAX_BUFFER_SIZE) {
      flushLogs(processId)
    }

    originalConsoleError.apply(console, args)
  }

  console.warn = (...args) => {
    const message = args.map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg))).join(" ")

    logBuffer.push({
      timestamp: Date.now(),
      level: "warn",
      message,
      source: "stdout",
    })

    if (logBuffer.length >= MAX_BUFFER_SIZE) {
      flushLogs(processId)
    }

    originalConsoleWarn.apply(console, args)
  }

  console.info = (...args) => {
    const message = args.map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg))).join(" ")

    logBuffer.push({
      timestamp: Date.now(),
      level: "info",
      message,
      source: "stdout",
    })

    if (logBuffer.length >= MAX_BUFFER_SIZE) {
      flushLogs(processId)
    }

    originalConsoleInfo.apply(console, args)
  }

  console.debug = (...args) => {
    const message = args.map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg))).join(" ")

    logBuffer.push({
      timestamp: Date.now(),
      level: "debug",
      message,
      source: "stdout",
    })

    if (logBuffer.length >= MAX_BUFFER_SIZE) {
      flushLogs(processId)
    }

    originalConsoleDebug.apply(console, args)
  }

  // Capturar erros não tratados
  window.addEventListener("error", (event) => {
    logBuffer.push({
      timestamp: Date.now(),
      level: "error",
      message: `Erro não tratado: ${event.message} em ${event.filename}:${event.lineno}:${event.colno}`,
      source: "window",
      metadata: {
        stack: event.error?.stack,
        type: "uncaught-error",
      },
    })

    flushLogs(processId)
  })

  // Capturar rejeições de promessas não tratadas
  window.addEventListener("unhandledrejection", (event) => {
    logBuffer.push({
      timestamp: Date.now(),
      level: "error",
      message: `Promessa rejeitada não tratada: ${event.reason}`,
      source: "window",
      metadata: {
        reason: event.reason,
        type: "unhandled-rejection",
      },
    })

    flushLogs(processId)
  })

  // Enviar logs ao descarregar a página
  window.addEventListener("beforeunload", () => {
    if (logBuffer.length > 0) {
      // Usar sendBeacon para enviar logs de forma confiável ao fechar a página
      const blob = new Blob(
        [
          JSON.stringify({
            processId,
            logs: logBuffer,
          }),
        ],
        { type: "application/json" },
      )

      navigator.sendBeacon("/api/logs/capture", blob)
      logBuffer = []
    }

    if (flushInterval) {
      clearInterval(flushInterval)
    }
  })

  return () => {
    // Função para limpar
    console.log = originalConsoleLog
    console.error = originalConsoleError
    console.warn = originalConsoleWarn
    console.info = originalConsoleInfo
    console.debug = originalConsoleDebug

    if (flushInterval) {
      clearInterval(flushInterval)
    }
  }
}

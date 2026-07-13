"use client"

import { useEffect } from "react"

export function LogInitializer() {
  useEffect(() => {
    // Gerar alguns logs de teste para garantir que o sistema está funcionando
    console.log("Log Initializer: Cliente inicializado")
    console.info("Log Initializer: Informação de teste")
    console.warn("Log Initializer: Aviso de teste")

    try {
      throw new Error("Erro de teste controlado")
    } catch (error) {
      console.error("Log Initializer: Erro capturado:", error)
    }

    // Capturar erros não tratados
    const originalOnError = window.onerror
    window.onerror = (message, source, lineno, colno, error) => {
      fetch("/api/logs/capture", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          level: "error",
          message: `Erro não tratado: ${message}`,
          source: "client",
          metadata: { source, lineno, colno, stack: error?.stack },
        }),
      }).catch(console.error)

      if (originalOnError) {
        return originalOnError(message, source, lineno, colno, error)
      }
      return false
    }

    // Capturar rejeições de promessas não tratadas
    const originalOnUnhandledRejection = window.onunhandledrejection
    window.onunhandledrejection = (event) => {
      fetch("/api/logs/capture", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          level: "error",
          message: `Promessa rejeitada não tratada: ${event.reason}`,
          source: "client",
          metadata: { reason: event.reason?.stack || event.reason },
        }),
      }).catch(console.error)

      if (originalOnUnhandledRejection) {
        originalOnUnhandledRejection.call(window, event)
      }
    }

    return () => {
      // Restaurar manipuladores originais
      window.onerror = originalOnError
      window.onunhandledrejection = originalOnUnhandledRejection
    }
  }, [])

  return null
}

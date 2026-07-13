"use client"

import { useEffect } from "react"
import { captureClientLogs } from "@/lib/client-log-capture"

export function ClientLogInitializer() {
  useEffect(() => {
    // Inicializar captura de logs no cliente
    const cleanup = captureClientLogs()

    // Registrar inicialização
    console.log("Captura de logs do cliente inicializada")

    return cleanup
  }, [])

  return null // Componente não renderiza nada
}

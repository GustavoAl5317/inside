import { RealTimeLogs } from "@/components/real-time-logs"
import { LogInitializer } from "@/components/log-initializer"

export default function LogsPage() {
  return (
    <div className="container mx-auto py-6">
      <h1 className="text-2xl font-bold mb-6">Logs do Sistema</h1>

      {/* Inicializador de logs */}
      <LogInitializer />

      {/* Visualizador de logs */}
      <RealTimeLogs
        processId="system"
        title="Logs do Sistema"
        description="Visualização em tempo real de todos os logs do sistema"
        height="600px"
      />
    </div>
  )
}

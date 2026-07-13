"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { TransactionLogs } from "@/components/transaction-logs"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"

export default function TransactionDetailsPage() {
  const params = useParams()
  const transactionId = Array.isArray(params.id) ? params.id[0] : (params.id ?? "")
  const [transaction, setTransaction] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState("details")

  useEffect(() => {
    async function fetchTransactionDetails() {
      try {
        setLoading(true)
        // Buscar detalhes da transação
        const response = await fetch(`/api/process/${transactionId}`)

        if (!response.ok) {
          throw new Error(`Erro ao buscar transação: ${response.status}`)
        }

        const data = await response.json()
        setTransaction(data)
      } catch (error) {
        console.error("Erro ao buscar detalhes da transação:", error)
      } finally {
        setLoading(false)
      }
    }

    if (transactionId) {
      fetchTransactionDetails()
    }
  }, [transactionId])

  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    )
  }

  if (!transaction) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-bold">Transação não encontrada</h2>
        <p className="mt-2">
          A transação #{transactionId} não foi encontrada ou ocorreu um erro ao buscar seus detalhes.
        </p>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Detalhes da Transação #{transactionId}</h1>
        <Button variant="outline" onClick={() => window.history.back()}>
          Voltar
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="details">Detalhes</TabsTrigger>
          <TabsTrigger value="logs">Logs do CloudWatch</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <Card>
            <CardHeader>
              <CardTitle>Informações da Transação</CardTitle>
              <CardDescription>Detalhes completos da transação</CardDescription>
            </CardHeader>
            <CardContent>
              {/* Renderizar detalhes da transação aqui */}
              <pre className="bg-gray-100 p-4 rounded-md overflow-x-auto">{JSON.stringify(transaction, null, 2)}</pre>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs">
          <TransactionLogs transactionId={transactionId} autoRefresh={true} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

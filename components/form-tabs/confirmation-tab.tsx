"use client"

import type { UseFormReturn } from "react-hook-form"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useState } from "react"
import { ApprovalStatus } from "@/components/approval-status"

interface ConfirmationTabProps {
  form: UseFormReturn<any>
  bitrixDealId?: string
  setBitrixDealId?: (value: string) => void
}

export function ConfirmationTab({ form, bitrixDealId = "", setBitrixDealId }: ConfirmationTabProps) {
  const formData = form.getValues()
  const [testingApi, setTestingApi] = useState(false)
  const [testingAws, setTestingAws] = useState(false)
  const [testingDb, setTestingDb] = useState(false)
  const [debuggingPayload, setDebuggingPayload] = useState(false)

  // Calculate totals
  const totalCost = formData.products.reduce((sum: number, product: any) => sum + (product.totalCost || 0), 0)
  const totalSale = formData.products.reduce((sum: number, product: any) => sum + (product.totalSale || 0), 0)
  const profit = totalSale - totalCost
  const profitMargin = totalCost > 0 ? (profit / totalCost) * 100 : 0

  const testApi = async () => {
    setTestingApi(true)
    try {
      console.log("=== TESTE DE API INICIADO ===")
      const response = await fetch("/api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: true, timestamp: new Date().toISOString() }),
      })

      const contentType = response.headers.get("content-type")
      if (!contentType || !contentType.includes("application/json")) {
        const textResponse = await response.text()
        console.error("Resposta não é JSON:", textResponse.substring(0, 500))
        alert(
          `❌ Erro: A API retornou ${contentType || "conteúdo desconhecido"} em vez de JSON. Verifique se a rota /api/test existe.`,
        )
        return
      }

      const data = await response.json()
      console.log("Resposta do teste:", data)

      if (response.ok) {
        alert("✅ Teste de API concluído com sucesso! Verifique o console para detalhes.")
      } else {
        alert(`❌ Teste falhou: ${data.error || "Erro desconhecido"}`)
      }
    } catch (error) {
      console.error("Erro no teste:", error)
      if (error instanceof SyntaxError && error.message.includes("Unexpected token")) {
        alert("❌ Erro: A API retornou HTML em vez de JSON. Verifique se a rota /api/test existe.")
      } else {
        alert(`❌ Erro no teste: ${error instanceof Error ? error.message : "Erro desconhecido"}`)
      }
    } finally {
      setTestingApi(false)
    }
  }

  const testAwsConnectivity = async () => {
    setTestingAws(true)
    try {
      console.log("=== TESTE DE CONECTIVIDADE AWS MELHORADO ===")
      const response = await fetch("/api/test-aws-connectivity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })

      const data = await response.json()
      console.log("=== RESULTADO COMPLETO DO TESTE AWS ===")
      console.log(data)

      if (data.success) {
        alert(
          `✅ Pelo menos um teste passou!\n` +
            `Testes bem-sucedidos: ${data.analysis.successfulTests}/${data.analysis.totalTests}\n` +
            `Verifique o console para detalhes completos.`,
        )
      } else {
        const errorSummary = data.analysis?.commonErrors?.join("\n") || "Erro desconhecido"
        const recommendations = data.analysis?.recommendations?.join("\n") || "Verificar logs"

        alert(
          `❌ Todos os testes falharam:\n\n` +
            `Erros encontrados:\n${errorSummary}\n\n` +
            `Recomendações:\n${recommendations}\n\n` +
            `Verifique o console para detalhes completos.`,
        )
      }
    } catch (error) {
      console.error("Erro no teste de conectividade:", error)
      alert(`❌ Erro ao testar conectividade AWS: ${error instanceof Error ? error.message : "Erro desconhecido"}`)
    } finally {
      setTestingAws(false)
    }
  }

  const debugPayload = async () => {
    setDebuggingPayload(true)
    try {
      console.log("=== DEBUG DO PAYLOAD INICIADO ===")
      const response = await fetch("/api/debug-aws-payload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ debug: true }),
      })

      const data = await response.json()
      console.log("=== RESULTADO DO DEBUG ===")
      console.log(data)

      if (data.success) {
        const issues = data.issues.length > 0 ? `\nProblemas encontrados: ${data.issues.join(", ")}` : ""
        alert(
          `🔍 Debug do Payload Concluído!\n\n` +
            `Payload válido: ${data.isValid ? "✅ Sim" : "❌ Não"}\n` +
            `Tamanho: ${data.payloadSize} bytes\n` +
            `Validações: ${Object.values(data.validations).filter(Boolean).length}/${Object.keys(data.validations).length} passaram${issues}\n\n` +
            `Verifique o console para o payload completo.`,
        )
      } else {
        alert(`❌ Erro no debug: ${data.error}`)
      }
    } catch (error) {
      console.error("Erro no debug:", error)
      alert(`❌ Erro no debug: ${error instanceof Error ? error.message : "Erro desconhecido"}`)
    } finally {
      setDebuggingPayload(false)
    }
  }

  const testDatabase = async () => {
    setTestingDb(true)
    try {
      console.log("=== TESTE DE BANCO DE DADOS INICIADO ===")
      const response = await fetch("/api/test-database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })

      const data = await response.json()
      console.log("Resultado do teste do banco:", data)

      if (data.success) {
        alert(
          `✅ Banco de dados funcionando!\n` +
            `Tabelas: ${data.tables.length}\n` +
            `Registros: ${data.recordCounts.map((r: any) => `${r.table}: ${r.count}`).join(", ")}`,
        )
      } else {
        alert(`❌ Problema com banco de dados:\n` + `Erro: ${data.error}\n` + `Detalhes: ${data.details}`)
      }
    } catch (error) {
      console.error("Erro no teste do banco:", error)
      alert(`❌ Erro ao testar banco: ${error instanceof Error ? error.message : "Erro desconhecido"}`)
    } finally {
      setTestingDb(false)
    }
  }

  const showFormData = () => {
    console.log("=== DADOS DO FORMULÁRIO ===")
    console.log(JSON.stringify(formData, null, 2))

    const summary = {
      negocio: formData.business?.name || "Não definido",
      fornecedor: formData.companies?.supplier?.name || "Não definido",
      cliente: formData.companies?.customer?.name || "Não definido",
      interatell: formData.companies?.interatell?.name || "Não definido",
      produtos: formData.products?.length || 0,
      totalCusto: totalCost,
      totalVenda: totalSale,
      lucro: profit,
      margemLucro: profitMargin,
    }

    console.log("=== RESUMO DOS DADOS ===")
    console.log(summary)

    alert(
      `📋 Dados do formulário logados no console!\n\n` +
        `Resumo:\n` +
        `• Negócio: ${summary.negocio}\n` +
        `• Produtos: ${summary.produtos}\n` +
        `• Total Venda: ${formatCurrency(summary.totalVenda)}\n` +
        `• Lucro: ${formatCurrency(summary.lucro)}\n\n` +
        `Verifique o console para dados completos.`,
    )
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Confirmação</h2>

      <div className="space-y-4">
        {setBitrixDealId && (
          <div className="border rounded-md p-4 bg-blue-50">
            <h3 className="text-lg font-medium mb-2">Integração com Bitrix24</h3>
            <div className="flex gap-2 items-center">
              <Input
                placeholder="ID do negócio no Bitrix24 (opcional)"
                value={bitrixDealId}
                onChange={(e) => setBitrixDealId(e.target.value)}
                className="max-w-md"
              />
              <p className="text-sm text-muted-foreground">
                Este ID será usado para vincular a transação ao negócio no Bitrix24 quando enviado para o AWS Lambda.
              </p>
            </div>
          </div>
        )}

        {/* Status de Aprovação */}
        <ApprovalStatus
          bitrixDealId={formData.bitrixDealId}
          onApprovalChange={(approved) => {
            console.log('Status de aprovação alterado:', approved);
          }}
        />

        <p className="text-muted-foreground">Revise as informações abaixo antes de enviar a transação.</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border rounded-md p-4">
            <h3 className="text-lg font-medium mb-2">Negócio</h3>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="font-medium">Nome:</div>
                <div>{formData.business.name}</div>

                <div className="font-medium">Data da OC:</div>
                <div>{formatDate(formData.business.purchaseOrderDate)}</div>

                <div className="font-medium">Prazo de Entrega:</div>
                <div>{formatDate(formData.business.deliveryDeadline)}</div>

                <div className="font-medium">Pagamento de Compra:</div>
                <div>{formData.business.purchasePaymentCondition}</div>

                <div className="font-medium">Previsão de Faturamento:</div>
                <div>{formatDate(formData.business.expectedBillingDate)}</div>

                <div className="font-medium">Pagamento de Venda:</div>
                <div>{formData.business.salePaymentCondition}</div>
              </div>
            </div>
          </div>

          <div className="border rounded-md p-4">
            <h3 className="text-lg font-medium mb-2">Empresas</h3>
            <div className="space-y-4">
              <div>
                <h4 className="font-medium mb-1">Fornecedor:</h4>
                <div>
                  {formData.companies.supplier.name} ({formData.companies.supplier.cnpj})
                </div>
              </div>

              <div>
                <h4 className="font-medium mb-1">Cliente Final:</h4>
                <div>
                  {formData.companies.customer.name} ({formData.companies.customer.cnpj})
                </div>
                <div className="text-sm text-muted-foreground">
                  Contribuinte: {formData.companies.customer.isTaxpayer ? "Sim" : "Não"}
                  {formData.companies.customer.purchaseOrder && ` | P.O.: ${formData.companies.customer.purchaseOrder}`}
                </div>
              </div>

              <div>
                <h4 className="font-medium mb-1">Interatell:</h4>
                <div>
                  {formData.companies.interatell.name} ({formData.companies.interatell.cnpj})
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="border rounded-md p-4">
          <h3 className="text-lg font-medium mb-2">Produtos</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2">Partnumber</th>
                  <th className="text-left py-2">Descrição</th>
                  <th className="text-left py-2">Estado</th>
                  <th className="text-right py-2">Qtd</th>
                  <th className="text-right py-2">Custo Unit.</th>
                  <th className="text-right py-2">Custo Total</th>
                  <th className="text-right py-2">Venda Unit.</th>
                  <th className="text-right py-2">Venda Total</th>
                </tr>
              </thead>
              <tbody>
                {formData.products.map((product: any, index: number) => (
                  <tr key={index} className="border-b">
                    <td className="py-2">{product.partnumber}</td>
                    <td className="py-2">{product.description}</td>
                    <td className="py-2">{product.state}</td>
                    <td className="text-right py-2">{product.quantity}</td>
                    <td className="text-right py-2">{formatCurrency(product.unitCost)}</td>
                    <td className="text-right py-2">{formatCurrency(product.totalCost)}</td>
                    <td className="text-right py-2">{formatCurrency(product.unitSale)}</td>
                    <td className="text-right py-2">{formatCurrency(product.totalSale)}</td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td colSpan={5} className="text-right py-2">
                    Total:
                  </td>
                  <td className="text-right py-2">{formatCurrency(totalCost)}</td>
                  <td className="text-right py-2"></td>
                  <td className="text-right py-2">{formatCurrency(totalSale)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mt-4 p-4 bg-muted/20 rounded-md">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="font-medium">Custo Total:</span> {formatCurrency(totalCost)}
              </div>
              <div>
                <span className="font-medium">Venda Total:</span> {formatCurrency(totalSale)}
              </div>
              <div>
                <span className="font-medium">Lucro:</span> {formatCurrency(profit)}
              </div>
              <div>
                <span className="font-medium">Margem de Lucro:</span> {profitMargin.toFixed(2)}%
              </div>
            </div>
          </div>
        </div>

        {(formData.notes.internalNotes || formData.notes.externalNotes) && (
          <div className="border rounded-md p-4">
            <h3 className="text-lg font-medium mb-2">Observações</h3>
            <div className="space-y-4">
              {formData.notes.internalNotes && (
                <div>
                  <h4 className="font-medium mb-1">Observação Interna:</h4>
                  <div className="p-2 bg-muted/20 rounded-md whitespace-pre-wrap">{formData.notes.internalNotes}</div>
                </div>
              )}

              {formData.notes.externalNotes && (
                <div>
                  <h4 className="font-medium mb-1">Observação Externa:</h4>
                  <div className="p-2 bg-muted/20 rounded-md whitespace-pre-wrap">{formData.notes.externalNotes}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {setBitrixDealId && (
        <div className="mt-4 p-4 bg-gray-100 rounded-md">
          <h3 className="text-lg font-medium mb-2">🔍 Ferramentas de Diagnóstico Avançado</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Button type="button" variant="outline" onClick={testApi} disabled={testingApi} className="w-full">
              {testingApi ? "🔄 Testando..." : "🧪 Testar API"}
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={testAwsConnectivity}
              disabled={testingAws}
              className="w-full"
            >
              {testingAws ? "🔄 Testando..." : "🌐 Testar AWS"}
            </Button>

            <Button type="button" variant="outline" onClick={testDatabase} disabled={testingDb} className="w-full">
              {testingDb ? "🔄 Testando..." : "🗄️ Testar Banco"}
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={debugPayload}
              disabled={debuggingPayload}
              className="w-full"
            >
              {debuggingPayload ? "🔄 Debugando..." : "🔍 Debug Payload"}
            </Button>

            <Button type="button" variant="outline" onClick={showFormData} className="w-full">
              📋 Ver Dados
            </Button>
          </div>

          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <h4 className="font-medium mb-2 text-red-800">🚨 Problema Identificado: Erro 400 + Undefined</h4>
            <p className="text-sm text-red-700 mb-2">
              A AWS Lambda está rejeitando o payload (erro 400) e retornando resposta vazia (undefined).
            </p>
            <ul className="text-sm text-red-700 space-y-1">
              <li>
                🔍 <strong>Debug Payload</strong> - Analisa a estrutura exata que será enviada
              </li>
              <li>
                🌐 <strong>Testar AWS</strong> - Testa múltiplos formatos de payload
              </li>
              <li>
                📊 <strong>Console</strong> - Veja logs detalhados de cada teste
              </li>
            </ul>
          </div>

          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
            <h4 className="font-medium mb-2 text-blue-800">💡 Próximos Passos</h4>
            <ol className="text-sm text-blue-700 space-y-1">
              <li>1. Clique em "🔍 Debug Payload" para ver o formato exato</li>
              <li>2. Clique em "🌐 Testar AWS" para testar múltiplos formatos</li>
              <li>3. Verifique o console para logs detalhados</li>
              <li>4. Compare com a documentação da AWS Lambda</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  )
}

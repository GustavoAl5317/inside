"use client"

import { useState } from "react"
import type { UseFormReturn } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { FileText, FileSpreadsheet, Download, Cloud } from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/utils"
import { generateReportAction } from "@/lib/actions"

interface ReportTabProps {
  form: UseFormReturn<any>
}

export function ReportTab({ form }: ReportTabProps) {
  const [isGenerating, setIsGenerating] = useState({
    pdf: false,
    excel: false,
    json: false,
    lambda: false,
  })

  // Função para converter valor para número
  const toNumber = (value: any): number => {
    if (value === null || value === undefined) return 0

    // Se já for um número, retornar diretamente
    if (typeof value === "number") return value

    // Tentar converter para número se for string
    const numValue = typeof value === "string" ? Number.parseFloat(value) : value

    // Verificar se é um número válido
    return isNaN(numValue) ? 0 : numValue
  }

  // Função para validar e preparar dados do formulário
  const prepareReportData = () => {
    const formData = form.getValues()

    // Validar campos obrigatórios
    if (!formData.business?.name || !formData.companies?.supplier?.name || 
        !formData.companies?.customer?.name || !formData.companies?.interatell?.name) {
      alert("Por favor, preencha todos os campos obrigatórios antes de gerar o relatório.")
      return null
    }

    // Preparar dados no formato esperado
    const reportData = {
      business: {
        name: formData.business.name,
        commercialProposal: formData.business.commercialProposal,
        purchaseOrderDate: formData.business.purchaseOrderDate,
        deliveryDeadline: formData.business.deliveryDeadline,
        purchasePaymentCondition: formData.business.purchasePaymentCondition,
        expectedBillingDate: formData.business.expectedBillingDate,
        salePaymentCondition: formData.business.salePaymentCondition
      },
      companies: {
        supplier: formData.companies.supplier,
        customer: formData.companies.customer,
        interatell: formData.companies.interatell
      },
      products: formData.products || [],
      notes: formData.notes
    }

    return reportData
  }

  // Função para gerar PDF
  const handleGeneratePDF = async () => {
    setIsGenerating(prev => ({ ...prev, pdf: true }))
    
    try {
      const reportData = prepareReportData()
      if (!reportData) return

      // Importação dinâmica para evitar problemas de SSR
      const { generatePDFReport } = await import("@/lib/report-generator")
      generatePDFReport(reportData)
    } catch (error) {
      console.error("Erro ao gerar PDF:", error)
      alert("Erro ao gerar relatório PDF. Tente novamente.")
    } finally {
      setIsGenerating(prev => ({ ...prev, pdf: false }))
    }
  }

  // Função para gerar Excel
  const handleGenerateExcel = async () => {
    setIsGenerating(prev => ({ ...prev, excel: true }))
    
    try {
      const reportData = prepareReportData()
      if (!reportData) return

      // Importação dinâmica para evitar problemas de SSR
      const { generateExcelReport } = await import("@/lib/report-generator")
      generateExcelReport(reportData)
    } catch (error) {
      console.error("Erro ao gerar Excel:", error)
      alert("Erro ao gerar relatório Excel. Tente novamente.")
    } finally {
      setIsGenerating(prev => ({ ...prev, excel: false }))
    }
  }

  // Add a new function to generate the AWS Lambda format
  const generateLambdaFormat = (formData: any) => {
    // Verificar se há produtos
    if (!formData.products || formData.products.length === 0) {
      // Se não houver produtos, adicionar um produto padrão
      formData.products = [
        {
          partnumber: "DEFAULT",
          description: "Produto padrão",
          nature: "HW",
          quantity: 1,
          unitCost: 0,
          unitSale: 0,
          totalCost: 0,
          totalSale: 0,
          ncm: "",
          family: "",
        },
      ]
    }

    // Determine if it's a service based on the products
    const hasServiceItems = formData.products.some((product: any) => product.nature === "SRV")
    const type = hasServiceItems ? "SERVICO" : "PRODUTO-SOFTWARE"

    // Mapear todos os produtos (incluindo serviços) para o formato esperado
    const produtos = formData.products.map((product: any) => {
      // Formato padrão para todos os produtos (incluindo serviços)
      return {
        codigo_produto: product.partnumber || "",
        codigo_produto_integracao: product.partnumber || "",
        codigo: product.partnumber || "",
        descricao: product.description || "",
        natureza: product.nature || "HW",
        qtd: toNumber(product.quantity),
        custo_unit: toNumber(product.unitCost),
        valor_unitario: toNumber(product.unitSale),
        ncm: product.ncm || "",
        codigo_familia: product.family || "",
      }
    })

    // Garantir que o array de produtos nunca esteja vazio
    if (produtos.length === 0) {
      produtos.push({
        codigo_produto: "DEFAULT",
        codigo_produto_integracao: "DEFAULT",
        codigo: "DEFAULT",
        descricao: "Produto padrão",
        natureza: "HW",
        qtd: 1,
        custo_unit: 0,
        valor_unitario: 0,
        ncm: "",
        codigo_familia: "",
      })
    }

    // Format the data according to the Lambda requirements
    const lambdaFormat = {
      type: type,

      // Fornecedor (simplificado conforme o modelo)
      fornecedor: {
        cnpj_cpf: formData.companies.interatell.cnpj || "",
      },

      // Cliente final
      cliente: {
        razao_social: formData.companies.customer.name || "",
        nome_fantasia: formData.companies.customer.name || "",
        cnpj_cpf: formData.companies.customer.cnpj || "",
        inscricao_estadual: formData.companies.customer.stateRegistration || "ISENTO",
        email: formData.companies.customer.email || "",
        telefone1_numero: formData.companies.customer.phone || "",
        endereco: formData.companies.customer.address || "",
        endereco_numero: formData.companies.customer.number || "",
        bairro: formData.companies.customer.neighborhood || "",
        cidade: formData.companies.customer.city || "",
        estado: formData.companies.customer.state || "",
        cep: formData.companies.customer.zipCode || "",
        contato: formData.companies.customer.contactName || "",
      },

      // Distribuidor (fornecedor na nossa aplicação)
      distribuidor: {
        razao_social: formData.companies.supplier.name || "",
        cnpj_cpf: formData.companies.supplier.cnpj || "",
        email: formData.companies.supplier.email || "",
      },

      // Produtos e Serviços (agora todos estão no array produtos)
      produtos: produtos,

      // Ordem de Compra
      oc: {
        cNumPedido: formData.business.commercialProposal || "PO-PREVIEW",
        cCodParc: formData.business.purchasePaymentCondition || "30/60/90",
        dDtPrevisao: formData.business.deliveryDeadline || new Date().toISOString().split("T")[0],
      },

      // Ordem de Venda (apenas para PRODUTO-SOFTWARE)
      ov: {
        codigo_pedido: formData.business.commercialProposal || `OV-PREVIEW-${Date.now()}`,
        codigo_parcela: formData.business.salePaymentCondition || "30/60/90",
        data_previsao: formData.business.expectedBillingDate || new Date().toISOString().split("T")[0],
      },
    }

    // Include Bitrix Deal ID if provided
    if (formData.bitrixDealId) {
      // @ts-ignore - Adicionando campo dinamicamente
      lambdaFormat.bitrixDealId = formData.bitrixDealId
    }

    return lambdaFormat
  }

  // Função para abrir conteúdo em nova janela
  const openInNewWindow = (title: string, content: string) => {
    const newWindow = window.open("", "_blank")
    if (newWindow) {
      const htmlContent = `
        <html>
          <head>
            <title>${title}</title>
            <style>
              body { font-family: monospace; padding: 20px; }
              pre { background: #f5f5f5; padding: 15px; border-radius: 5px; overflow: auto; }
            </style>
          </head>
          <body>
            <h1>${title}</h1>
            <pre>${content}</pre>
          </body>
        </html>
      `
      newWindow.document.open()
      newWindow.document.write(htmlContent)
      newWindow.document.close()
    }
  }

  // Add a new function to handle generating the Lambda format
  const handleGenerateLambdaFormat = () => {
    const formData = form.getValues()

    // Generate the Lambda format
    const lambdaFormat = generateLambdaFormat(formData)

    // Open in new window
    openInNewWindow(
      "Formato AWS Lambda",
      `Este é o formato esperado pelo AWS Lambda:\n\n${JSON.stringify(lambdaFormat, null, 2)}`
    )
  }

  const handleGenerateReport = async (type: "json") => {
    setIsGenerating((prev) => ({ ...prev, [type]: true }))

    try {
      const formData = form.getValues()

      // Validar se todos os campos obrigatórios estão preenchidos
      const isBusinessValid = await form.trigger("business")
      const isCompaniesValid = await form.trigger(["companies.supplier", "companies.customer", "companies.interatell"])
      const isProductsValid = await form.trigger("products")

      if (!isBusinessValid || !isCompaniesValid || !isProductsValid) {
        alert("Por favor, preencha todos os campos obrigatórios antes de gerar o relatório.")
        return
      }

      // Gerar o relatório
      const result = await generateReportAction(formData, type)

      if (result.error) {
        alert(result.error)
        return
      }

      if (type === "json") {
        // Para JSON, abrir em nova janela
        openInNewWindow(
          "Dados JSON da Transação",
          JSON.stringify(result.data, null, 2)
        )
      }
    } catch (error) {
      console.error(`Erro ao gerar relatório ${type}:`, error)
      alert(`Erro ao gerar relatório ${type}. Tente novamente.`)
    } finally {
      setIsGenerating((prev) => ({ ...prev, [type]: false }))
    }
  }

  // Calcular totais
  const products = form.getValues("products") || []
  const totals = products.reduce(
    (acc: any, product: any) => {
      const totalCost = toNumber(product.totalCost)
      const totalSale = toNumber(product.totalSale)

      acc.totalCost += totalCost
      acc.totalSale += totalSale
      acc.profit = acc.totalSale - acc.totalCost
      acc.profitMargin = acc.totalSale > 0 ? (acc.profit / acc.totalSale) * 100 : 0

      return acc
    },
    { totalCost: 0, totalSale: 0, profit: 0, profitMargin: 0 }
  )

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium mb-4">Gerar Relatórios</h3>
        <p className="text-sm text-muted-foreground mb-6">
          Gere relatórios detalhados da transação em diferentes formatos para análise e compartilhamento.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <Button
            onClick={handleGeneratePDF}
            disabled={isGenerating.pdf}
            className="h-auto p-4 flex flex-col items-center gap-2"
            variant="outline"
          >
            <FileText className="h-8 w-8" />
            <span className="font-medium">Relatório PDF</span>
            <span className="text-xs text-muted-foreground text-center">
              {isGenerating.pdf ? "Gerando..." : "Ideal para impressão e compartilhamento"}
            </span>
          </Button>

          <Button
            onClick={handleGenerateExcel}
            disabled={isGenerating.excel}
            className="h-auto p-4 flex flex-col items-center gap-2"
            variant="outline"
          >
            <FileSpreadsheet className="h-8 w-8" />
            <span className="font-medium">Planilha Excel</span>
            <span className="text-xs text-muted-foreground text-center">
              {isGenerating.excel ? "Gerando..." : "Para análise e manipulação de dados"}
            </span>
          </Button>

          <Button
            onClick={() => handleGenerateReport("json")}
            disabled={isGenerating.json}
            className="h-auto p-4 flex flex-col items-center gap-2"
            variant="outline"
          >
            <Download className="h-8 w-8" />
            <span className="font-medium">Dados JSON</span>
            <span className="text-xs text-muted-foreground text-center">
              {isGenerating.json ? "Gerando..." : "Dados brutos para integração"}
            </span>
          </Button>

          <Button
            onClick={handleGenerateLambdaFormat}
            disabled={isGenerating.lambda}
            className="h-auto p-4 flex flex-col items-center gap-2"
            variant="outline"
          >
            <Cloud className="h-8 w-8" />
            <span className="font-medium">Formato Lambda</span>
            <span className="text-xs text-muted-foreground text-center">
              {isGenerating.lambda ? "Gerando..." : "Para integração AWS"}
            </span>
          </Button>
        </div>

        <div className="bg-muted/20 rounded-md p-4">
          <h3 className="font-medium mb-4">Prévia do Relatório</h3>
          <div className="space-y-4">
            <div className="border rounded-md p-3">
              <h4 className="font-medium mb-2">Informações Gerais</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <p>
                    <span className="font-medium">Negócio:</span>{" "}
                    {form.getValues("business.name") || "Não preenchido"}
                  </p>
                  <p>
                    <span className="font-medium">Data OC:</span>{" "}
                    {form.getValues("business.purchaseOrderDate") ? formatDate(form.getValues("business.purchaseOrderDate")) : "Não preenchido"}
                  </p>
                </div>
                <div>
                  <p>
                    <span className="font-medium">Fornecedor:</span>{" "}
                    {form.getValues("companies.supplier.name") || "Não preenchido"}
                  </p>
                  <p>
                    <span className="font-medium">Cliente:</span>{" "}
                    {form.getValues("companies.customer.name") || "Não preenchido"}
                  </p>
                  <p>
                    <span className="font-medium">Interatell:</span>{" "}
                    {form.getValues("companies.interatell.name") || "Não preenchido"}
                  </p>
                </div>
              </div>
            </div>

            <div className="border rounded-md p-3">
              <h4 className="font-medium mb-2">Resumo Financeiro</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="font-medium">Custo Total:</span> {formatCurrency(totals.totalCost)}
                </div>
                <div>
                  <span className="font-medium">Venda Total:</span> {formatCurrency(totals.totalSale)}
                </div>
                <div>
                  <span className="font-medium">Lucro:</span> {formatCurrency(totals.profit)}
                </div>
                <div>
                  <span className="font-medium">Margem de Lucro:</span> {totals.profitMargin.toFixed(2)}%
                </div>
              </div>
            </div>

            <div className="border rounded-md p-3">
              <h4 className="font-medium mb-2">Produtos ({(form.getValues("products") || []).length})</h4>
              {(form.getValues("products") || []).length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-1">Partnumber</th>
                        <th className="text-left py-1">Descrição</th>
                        <th className="text-right py-1">Qtd</th>
                        <th className="text-right py-1">Custo Total</th>
                        <th className="text-right py-1">Venda Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(form.getValues("products") || []).slice(0, 3).map((product: any, index: number) => (
                        <tr key={index} className="border-b">
                          <td className="py-1">{product.partnumber}</td>
                          <td className="py-1">{product.description}</td>
                          <td className="text-right py-1">{product.quantity}</td>
                          <td className="text-right py-1">{formatCurrency(product.totalCost)}</td>
                          <td className="text-right py-1">{formatCurrency(product.totalSale)}</td>
                        </tr>
                      ))}
                      {(form.getValues("products") || []).length > 3 && (
                        <tr>
                          <td colSpan={5} className="py-1 text-center text-muted-foreground">
                            ... e mais {(form.getValues("products") || []).length - 3} produtos
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-muted-foreground">Nenhum produto adicionado</p>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 bg-muted/20 rounded-md">
          <h3 className="font-medium mb-2">Observações:</h3>
          <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
            <li>Todos os campos obrigatórios devem estar preenchidos para gerar os relatórios.</li>
            <li>O relatório PDF é ideal para impressão e compartilhamento.</li>
            <li>O relatório Excel permite análise e manipulação dos dados.</li>
            <li>A exportação JSON fornece os dados brutos para integração com outros sistemas.</li>
            <li>Você pode gerar os relatórios a qualquer momento, mesmo após o envio da transação.</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
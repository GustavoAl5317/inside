"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { useForm, type UseFormReturn } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Form } from "@/components/ui/form"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { BusinessTab } from "./form-tabs/business-tab"
import { NotesTab } from "./form-tabs/notes-tab"
import { SupplierGroupsTab } from "./form-tabs/supplier-groups-tab"
import { CustomersTab } from "./form-tabs/customers-tab"
import {
  createDealAction,
  saveDraftAction,
  sendApprovedProcessToOmieAction,
  updateDealPayloadAndStatusAction,
  clearTransactionLogsAction,
  requestUpdateApprovalAction,
  getActiveUpdateApprovalAction,
} from "@/lib/actions"
import { useCurrentUser } from "@/components/current-user-provider"
import { computeDealPayloadChanges, type PayloadChange } from "@/lib/deal-payload-diff"
import type { BitrixInsideSalesItem, CardDetails } from "@/lib/bitrix-service"
import type { FormMode } from "./inside-sales-layout"
import OmieLogsModal from "@/components/omie-logs-modal"
import { toast } from "sonner"
import { formatCNPJ, isCNPJComplete } from "@/lib/utils"
import { formatPaymentConditionLabel } from "@/lib/payment-condition-utils"
import {
  CheckCircle,
  AlertCircle,
  Loader2,
  ChevronRight,
  ChevronLeft,
  FileDown,
  Send,
  RefreshCw,
} from "lucide-react"

// ─── Schema ────────────────────────────────────────────────────────────────────
const companySchema = z.object({
  cnpj:              z.string().refine(isCNPJComplete, "CNPJ deve ter 14 dígitos"),
  name:              z.string().min(1),
  stateRegistration: z.string().optional(),
  zipCode:           z.string().optional(),
  city:              z.string().optional(),
  state:             z.string().optional(),
  neighborhood:      z.string().optional(),
  address:           z.string().optional(),
  number:            z.string().optional(),
  complement:        z.string().optional(),
  contactName:       z.string().optional(),
  phone:             z.string().optional(),
  email:             z.string().optional(),
})

const productSchema = z.object({
  id:          z.number(),
  partnumber:  z.string(),
  description: z.string(),
  cfop:        z.string().optional(),
  nature:      z.string().optional(),
  ncm:         z.string().optional(),
  family:      z.string().optional(),
  state:       z.string().default("SP"),
  quantity:    z.number().min(1),
  unitCost:    z.number().min(0),
  totalCost:   z.number(),
  unitSale:    z.number().min(0),
  totalSale:   z.number(),
})

const supplierGroupSchema = z.object({
  localId:  z.string(),
  branch:   z.enum(['barueri', 'es']).default('barueri'),
  supplier: companySchema,
  products: z.array(productSchema),
})

const productAllocationSchema = z.object({
  groupLocalId:  z.string(),
  productIndex:  z.number(),
  partnumber:    z.string(),
  description:   z.string(),
  quantity:      z.number().min(0),
})

const customerEntrySchema = z.object({
  localId:            z.string(),
  branch:             z.enum(['barueri', 'es']).default('barueri'),
  customer:           companySchema.extend({
    isTaxpayer:    z.boolean().optional(),
    purchaseOrder: z.string().optional(),
  }),
  productAllocations: z.array(productAllocationSchema),
})

/**
 * Serviço Interatell (natureza SRV): não passa por fornecedor — é vendido direto
 * ao cliente. Por isso o item é digitado na hora, sem custo e sem grupo de compra.
 * O código do serviço no Omie é fixo por natureza (SERVICO_MAP: SRV → SRV00001).
 */
const serviceItemSchema = z.object({
  localId:     z.string(),
  description: z.string().min(1, "Descrição do serviço é obrigatória"),
  quantity:    z.number().min(1),
  unitSale:    z.number().min(0),
  totalSale:   z.number(),
})

const serviceCustomerSchema = z.object({
  localId:  z.string(),
  branch:   z.enum(['barueri', 'es']).default('barueri'),
  customer: companySchema.extend({
    isTaxpayer:    z.boolean().optional(),
    purchaseOrder: z.string().optional(),
  }),
  items: z.array(serviceItemSchema).min(1, "Adicione pelo menos um serviço"),
})

const formSchema = z.object({
  bitrixDealId:   z.string().optional(),
  business: z.object({
    name:                     z.string().min(1, "Nome do negócio é obrigatório"),
    commercialProposal:       z.string().optional(),
    purchaseOrderDate:        z.string().min(1, "Data da OC é obrigatória"),
    deliveryDeadline:         z.string().min(1, "Prazo de entrega é obrigatório"),
    purchasePaymentCondition: z.string().min(1, "Condição de pagamento de compra é obrigatória"),
    expectedBillingDate:      z.string().min(1, "Data de previsão de faturamento é obrigatória"),
    salePaymentCondition:     z.string().min(1, "Condição de pagamento de venda é obrigatória"),
    hasInteratellService:     z.boolean().default(false),
  }),
  interatellBranches: z.array(z.enum(['barueri', 'es'])).min(1, "Selecione pelo menos uma filial Interatell"),
  supplierGroups: z.array(supplierGroupSchema).min(1, "Adicione pelo menos um fornecedor"),
  customers:      z.array(customerEntrySchema).min(1, "Adicione pelo menos um cliente"),
  serviceCustomers: z.array(serviceCustomerSchema).default([]),
  notes: z.object({
    internalNotes: z.string().optional(),
    externalNotes: z.string().optional(),
  }),
}).refine(
  v => !v.business.hasInteratellService || (v.serviceCustomers?.length ?? 0) > 0,
  { path: ['serviceCustomers'], message: 'Adicione pelo menos um cliente de serviço Interatell' },
)

type FormValues = z.infer<typeof formSchema>
// Tipo de entrada do schema (campos com .default() são opcionais antes do parse)
type FormInput = z.input<typeof formSchema>

function normalizeFormCNPJs(form: UseFormReturn<FormInput, any, FormValues>) {
  const fmt = (path: `supplierGroups.${number}.supplier.cnpj` | `customers.${number}.customer.cnpj`) => {
    const current = form.getValues(path)
    if (current) form.setValue(path, formatCNPJ(current))
  }
  form.getValues("supplierGroups")?.forEach((_, i) => fmt(`supplierGroups.${i}.supplier.cnpj`))
  form.getValues("customers")?.forEach((_, i) => fmt(`customers.${i}.customer.cnpj`))
}

// ─── Tabs ──────────────────────────────────────────────────────────────────────
const TABS = [
  { id: "business",   label: "Negócio" },
  { id: "suppliers",  label: "Fornecedores" },
  { id: "customers",  label: "Clientes" },
  { id: "notes",      label: "Observações" },
]

/** O step de serviço Interatell (SRV) só entra no fluxo se o negócio tiver serviço. */
function buildTabs(hasInteratellService: boolean) {
  if (!hasInteratellService) return TABS
  const i = TABS.findIndex(t => t.id === 'customers')
  return [
    ...TABS.slice(0, i + 1),
    { id: 'serviceCustomers', label: 'Cliente Serviço' },
    ...TABS.slice(i + 1),
  ]
}

type OmiePdfResumo = {
  oc?: Array<{ numero: string; fornecedor?: string }>
  ov?: Array<{ numero: string; cliente?: string }>
  os?: Array<{ numero: string; cliente?: string; nat?: string }>
}

const OMIE_ORDER_LABEL: Record<string, string> = {
  SW:  'Ordem de Serviço — Software (SW)',
  LC:  'Ordem de Serviço — Licença (LC)',
  ST:  'Ordem de Serviço — Serviço Terceiro (ST)',
  SRV: 'Ordem de Serviço — Serviço (SRV)',
}

// ─── PDF generation ────────────────────────────────────────────────────────────
async function generateDealPDF(values: FormInput, omieResumo?: OmiePdfResumo): Promise<void> {
  const { default: jsPDF }     = await import("jspdf")
  const { default: autoTable } = await import("jspdf-autotable")

  const doc    = new jsPDF({ format: "a4" })
  const PAGE_W = doc.internal.pageSize.getWidth()
  const PAGE_H = doc.internal.pageSize.getHeight()
  const ML = 14, MR = 14
  const CONTENT_W = PAGE_W - ML - MR
  const SAFE_BOTTOM = PAGE_H - 14
  let y = 12

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const cur = (v: number) =>
    `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`

  const checkY = (need: number) => {
    if (y + need > SAFE_BOTTOM) { doc.addPage(); y = 12 }
  }

  const addSection = (title: string) => {
    checkY(12)
    doc.setFontSize(8.5)
    doc.setFont("helvetica", "bold")
    doc.setTextColor(30, 64, 175)
    doc.text(title.toUpperCase(), ML, y)
    doc.setDrawColor(30, 64, 175)
    doc.setLineWidth(0.4)
    doc.line(ML, y + 1.2, PAGE_W - MR, y + 1.2)
    doc.setTextColor(0, 0, 0)
    y += 5.5
  }

  const addKV = (label: string, value: string) => {
    checkY(5.5)
    doc.setFontSize(7.5)
    doc.setFont("helvetica", "bold")
    doc.setTextColor(70, 70, 70)
    doc.text(label, ML, y)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(20, 20, 20)
    const val = doc.splitTextToSize(value || "—", CONTENT_W - 44)
    doc.text(val, ML + 44, y)
    doc.setTextColor(0, 0, 0)
    y += val.length > 1 ? val.length * 4 : 4.5
  }

  const entityH = (e: any): number => {
    if (!e) return 0
    const fields = [
      e.name, e.cnpj, e.stateRegistration,
      [e.address, e.number].filter(Boolean).join(", "),
      e.neighborhood,
      [e.city, e.state].filter(Boolean).join("/"),
      e.zipCode, e.contactName, e.phone, e.email,
    ]
    return fields.filter(Boolean).length * 4.5 + 3
  }

  const addEntity = (e: any, opts?: { alwaysContact?: boolean }) => {
    if (!e) return
    if (e.name)              addKV("Razão Social:",  e.name)
    if (e.cnpj)              addKV("CNPJ:",          e.cnpj)
    if (e.stateRegistration) addKV("IE:",            e.stateRegistration)
    const addr = [e.address, e.number].filter(Boolean).join(", ")
    if (addr)                addKV("Endereço:",      addr)
    if (e.neighborhood)      addKV("Bairro:",        e.neighborhood)
    const cs = [e.city, e.state].filter(Boolean).join("/")
    if (cs)                  addKV("Cidade/UF:",     cs)
    if (e.zipCode)           addKV("CEP:",           e.zipCode)
    if (e.contactName || opts?.alwaysContact) addKV("Contato:",   e.contactName || "—")
    if (e.phone || opts?.alwaysContact)       addKV("Telefone:",  e.phone || "—")
    if (e.email || opts?.alwaysContact)       addKV("E-mail:",    e.email || "—")
  }

  const renderTable = (
    startY: number,
    head: string[][],
    body: any[][],
    headColor: [number, number, number],
    altColor: [number, number, number],
    totalColor: [number, number, number],
  ) => {
    autoTable(doc, {
      startY,
      head,
      body,
      styles:             { fontSize: 7, cellPadding: 2, overflow: "linebreak" },
      headStyles:         { fillColor: headColor, textColor: 255, fontStyle: "bold", fontSize: 7 },
      alternateRowStyles: { fillColor: altColor },
      rowPageBreak:       "avoid",
      columnStyles: {
        0: { cellWidth: 28, fontStyle: "bold" },
        1: { cellWidth: "auto" },
        2: { cellWidth: 22, halign: "center" },
        3: { cellWidth: 14, halign: "center" },
        4: { cellWidth: 11, halign: "center" },
        5: { cellWidth: 27, halign: "right" },
        6: { cellWidth: 27, halign: "right" },
      },
      margin: { left: ML, right: MR },
    })
    return (doc as any).lastAutoTable.finalY as number
  }

  // ── Carregar logo ────────────────────────────────────────────────────────────
  let logoDataUrl: string | null = null
  try {
    const resp = await fetch("/logo-interatell.png")
    if (resp.ok) {
      const blob = await resp.blob()
      logoDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.onerror   = reject
        reader.readAsDataURL(blob)
      })
    }
  } catch { /* logo opcional */ }

  // ── Cabeçalho ───────────────────────────────────────────────────────────────
  // Caixa máxima do logo; a proporção real é preservada para não achatar.
  const LOGO_MAX_W = 65, LOGO_MAX_H = 28
  let LOGO_W = LOGO_MAX_W, LOGO_H = LOGO_MAX_H
  const logoY = y - 2
  if (logoDataUrl) {
    try {
      const props = doc.getImageProperties(logoDataUrl)
      const ratio = props.width / props.height
      // Ajusta dentro da caixa mantendo o aspect ratio (contain).
      LOGO_W = LOGO_MAX_W
      LOGO_H = LOGO_W / ratio
      if (LOGO_H > LOGO_MAX_H) {
        LOGO_H = LOGO_MAX_H
        LOGO_W = LOGO_H * ratio
      }
    } catch { /* usa a caixa padrão se não conseguir ler as dimensões */ }
    doc.addImage(logoDataUrl, "PNG", ML, logoY, LOGO_W, LOGO_H)
  }

  // título à direita do logo (centralizado na altura do logo)
  const titleX = logoDataUrl ? ML + LOGO_W + 8 : PAGE_W / 2
  const titleAlign = logoDataUrl ? "left" : "center"
  const titleMidY = logoDataUrl ? logoY + LOGO_H / 2 : y + 4
  doc.setFontSize(15)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(15, 23, 42)
  doc.text("ORDEM DE COMPRA", titleX, titleMidY - 1, { align: titleAlign })
  doc.setFontSize(8)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(100, 116, 139)
  doc.text(
    `Nº ${values.business?.commercialProposal || values.bitrixDealId || "—"}   ·   Emitido em ${new Date().toLocaleDateString("pt-BR")}`,
    titleX, titleMidY + 4, { align: titleAlign }
  )

  y += logoDataUrl ? LOGO_H + 2 : 14
  doc.setDrawColor(200, 200, 200)
  doc.setLineWidth(0.4)
  doc.line(ML, y, PAGE_W - MR, y)
  y += 5
  doc.setTextColor(0, 0, 0)

  // ── Empresa Emissora ────────────────────────────────────────────────────────
  addSection("Empresa Emissora")
  const branches = (values as any).interatellBranches as string[] | undefined
  if (branches?.length) {
    for (const branch of branches) {
      addEntity(INTERATELL_COMPANIES[branch === 'es' ? 'filial' : 'matriz'])
      y += 1.5
    }
  } else if ((values as any).interatell) {
    addEntity((values as any).interatell)
  }
  y += 2

  // ── Dados do Negócio ────────────────────────────────────────────────────────
  addSection("Dados do Negócio")
  addKV("Proposta nº:",      values.business?.commercialProposal || "—")
  addKV("Data OC:",          values.business?.purchaseOrderDate  || "—")
  addKV("Prazo de entrega:", values.business?.deliveryDeadline   || "—")
  addKV("Prev. faturamento:",values.business?.expectedBillingDate|| "—")
  addKV("Cond. compra:",     formatPaymentConditionLabel(values.business?.purchasePaymentCondition || "", "purchase"))
  addKV("Cond. venda:",      formatPaymentConditionLabel(values.business?.salePaymentCondition || "", "sale"))
  y += 2

  // ── Pedidos Omie ────────────────────────────────────────────────────────────
  const omieRows: any[][] = []
  for (const oc of omieResumo?.oc ?? [])
    if (oc.numero && oc.numero !== "?")
      omieRows.push(["Ordem de Compra (OC)", oc.numero, oc.fornecedor || "—"])
  for (const ov of omieResumo?.ov ?? [])
    if (ov.numero && ov.numero !== "?")
      omieRows.push(["Ordem de Venda (OV)", ov.numero, ov.cliente || "—"])
  for (const os of omieResumo?.os ?? [])
    if (os.numero && os.numero !== "?") {
      const tipo = os.nat ? (OMIE_ORDER_LABEL[os.nat] ?? `OS (${os.nat})`) : "Ordem de Serviço (OS)"
      omieRows.push([tipo, String(os.numero), os.cliente || "—"])
    }
  if (omieRows.length > 0) {
    checkY(omieRows.length * 7 + 18)
    addSection("Pedidos Gerados no Omie")
    autoTable(doc, {
      startY: y,
      head: [["Tipo", "Número Omie", "Fornecedor / Cliente"]],
      body: omieRows,
      styles:             { fontSize: 7.5, cellPadding: 2, overflow: "linebreak" },
      headStyles:         { fillColor: [5, 150, 105], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [236, 253, 245] },
      columnStyles:       { 1: { fontStyle: "bold", cellWidth: 32 } },
      rowPageBreak:       "avoid",
      margin:             { left: ML, right: MR },
    })
    y = (doc as any).lastAutoTable.finalY + 4
  }

  // ── Fornecedores e Produtos ─────────────────────────────────────────────────
  addSection("Fornecedores e Produtos")

  for (const [gi, group] of (values.supplierGroups || []).entries()) {
    const products: any[] = group.products || []
    const tableEstH = (products.length + 2) * 7 + 10
    const blockEstH = entityH(group.supplier) + 8 + tableEstH
    checkY(Math.min(blockEstH, SAFE_BOTTOM - 30))

    doc.setFontSize(8.5)
    doc.setFont("helvetica", "bold")
    doc.setTextColor(30, 64, 175)
    doc.text(`Fornecedor ${gi + 1}`, ML, y)
    doc.setTextColor(0, 0, 0)
    y += 4.5
    addEntity(group.supplier)
    y += 2

    if (products.length > 0) {
      const totalCusto = products.reduce((s: number, p: any) => s + Number(p.totalCost || 0), 0)
      const body: any[][] = [
        ...products.map((p: any) => [
          p.partnumber  || "—",
          p.description || "—",
          p.ncm         || "—",
          p.cfop        || "—",
          p.quantity,
          cur(Number(p.unitCost  || 0)),
          cur(Number(p.totalCost || 0)),
        ]),
        [
          { content: "", colSpan: 5 },
          { content: "TOTAL:", styles: { fontStyle: "bold", halign: "right" as const, fillColor: [225, 232, 255] as any } },
          { content: cur(totalCusto), styles: { fontStyle: "bold", halign: "right" as const, textColor: [30, 64, 175] as any, fillColor: [225, 232, 255] as any } },
        ],
      ]
      y = renderTable(
        y,
        [["Partnumber", "Descrição", "NCM", "CFOP", "Qtd", "Custo Unit.", "Total Custo"]],
        body,
        [30, 64, 175], [240, 245, 255], [30, 64, 175],
      ) + 4
    }

    if (gi < (values.supplierGroups || []).length - 1) y += 2
  }
  y += 1

  // ── Clientes ─────────────────────────────────────────────────────────────────
  addSection("Clientes")
  const supplierGroups: any[] = values.supplierGroups || []

  for (const [ci, entry] of (values.customers || []).entries()) {
    const allocated = (entry.productAllocations || []).filter((a: any) => Number(a.quantity) > 0)
    const tableEstH = (allocated.length + 2) * 7 + 10
    const blockEstH = entityH(entry.customer) + 8 + tableEstH
    checkY(Math.min(blockEstH, SAFE_BOTTOM - 30))

    doc.setFontSize(8.5)
    doc.setFont("helvetica", "bold")
    doc.setTextColor(109, 40, 217)
    doc.text(`Cliente ${ci + 1}`, ML, y)
    doc.setTextColor(0, 0, 0)
    y += 4.5
    addEntity(entry.customer, { alwaysContact: true })

    if (allocated.length > 0) {
      y += 2
      const totalVenda = allocated.reduce(
        (s: number, a: any) => s + Number(a.unitSale || 0) * Number(a.quantity || 0), 0
      )
      const body: any[][] = [
        ...allocated.map((a: any) => {
          const grp = supplierGroups.find((g: any) => g.localId === a.groupLocalId)
          const prod = grp?.products?.[a.productIndex]
          return [
            a.partnumber  || prod?.partnumber  || "—",
            a.description || prod?.description || "—",
            prod?.ncm  || "—",
            prod?.cfop || "—",
            a.quantity,
            cur(Number(a.unitSale || 0)),
            cur(Number(a.unitSale || 0) * Number(a.quantity || 0)),
          ]
        }),
        [
          { content: "", colSpan: 5 },
          { content: "TOTAL:", styles: { fontStyle: "bold", halign: "right" as const, fillColor: [237, 229, 255] as any } },
          { content: cur(totalVenda), styles: { fontStyle: "bold", halign: "right" as const, textColor: [109, 40, 217] as any, fillColor: [237, 229, 255] as any } },
        ],
      ]
      y = renderTable(
        y,
        [["Partnumber", "Descrição", "NCM", "CFOP", "Qtd", "Preço Venda Unit.", "Total Venda"]],
        body,
        [109, 40, 217], [245, 243, 255], [109, 40, 217],
      ) + 4
    }

    if (ci < (values.customers || []).length - 1) y += 2
  }

  // ── Observações ──────────────────────────────────────────────────────────────
  const extNotes = (values.notes?.externalNotes || "").trim()
  const intNotes = (values.notes?.internalNotes || "").trim()
  if (extNotes || intNotes) {
    checkY(16)
    addSection("Observações")
    const renderNote = (label: string, text: string) => {
      checkY(10)
      doc.setFontSize(7.5)
      doc.setFont("helvetica", "bold")
      doc.setTextColor(60, 60, 60)
      doc.text(label, ML, y)
      y += 3.5
      doc.setFont("helvetica", "normal")
      doc.setTextColor(30, 30, 30)
      const lines = doc.splitTextToSize(text, CONTENT_W)
      for (const line of lines) {
        checkY(4.5)
        doc.text(line, ML, y)
        y += 4
      }
      y += 1.5
    }
    if (extNotes) renderNote("Externa:", extNotes)
    if (intNotes) renderNote("Interna:", intNotes)
    doc.setTextColor(0, 0, 0)
  }

  // ── Rodapé em todas as páginas ───────────────────────────────────────────────
  const totalPages = (doc as any).internal.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    doc.setDrawColor(220, 220, 220)
    doc.setLineWidth(0.3)
    doc.line(ML, PAGE_H - 10, PAGE_W - MR, PAGE_H - 10)
    doc.setFontSize(6.5)
    doc.setTextColor(150, 150, 150)
    doc.setFont("helvetica", "normal")
    doc.text(
      `Interatell Integrações e Telecomunicações Ltda  ·  Página ${i} de ${totalPages}`,
      PAGE_W / 2, PAGE_H - 6, { align: "center" }
    )
  }

  const baseName = values.business?.commercialProposal || values.bitrixDealId || "rascunho"
  doc.save(omieResumo ? `ordem_compra_${baseName}_omie.pdf` : `ordem_compra_${baseName}.pdf`)
}

// ─── Componente principal ──────────────────────────────────────────────────────
interface MultiStepFormProps {
  selectedItem?:  BitrixInsideSalesItem | null
  cardDetails?:   CardDetails | null
  mode?:          FormMode
  existingDeal?:  { id: number; payload: any } | null
}

export function MultiStepForm({
  selectedItem,
  cardDetails,
  mode = 'omie',
  existingDeal,
}: MultiStepFormProps = {}) {
  const [activeTab, setActiveTab]   = useState("business")
  const [completedTabs, setCompleted] = useState<string[]>([])
  const [isSubmitting, setSubmitting]       = useState(false)
  const [isGeneratingPDF, setGeneratingPDF] = useState(false)
  const [dealId, setDealId]                 = useState<number | null>(null)
  const [submitError, setSubmitError]       = useState<string | null>(null)
  const [omieModalOpen, setOmieModalOpen]   = useState(false)
  const [omieTransactionId, setOmieTransactionId] = useState<number>(0)
  const [omieRunKey, setOmieRunKey] = useState(0)
  const [omieRunId, setOmieRunId] = useState<string>("")
  const [omieChanges, setOmieChanges] = useState<PayloadChange[]>([])
  const loadedDealIdRef = useRef<number | null>(null)

  const { user } = useCurrentUser()
  const [approval, setApproval] = useState<{ status?: string; review_note?: string; reviewed_by_name?: string } | null>(null)
  const [requestingApproval, setRequestingApproval] = useState(false)
  const [changeDescription, setChangeDescription] = useState('')
  const [justApproved, setJustApproved] = useState(false)

  const isUpdate = mode === 'update'
  const needsApproval = isUpdate && user?.role === 'insidesales'
  const approvalStatus = approval?.status
  const hasApproval = approvalStatus === 'approved'
  const pendingApproval = approvalStatus === 'pending'
  const updateBlocked = needsApproval && !hasApproval

  const loadApproval = async (dealId?: number) => {
    if (!isUpdate || !dealId) { setApproval(null); return }
    const r = await getActiveUpdateApprovalAction(dealId)
    if (r.success) setApproval(r.request as any)
  }

  useEffect(() => {
    if (!isUpdate) { setApproval(null); return }
    loadApproval(existingDeal?.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUpdate, existingDeal?.id])

  // Polling automático a cada 8s quando aguardando aprovação
  useEffect(() => {
    if (!pendingApproval || !existingDeal?.id) return
    const intervalId = setInterval(async () => {
      const r = await getActiveUpdateApprovalAction(existingDeal.id)
      if (r.success && r.request?.status === 'approved') {
        setApproval(r.request as any)
        setJustApproved(true)
        toast.success('Aprovação recebida! Você já pode atualizar no Omie.', { duration: 8000 })
        setTimeout(() => setJustApproved(false), 6000)
      }
    }, 8000)
    return () => clearInterval(intervalId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingApproval, existingDeal?.id])

  const handleRequestApproval = async () => {
    if (!existingDeal?.id) { toast.error('Nenhum deal selecionado.'); return }
    const desc = changeDescription.trim()
    if (desc.length < 10) {
      toast.error('Descreva o que está alterando (mínimo 10 caracteres).')
      return
    }
    setRequestingApproval(true)
    try {
      const vals = form.getValues()
      const context = [
        vals.business?.commercialProposal ? `Proposta: ${vals.business.commercialProposal}` : '',
        vals.business?.name               ? `Negócio: ${vals.business.name}`               : '',
        (vals.customers?.[0] as any)?.customer?.name ? `Cliente: ${(vals.customers[0] as any).customer.name}` : '',
      ].filter(Boolean).join(' · ') || undefined

      const r = await requestUpdateApprovalAction(existingDeal.id, desc, context)
      if (r.success) {
        toast.success(r.status === 'approved' ? 'Já existe uma aprovação vigente.' : 'Solicitação enviada ao financeiro!')
        await loadApproval(existingDeal.id)
      } else {
        toast.error(r.error || 'Erro ao solicitar aprovação.')
      }
    } finally {
      setRequestingApproval(false)
    }
  }

  const form = useForm<FormInput, any, FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      bitrixDealId: "",
      business: {
        name: "", commercialProposal: "",
        purchaseOrderDate: "", deliveryDeadline: "",
        purchasePaymentCondition: "", expectedBillingDate: "",
        salePaymentCondition: "",
      },
      interatellBranches: [] as ('barueri' | 'es')[],
      supplierGroups: [],
      customers:      [],
      notes: { internalNotes: "", externalNotes: "" },
    },
  })

  // Aviso nativo do browser ao tentar fechar/navegar com dados não salvos
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (form.formState.isDirty) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [form.formState.isDirty])

  // ── 1ª passada: campos básicos do card Bitrix ────────────────────────────
  useEffect(() => {
    if (!selectedItem) return
    const code = selectedItem.xmlId ? String(selectedItem.xmlId) : String(selectedItem.id)
    form.reset({
      bitrixDealId: code,
      business: {
        name: selectedItem.title || "", commercialProposal: code,
        purchaseOrderDate: "", deliveryDeadline: "",
        purchasePaymentCondition: "", expectedBillingDate: "",
        salePaymentCondition: "",
      },
      interatellBranches: [],
      supplierGroups: [],
      customers:      [],
      notes: { internalNotes: "", externalNotes: "" },
    })
    setActiveTab("business")
    setCompleted([])
    setDealId(null)
    setSubmitError(null)
  }, [selectedItem, form])

  // ── 2ª passada: dados detalhados (crm.item.get + empresa cliente) ────────
  useEffect(() => {
    if (!cardDetails) return
    const { item, clientCompany } = cardDetails
    if (item?.begindate) form.setValue("business.purchaseOrderDate", String(item.begindate).split("T")[0])
    if (item?.closedate) {
      const d = String(item.closedate).split("T")[0]
      form.setValue("business.deliveryDeadline", d)
      form.setValue("business.expectedBillingDate", d)
    }
    if (clientCompany?.name && !(form.getValues("customers") ?? []).length) {
      form.setValue("customers", [{
        localId: crypto.randomUUID(),
        branch: 'barueri' as const,
        customer: {
          cnpj:              clientCompany.cnpj ? formatCNPJ(clientCompany.cnpj) : "",
          name:              clientCompany.name,
          stateRegistration: clientCompany.stateRegistration || "",
          zipCode:           clientCompany.zipCode || "",
          city:              clientCompany.city || "",
          state:             clientCompany.state || "",
          neighborhood:      clientCompany.neighborhood || "",
          address:           clientCompany.address || "",
          number:            clientCompany.number || "",
          complement:        "",
          contactName:       "",
          phone:             clientCompany.phone || "",
          email:             clientCompany.email || "",
          isTaxpayer:        false,
          purchaseOrder:     "",
        },
        productAllocations: [],
      }])
    }
  }, [cardDetails, form])

  // ── 3ª passada: pré-preenche do deal existente (draft ou sent) ───────────
  // Só recarrega quando o ID do deal muda — evita voltar à 1ª aba a cada re-render
  useEffect(() => {
    const dealId = existingDeal?.id ?? null
    if (!existingDeal?.payload || dealId == null) {
      loadedDealIdRef.current = null
      return
    }
    if (loadedDealIdRef.current === dealId) return
    loadedDealIdRef.current = dealId

    const p = existingDeal.payload
    // Backward compat: old payloads store `interatell.cnpj` instead of `interatellBranches`
    let branches: ('barueri' | 'es')[] = p.interatellBranches || []
    if (!branches.length && p.interatell?.cnpj) {
      const cnpjDigits = String(p.interatell.cnpj).replace(/\D/g, '')
      branches = [cnpjDigits === INTERATELL_COMPANIES.filial.cnpj ? 'es' : 'barueri']
    }
    form.reset({
      bitrixDealId:       p.bitrixDealId   || "",
      business:           p.business       || form.getValues("business"),
      interatellBranches: branches,
      supplierGroups:     p.supplierGroups || [],
      customers:          p.customers      || [],
      notes:              p.notes          || { internalNotes: "", externalNotes: "" },
    })
    setActiveTab("business")
    setCompleted(mode === "update" ? tabs.map(t => t.id) : [])
    setDealId(dealId)
    setSubmitError(null)

    return () => { loadedDealIdRef.current = null }
  }, [existingDeal?.id, existingDeal?.payload, form, mode])

  const hasInteratellService = !!form.watch("business.hasInteratellService")
  const tabs = useMemo(() => buildTabs(hasInteratellService), [hasInteratellService])

  const currentIdx = tabs.findIndex(t => t.id === activeTab)

  const validateTab = async (tabId: string): Promise<boolean> => {
    if (tabId === "business") return form.trigger(["business", "interatellBranches"])
    if (tabId === "suppliers") {
      const groups = form.getValues("supplierGroups")
      if (!groups?.length) { toast.error("Adicione pelo menos um fornecedor com produtos."); return false }
      if (groups.some((g: any) => !g.products?.length)) {
        toast.error("Todos os grupos de fornecedores precisam ter pelo menos um produto."); return false
      }
      return true
    }
    if (tabId === "customers") {
      const customers = form.getValues("customers")
      if (!customers?.length) { toast.error("Adicione pelo menos um cliente."); return false }
      if (customers.some((c: any) => !c.productAllocations?.filter((a: any) => a.quantity > 0).length)) {
        toast.error("Todos os clientes precisam ter pelo menos um produto alocado."); return false
      }
      return true
    }
    return true
  }

  const handleNext = async () => {
    const ok = await validateTab(tabs[currentIdx].id)
    if (!ok) return
    if (!completedTabs.includes(tabs[currentIdx].id)) setCompleted(p => [...p, tabs[currentIdx].id])
    if (currentIdx < tabs.length - 1) setActiveTab(tabs[currentIdx + 1].id)
  }

  const handleBack = () => {
    if (currentIdx > 0) setActiveTab(tabs[currentIdx - 1].id)
  }

  // ── Baixar PDF (sem envio) ────────────────────────────────────────────────
  const handleDownloadPDF = async () => {
    setGeneratingPDF(true)
    try {
      normalizeFormCNPJs(form)
      await generateDealPDF(form.getValues())
      toast.success("PDF gerado com sucesso!")
    } catch (err: any) {
      toast.error("Erro ao gerar PDF: " + (err?.message || ""))
    } finally {
      setGeneratingPDF(false)
    }
  }

  // ── Submit principal ──────────────────────────────────────────────────────
  const handleSubmit = async () => {
    normalizeFormCNPJs(form)
    const ok = await form.trigger()
    if (!ok) {
      const errors = form.formState.errors
      const errorList: string[] = []
      const collect = (obj: any, path = "") => {
        if (!obj || typeof obj !== "object") return
        if (obj.message) { errorList.push(path ? `${path}: ${obj.message}` : obj.message); return }
        for (const key of Object.keys(obj)) collect(obj[key], path ? `${path}.${key}` : key)
      }
      collect(errors)
      const tabFieldMap: Record<string, string[]> = {
        business: ["business", "interatellBranches"], suppliers: ["supplierGroups"],
        customers: ["customers"],             notes: ["notes"],
      }
      const firstBadTab = tabs.find(t => (tabFieldMap[t.id] || []).some(f => (errors as any)[f]))
      if (firstBadTab && firstBadTab.id !== activeTab) setActiveTab(firstBadTab.id)
      toast.error(errorList[0] || "Corrija os erros antes de enviar.", {
        description: errorList.slice(1, 4).join(" · ") || undefined, duration: 8000,
      })
      return
    }

    setSubmitting(true)
    setSubmitError(null)

    try {
      const values = form.getValues()
      const payload = {
        bitrixDealId:       values.bitrixDealId || null,
        business:           values.business,
        interatellBranches: values.interatellBranches,
        supplierGroups:     values.supplierGroups,
        customers:          values.customers,
        notes:              values.notes || {},
      }
      if (mode === 'backlog') {
        const result = await saveDraftAction(values, existingDeal?.id ?? dealId ?? undefined)
        if (!result.success) {
          setSubmitError(result.error || "Erro ao salvar rascunho.")
          toast.error(result.error || "Erro ao salvar rascunho.")
          return
        }
        setDealId(result.dealId!)
        setCompleted(tabs.map(t => t.id))
        toast.success("Rascunho salvo! Gerando PDF...")
        try {
          await generateDealPDF(values)
          toast.success("PDF baixado com sucesso!")
        } catch (pdfErr: any) {
          toast.error("Rascunho salvo, mas houve erro ao gerar PDF: " + (pdfErr?.message || ""))
        }
        return
      }

      // ─ OMIE: envia ao Omie (carrega draft ou cria novo) ────────────────────
      if (mode === 'omie') {
        let dealIdToSend: number
        if (existingDeal) {
          const upd = await updateDealPayloadAndStatusAction(existingDeal.id, "approved", payload)
          if (!upd.success) { setSubmitError(upd.error || "Erro ao atualizar rascunho."); toast.error(upd.error || "Erro ao atualizar rascunho."); return }
          dealIdToSend = existingDeal.id
        } else {
          const result = await createDealAction({ ...values, status: "approved" })
          if (!result.success) { setSubmitError(result.error || "Erro ao criar deal."); toast.error(result.error || "Erro ao criar deal."); return }
          dealIdToSend = result.dealId!
        }
        setDealId(dealIdToSend)
        setCompleted(tabs.map(t => t.id))
        toast.success("Enviando para o Omie...")
        await clearTransactionLogsAction(dealIdToSend)
        const runId = crypto.randomUUID()
        setOmieRunId(runId)
        setOmieTransactionId(dealIdToSend)
        setOmieRunKey(k => k + 1)
        setOmieModalOpen(true)
        sendApprovedProcessToOmieAction(dealIdToSend, { runId })
          .then(async r => {
            if (!r.success) {
              toast.error(r.error || "Erro ao enviar ao Omie.")
              return
            }
            toast.success("Enviado ao Omie!")
          })
          .catch(() => toast.error("Erro inesperado ao enviar ao Omie."))
        return
      }

      // ─ UPDATE: atualiza deal existente no Omie ─────────────────────────────
      if (mode === 'update') {
        if (!existingDeal) {
          setSubmitError("Nenhum deal selecionado para atualizar.")
          toast.error("Nenhum deal selecionado para atualizar.")
          return
        }
        if (updateBlocked) {
          toast.error("Esta atualização precisa de aprovação do financeiro.")
          return
        }
        // Atualização sempre usa os códigos originais (OC-1-G0), nunca sufixo -R1
        const updatePayload = { ...payload } as any
        delete updatePayload._retryCount
        const payloadChanges = computeDealPayloadChanges(existingDeal.payload, updatePayload)
        setOmieChanges(payloadChanges)
        const upd = await updateDealPayloadAndStatusAction(existingDeal.id, "approved", updatePayload)
        if (!upd.success) { setSubmitError(upd.error || "Erro ao preparar atualização."); toast.error(upd.error || "Erro ao preparar atualização."); return }
        setCompleted(tabs.map(t => t.id))
        toast.success(payloadChanges.length
          ? `Reenviando ao Omie (${payloadChanges.length} alteração${payloadChanges.length > 1 ? 'ões' : ''})...`
          : "Reenviando ao Omie (sem alterações detectadas)...")
        await clearTransactionLogsAction(existingDeal.id)
        const runId = crypto.randomUUID()
        setOmieRunId(runId)
        setOmieTransactionId(existingDeal.id)
        setOmieRunKey(k => k + 1)
        setOmieModalOpen(true)
        sendApprovedProcessToOmieAction(existingDeal.id, { update: true, changes: payloadChanges, runId })
          .then(async r => {
            if (!r.success) {
              toast.error(r.error || "Erro ao atualizar no Omie.")
              return
            }
            toast.success("Pedidos atualizados no Omie!")
          })
          .catch(() => toast.error("Erro inesperado ao atualizar no Omie."))
        return
      }
    } catch (err: any) {
      const msg = err?.message || "Erro inesperado."
      setSubmitError(msg)
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const isLastTab = currentIdx === tabs.length - 1

  // ── Botão de submit ───────────────────────────────────────────────────────
  const SUBMIT_CONFIG = {
    backlog: { label: "Salvar e Gerar PDF", icon: FileDown,  cls: "bg-blue-600 hover:bg-blue-700"    },
    omie:    { label: "Enviar ao Omie",     icon: Send,      cls: "bg-purple-600 hover:bg-purple-700" },
    update:  { label: "Atualizar no Omie",  icon: RefreshCw, cls: "bg-emerald-600 hover:bg-emerald-700" },
  }
  const submitCfg = SUBMIT_CONFIG[mode]
  const SubmitIcon = submitCfg.icon

  return (
    <Form {...form}>
      <form onSubmit={e => e.preventDefault()} className="space-y-6">

        {/* Progress bar */}
        <div className="flex items-center gap-1">
          {tabs.map(tab => (
            <div key={tab.id} className={`h-1.5 flex-1 rounded-full transition-colors ${
              completedTabs.includes(tab.id) ? "bg-green-500"
              : tab.id === activeTab
                ? mode === 'backlog' ? "bg-blue-500"
                : mode === 'update'  ? "bg-emerald-500"
                : "bg-purple-500"
              : "bg-gray-200"
            }`} />
          ))}
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full grid grid-cols-4">
            {tabs.map(tab => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                disabled={!completedTabs.includes(tab.id) && tab.id !== activeTab}
                className="text-xs sm:text-sm"
              >
                {completedTabs.includes(tab.id) && tab.id !== activeTab && (
                  <CheckCircle className="w-3 h-3 mr-1 text-green-500" />
                )}
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="mt-6">
            <TabsContent value="business">
              <BusinessTab form={form} />
              <div className="mt-6 border-t pt-6">
                <h3 className="font-semibold mb-4 text-gray-700">Empresa Interatell</h3>
                <InteratellSection form={form} />
              </div>
            </TabsContent>
            <TabsContent value="suppliers"><SupplierGroupsTab form={form} /></TabsContent>
            <TabsContent value="customers"><CustomersTab form={form} /></TabsContent>
            <TabsContent value="notes"><NotesTab form={form} /></TabsContent>
          </div>
        </Tabs>

        {/* Error */}
        {submitError && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {submitError}
          </div>
        )}

        {/* Status de aprovação (modo atualização · insideSales) */}
        {needsApproval && (
          justApproved ? (
            <div
              className="relative overflow-hidden flex items-center gap-3 p-4 bg-emerald-500 text-white rounded-xl shadow-lg"
              style={{ animation: 'slideInBounce 0.5s cubic-bezier(0.34,1.56,0.64,1)' }}
            >
              <style>{`
                @keyframes slideInBounce {
                  from { opacity: 0; transform: scale(0.8) translateY(8px); }
                  to   { opacity: 1; transform: scale(1) translateY(0); }
                }
                @keyframes confetti { 0%,100%{transform:translateY(0) rotate(0)} 50%{transform:translateY(-6px) rotate(15deg)} }
              `}</style>
              <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0">
                <CheckCircle className="w-6 h-6 text-white" style={{ animation: 'confetti 0.6s ease-in-out 3' }} />
              </div>
              <div>
                <p className="font-bold text-base">Aprovação recebida!</p>
                <p className="text-sm text-emerald-100">
                  {approval?.reviewed_by_name ? `${approval.reviewed_by_name} aprovou.` : 'Financeiro aprovou.'} Clique em "Atualizar no Omie".
                </p>
              </div>
              <div className="absolute inset-0 pointer-events-none">
                {[...Array(8)].map((_, i) => (
                  <span key={i} className="absolute w-1.5 h-1.5 rounded-full bg-white/40"
                    style={{ left: `${10 + i * 12}%`, top: `${20 + (i % 3) * 20}%`, animation: `confetti ${0.4 + i * 0.1}s ease-in-out infinite` }} />
                ))}
              </div>
            </div>
          ) : hasApproval ? (
            <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-700 text-sm font-medium">
              <CheckCircle className="w-4 h-4 shrink-0 text-emerald-500" />
              <span>Atualização aprovada{approval?.reviewed_by_name ? ` por ${approval.reviewed_by_name}` : ' pelo financeiro'}. Você já pode reenviar ao Omie.</span>
            </div>
          ) : pendingApproval ? (
            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm">
              <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
              <span>Solicitação enviada. Aguardando aprovação do financeiro&hellip;</span>
              <span className="ml-auto text-[10px] text-amber-500 font-medium">verificando automaticamente</span>
            </div>
          ) : (
            <div className="space-y-2 p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-700 text-sm">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Para atualizar um pedido já gerado, descreva a alteração e solicite a aprovação do financeiro.</span>
              </div>
              <div className="space-y-1">
                <Label htmlFor="deal-change-description" className="text-xs font-semibold text-blue-800">
                  O que está alterando? <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="deal-change-description"
                  value={changeDescription}
                  onChange={e => setChangeDescription(e.target.value)}
                  placeholder="Ex.: Troquei fornecedor, ajustei quantidade do produto X, alterei condição de pagamento."
                  rows={3}
                  className="text-sm bg-white border-blue-200 focus-visible:ring-blue-300"
                />
                <p className="text-[10px] text-blue-600/80">Este texto vai junto com a solicitação para o financeiro.</p>
              </div>
            </div>
          )
        )}

        {/* Navigation + actions */}
        <div className="flex items-center justify-between pt-2 gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleBack}
            disabled={currentIdx === 0}
            className="shrink-0"
          >
            <ChevronLeft className="w-4 h-4 mr-1" /> Voltar
          </Button>

          <div className="flex items-center gap-2">
            {/* Botão PDF — sempre visível quando há deal existente ou na última tab */}
            {(existingDeal || isLastTab) && (
              <Button
                type="button"
                variant="outline"
                onClick={handleDownloadPDF}
                disabled={isGeneratingPDF}
                className="gap-1.5 text-blue-600 border-blue-200 hover:bg-blue-50 hover:border-blue-400"
              >
                {isGeneratingPDF
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Gerando...</>
                  : <><FileDown className="w-4 h-4" /> Baixar PDF</>
                }
              </Button>
            )}

            {isLastTab ? (
              updateBlocked ? (
                pendingApproval ? (
                  <Button type="button" disabled variant="outline" className="gap-1.5 text-amber-700 border-amber-300 bg-amber-50">
                    <Loader2 className="w-4 h-4 animate-spin" /> Aguardando aprovação do financeiro
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={handleRequestApproval}
                    disabled={requestingApproval || changeDescription.trim().length < 10}
                    className="gap-1.5 bg-amber-600 hover:bg-amber-700"
                  >
                    {requestingApproval
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Enviando...</>
                      : <><Send className="w-4 h-4" /> Solicitar aprovação</>
                    }
                  </Button>
                )
              ) : (
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className={`gap-1.5 ${submitCfg.cls}`}
                >
                  {isSubmitting
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Processando...</>
                    : <><SubmitIcon className="w-4 h-4" /> {submitCfg.label}</>
                  }
                </Button>
              )
            ) : (
              <Button type="button" onClick={handleNext}>
                Próximo <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </div>
        </div>

        {/* Sucesso backlog */}
        {dealId && mode === 'backlog' && (
          <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
            <CheckCircle className="w-8 h-8 text-blue-500 shrink-0" />
            <div>
              <p className="font-semibold text-blue-800">Rascunho salvo com sucesso!</p>
              <p className="text-sm text-blue-600">Deal #{dealId} · PDF gerado e baixado automaticamente</p>
            </div>
          </div>
        )}
      </form>

      <OmieLogsModal
        open={omieModalOpen}
        onOpenChange={setOmieModalOpen}
        transactionId={omieTransactionId}
        runKey={omieRunKey}
        runId={omieRunId}
        changes={omieChanges}
        showChangesPanel={mode === 'update'}
      />
    </Form>
  )
}

// ─── Empresas Interatell ────────────────────────────────────────────────────────
const INTERATELL_COMPANIES: Record<string, {
  cnpj: string; name: string; stateRegistration: string
  zipCode: string; city: string; state: string
  neighborhood: string; address: string; number: string; complement: string
}> = {
  matriz: {
    cnpj: "03969530000130",
    name: "Interatell Integrações e Telecomunicações Ltda",
    stateRegistration: "206.122.484.113",
    zipCode: "06472001", city: "Barueri", state: "SP",
    neighborhood: "", address: "Avenida Copacabana",
    number: "190", complement: "Empresarial Dezoito do Forte",
  },
  filial: {
    cnpj: "03969530000211",
    name: "Interatell Integrações e Telecomunicações Ltda – FILIAL",
    stateRegistration: "",
    zipCode: "29175706", city: "Serra", state: "ES",
    neighborhood: "Nova Zelândia", address: "Rua Porto Alegre",
    number: "307", complement: "Galpão 02 Módulo 02B",
  },
}

function InteratellSection({ form }: { form: any }) {
  const branches: string[] = form.watch("interatellBranches") || []

  const toggleBranch = (key: 'barueri' | 'es') => {
    const current: string[] = form.getValues("interatellBranches") || []
    const next = current.includes(key) ? current.filter(b => b !== key) : [...current, key]
    form.setValue("interatellBranches", next, { shouldValidate: true })
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">Selecione uma ou ambas as filiais para este negócio.</p>
      <div className="flex flex-col gap-2">
        {(["barueri", "es"] as const).map(key => {
          const c = INTERATELL_COMPANIES[key === 'es' ? 'filial' : 'matriz']
          const checked = branches.includes(key)
          return (
            <label
              key={key}
              className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                checked ? "bg-blue-50 border-blue-300" : "hover:bg-gray-50 border-gray-200"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleBranch(key)}
                className="mt-0.5 w-4 h-4 accent-blue-600 shrink-0"
              />
              <div>
                <p className="font-medium text-sm">
                  {key === 'barueri' ? "Interatell — Matriz (Barueri, SP)" : "Interatell — Filial (Serra, ES)"}
                </p>
                <p className="text-xs text-gray-500">
                  CNPJ: {c.cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5")} · {c.address}, {c.number} — {c.city}/{c.state}
                </p>
              </div>
            </label>
          )
        })}
      </div>
    </div>
  )
}

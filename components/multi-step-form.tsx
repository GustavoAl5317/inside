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
import { generateDealPDFs } from "@/lib/generate-pdf"
import { ServiceCustomersTab } from "./form-tabs/service-customers-tab"
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

// A geração de PDF vive em lib/generate-pdf.ts (um arquivo por documento).

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
      serviceCustomers: [],
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
      serviceCustomers: [],
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
      supplierGroups:     p.supplierGroups   || [],
      customers:          p.customers        || [],
      serviceCustomers:   p.serviceCustomers || [],
      notes:              p.notes            || { internalNotes: "", externalNotes: "" },
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
    if (tabId === "serviceCustomers") {
      const svc = form.getValues("serviceCustomers")
      if (!svc?.length) { toast.error("Adicione pelo menos um cliente de serviço Interatell."); return false }
      if (svc.some((s: any) => !s.items?.length)) {
        toast.error("Todos os clientes de serviço precisam ter pelo menos um serviço."); return false
      }
      if (svc.some((s: any) => s.items.some((i: any) => !String(i.description ?? '').trim()))) {
        toast.error("Descreva todos os serviços adicionados."); return false
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
      const n = await generateDealPDFs(form.getValues())
      toast.success(n > 1 ? `${n} PDFs gerados (um por documento)!` : "PDF gerado com sucesso!")
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
        serviceCustomers: ["serviceCustomers"],
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
        serviceCustomers:   values.serviceCustomers ?? [],
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
        toast.success("Rascunho salvo! Gerando PDFs...")
        try {
          const n = await generateDealPDFs(values)
          toast.success(n > 1 ? `${n} PDFs baixados (um por documento)!` : "PDF baixado com sucesso!")
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
            {hasInteratellService && (
              <TabsContent value="serviceCustomers"><ServiceCustomersTab form={form} /></TabsContent>
            )}
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

"use client"

import { useState, useEffect, useRef, useCallback, useMemo, type SyntheticEvent } from "react"
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
import { OcNumbersTab } from "./form-tabs/oc-numbers-tab"
import { SupplierGroupsTab } from "./form-tabs/supplier-groups-tab"
import { CustomersTab } from "./form-tabs/customers-tab"
import { downloadOcExcels } from "@/lib/download-oc-excel"
import { INTERATELL_COMPANIES } from "@/lib/interatell-companies"
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
import { formatCNPJ, isCNPJComplete, codigoProduto } from "@/lib/utils"
import { formatPaymentConditionLabel } from "@/lib/payment-condition-utils"
import { faltaNoCliente, resumoPendencias } from "@/lib/dados-obrigatorios"
import {
  CheckCircle,
  AlertCircle,
  Loader2,
  ChevronRight,
  ChevronLeft,
  FileSpreadsheet,
  Save,
  Send,
  RefreshCw,
  Lock,
} from "lucide-react"

// ─── Schema ────────────────────────────────────────────────────────────────────
const companySchema = z.object({
  // ID da empresa no CRM do Bitrix, quando ela veio de lá. Serve para abrir a
  // ficha no Bitrix a partir do card do cliente.
  bitrixCompanyId:   z.number().optional(),
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
  // SKU do catalogo (PROPERTY_503 no Bitrix). E o identificador principal
  // exibido; partnumber e description continuam como estao.
  sku:         z.string().optional(),
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
  // Frete da compra, ligado pelo botão "Adicionar Frete?" no card do fornecedor.
  // Vai para o Omie em frete_upsert.nValFrete do Pedido de Compra.
  hasFreight:   z.boolean().default(false),
  freightValue: z.number().min(0).default(0),
  // Prazo de entrega por fornecedor: cada compra chega numa data. Era um campo
  // só do negócio, e com vários fornecedores a data de um valia para todos.
  deliveryDeadline: z.string().default(""),
  // Condição de pagamento da compra deste fornecedor. Vazia cai na do negócio,
  // que serve de padrão — cada fornecedor negocia o seu prazo.
  purchasePaymentCondition: z.string().default(""),
  supplier: companySchema,
  products: z.array(productSchema),
  // Número de Ordem de Compra desta OC na lista #35 do Bitrix, ex. "9178/26".
  ocNumber:    z.string().optional(),
  ocElementId: z.number().optional(),
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
    // Contato é obrigatório no cliente (e só nele): a OC precisa de alguém
    // nomeado do lado do cliente. No fornecedor segue opcional.
    contactName:   z.string().trim().min(1, "Informe o nome do contato do cliente"),
    isTaxpayer:    z.boolean().optional(),
    purchaseOrder: z.string().optional(),
  }),
  productAllocations: z.array(productAllocationSchema),
  // Condicao de pagamento da venda para este cliente. Saiu da aba Negocio: cada
  // cliente pode ter um prazo, e a OV/OS dele vai com ele.
  salePaymentCondition: z.string().optional(),
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
  salePaymentCondition: z.string().optional(),
  // Número de Ordem de Compra da OS de serviço Interatell (lista #35 do Bitrix).
  ocNumber:    z.string().optional(),
  ocElementId: z.number().optional(),
})

const formSchema = z.object({
  bitrixDealId:   z.string().optional(),
  business: z.object({
    name:                     z.string().min(1, "Nome do negócio é obrigatório"),
    commercialProposal:       z.string().optional(),
    purchaseOrderDate:        z.string().min(1, "Data da OC é obrigatória"),
    // Derivado: o prazo saiu da etapa Negócio e passou a ser por fornecedor.
    // Aqui fica o mais distante entre eles — a entrega só fecha quando o último
    // item chega. Mantido no payload porque PDF, relatório, histórico e o diff
    // leem este campo, e é a data de previsão da OV e da OS.
    deliveryDeadline:         z.string().default(""),
    // Obrigatória só quando há compra: negócio só de serviço Interatell não tem
    // fornecedor. A regra fica no superRefine do formSchema.
    purchasePaymentCondition: z.string().default(""),
    // Obrigatórias só quando há venda: compra para estoque não tem. A regra
    // fica no superRefine, como a condição de compra.
    expectedBillingDate:      z.string().default(""),
    salePaymentCondition:     z.string().default(""),
    hasInteratellService:     z.boolean().default(false),
    // Negócio só de serviço Interatell: sem fornecedor, sem produto, sem OC/OV.
    // Vai direto ao cliente do serviço e gera uma OS.
    onlyInteratellService:    z.boolean().default(false),
  }),
  // Derivado das filiais dos grupos de fornecedor ("Faturamento via"), nao mais
  // escolhido a mao na etapa Negocio. Mantido no payload porque PDF, diff e o
  // envio ao Omie leem esse campo.
  interatellBranches: z.array(z.enum(['barueri', 'es'])).default([]),
  // O mínimo de um fornecedor e um cliente fica no superRefine: não vale para
  // negócio só de serviço Interatell.
  supplierGroups: z.array(supplierGroupSchema),
  customers:      z.array(customerEntrySchema),
  serviceCustomers: z.array(serviceCustomerSchema).default([]),
  notes: z.object({
    internalNotes: z.string().optional(),
    externalNotes: z.string().optional(),
  }),
}).superRefine((v, ctx) => {
  const semServico = !(v.serviceCustomers?.length ?? 0)
  const msgServico = 'Adicione pelo menos um cliente de serviço Interatell'
  // A condição de venda é de cada cliente; aqui fica só o que é do negócio.
  // Sempre há venda: produto comprado e não alocado simplesmente não entra na
  // OV, mas o negócio continua tendo cliente e previsão de faturamento.
  const exigeVenda = () => {
    if (!String(v.business.expectedBillingDate ?? '').trim()) {
      ctx.addIssue({
        code: "custom", path: ['business', 'expectedBillingDate'],
        message: 'Previsão de faturamento é obrigatória',
      })
    }
  }

  ;(v.serviceCustomers ?? []).forEach((c, i) => {
    if (!String(c.salePaymentCondition || v.business.salePaymentCondition || '').trim()) {
      ctx.addIssue({
        code: "custom", path: ['serviceCustomers', i, 'salePaymentCondition'],
        message: 'Informe a condição de pagamento de venda deste cliente de serviço',
      })
    }
  })

  if (v.business.onlyInteratellService) {
    if (semServico) ctx.addIssue({ code: "custom", path: ['serviceCustomers'], message: msgServico })
    exigeVenda()
    return
  }

  if (!v.supplierGroups.length) {
    ctx.addIssue({ code: "custom", path: ['supplierGroups'], message: 'Adicione pelo menos um fornecedor' })
  }
  v.supplierGroups.forEach((g, i) => {
    // Sem família o Omie cadastra o produto sem classificação, e o pedido sai
    // errado para o financeiro. Vale para todos: licença, software e serviço
    // também têm família própria.
    g.products.forEach((p, j) => {
      if (!String(p.family ?? '').trim()) {
        ctx.addIssue({
          code: "custom", path: ['supplierGroups', i, 'products', j, 'family'],
          message: 'Informe a família Omie deste produto',
        })
      }
    })
    if (!String(g.purchasePaymentCondition || v.business.purchasePaymentCondition || '').trim()) {
      ctx.addIssue({
        code: "custom", path: ['supplierGroups', i, 'purchasePaymentCondition'],
        message: 'Informe a condição de pagamento de compra deste fornecedor',
      })
    }
  })
  v.customers.forEach((c, i) => {
    if (!String(c.salePaymentCondition || v.business.salePaymentCondition || '').trim()) {
      ctx.addIssue({
        code: "custom", path: ['customers', i, 'salePaymentCondition'],
        message: 'Informe a condição de pagamento de venda deste cliente',
      })
    }
  })

  if (!v.customers.length) {
    ctx.addIssue({ code: "custom", path: ['customers'], message: 'Adicione pelo menos um cliente' })
  }
  exigeVenda()
  if (v.business.hasInteratellService && semServico) {
    ctx.addIssue({ code: "custom", path: ['serviceCustomers'], message: msgServico })
  }
})

type FormValues = z.infer<typeof formSchema>
// Tipo de entrada do schema (campos com .default() são opcionais antes do parse)
type FormInput = z.input<typeof formSchema>

/**
 * Descarta alocações que apontam para produto ou fornecedor que não existe mais.
 *
 * A exclusão na aba de fornecedores já reindexa as alocações, mas rascunhos
 * gravados antes disso ficaram com referências órfãs — e como a alocação aponta
 * o produto por índice, uma órfã acaba resolvendo para o produto errado no
 * envio ao Omie. A limpeza roda a cada gravação.
 */
function pruneAllocations(values: any) {
  const groups: any[] = values?.supplierGroups ?? []
  for (const entry of (values?.customers ?? [])) {
    const allocs: any[] = entry?.productAllocations ?? []
    entry.productAllocations = allocs.filter(a => {
      const g = groups.find(x => x?.localId === a?.groupLocalId)
      return !!g?.products?.[a?.productIndex]
    })
  }
}

/** Filiais efetivamente usadas, a partir do "Faturamento via" de cada fornecedor. */
function deriveBranches(groups: any[] | undefined): ('barueri' | 'es')[] {
  const set = new Set<'barueri' | 'es'>()
  for (const g of groups ?? []) set.add(g?.branch === 'es' ? 'es' : 'barueri')
  return [...set]
}

/**
 * Prazo de entrega do negócio a partir dos prazos dos fornecedores: o mais
 * distante. A entrega do negócio só fecha quando o último fornecedor entrega,
 * e é essa data que vai como previsão na OV e na OS, que juntam itens de
 * fornecedores diferentes. Sem fornecedor com prazo, cai na previsão de
 * faturamento (negócio só de serviço Interatell não tem compra).
 */
function deriveDeliveryDeadline(groups: any[] | undefined, fallback: string): string {
  // Datas em ISO (aaaa-mm-dd) ordenam como texto.
  const datas = (groups ?? []).map(g => String(g?.deliveryDeadline ?? '').trim()).filter(Boolean)
  if (!datas.length) return String(fallback ?? '')
  return datas.reduce((maior, d) => (d > maior ? d : maior))
}

/**
 * Payload do deal a partir dos valores do formulário, no mesmo formato que o
 * envio grava. Serve ao diff da atualização e à planilha baixada da tela.
 *
 * Trabalha sobre uma cópia: o handleSubmit aplica as mesmas derivações mutando
 * `values`, e o botão de baixar planilha não pode mexer no que está na tela.
 */
function payloadDosValores(values: any) {
  const v = structuredClone(values)
  if (v.business?.onlyInteratellService) {
    v.supplierGroups = []
    v.customers = []
    v.interatellBranches = ['barueri']
  } else {
    v.interatellBranches = deriveBranches(v.supplierGroups)
  }
  // Cliente Serviço pré-carregado fica para trás se o serviço for desmarcado.
  if (!v.business?.onlyInteratellService && !v.business?.hasInteratellService) v.serviceCustomers = []
  if (v.business) {
    v.business.deliveryDeadline = deriveDeliveryDeadline(
      v.supplierGroups, v.business.expectedBillingDate,
    )
  }
  pruneAllocations(v)
  return {
    bitrixDealId:       v.bitrixDealId || null,
    business:           v.business,
    interatellBranches: v.interatellBranches,
    supplierGroups:     v.supplierGroups,
    customers:          v.customers,
    serviceCustomers:   v.serviceCustomers ?? [],
    notes:              v.notes || {},
  }
}

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
  { id: "suppliers",  label: "Fornecedores/Produtos" },
  { id: "customers",  label: "Clientes" },
  { id: "notes",      label: "Observações" },
  { id: "ocNumbers",  label: "Nº Ordem de Compra" },
]

/**
 * O step de serviço Interatell (SRV) só entra no fluxo se o negócio tiver serviço.
 * Negócio só de serviço pula Fornecedores/Produtos e Clientes: não há compra nem
 * produto, só o cliente que recebe o serviço.
 */
function buildTabs(hasInteratellService: boolean, onlyInteratellService = false) {
  if (onlyInteratellService) {
    return [
      TABS.find(t => t.id === 'business')!,
      { id: 'serviceCustomers', label: 'Cliente Serviço' },
      TABS.find(t => t.id === 'notes')!,
      TABS.find(t => t.id === 'ocNumbers')!,
    ]
  }
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
  const loadedItemCodeRef = useRef<string | null>(null)

  const { user } = useCurrentUser()
  const [approval, setApproval] = useState<{ status?: string; review_note?: string; reviewed_by_name?: string } | null>(null)
  const [requestingApproval, setRequestingApproval] = useState(false)
  const [changeDescription, setChangeDescription] = useState('')
  const [justApproved, setJustApproved] = useState(false)

  const isUpdate = mode === 'update'
  // Etapa 6 do Bitrix (Processamento no Omie): só conferir e enviar, nada se
  // edita. O que precisar mudar volta para o Backlog.
  const travado = mode === 'omie'
  const ultimoAvisoTrava = useRef(0)
  const barraEdicao = (e: SyntheticEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const agora = Date.now()
    if (agora - ultimoAvisoTrava.current < 3000) return
    ultimoAvisoTrava.current = agora
    toast.warning("Edição bloqueada na etapa 6 (Processamento no Omie).", {
      description: "Para alterar, devolva o card ao Backlog no Bitrix.",
      duration: 5000,
    })
  }
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
    if (!selectedItem) { loadedItemCodeRef.current = null; return }
    const code = selectedItem.xmlId ? String(selectedItem.xmlId) : String(selectedItem.id)
    // Só reinicia o formulário quando o card muda de fato. Sem esta trava,
    // qualquer re-render que trocasse a identidade de selectedItem — salvar o
    // rascunho, por exemplo — disparava o reset e zerava tudo. Os demais campos
    // voltavam pelas passadas seguintes; as condições de pagamento, que só vêm
    // do rascunho, não voltavam, e era isso que sumia depois de salvar.
    if (loadedItemCodeRef.current === code) return
    loadedItemCodeRef.current = code
    form.reset({
      bitrixDealId: code,
      business: {
        name: selectedItem.title || "", commercialProposal: code,
        purchaseOrderDate: new Date().toISOString().slice(0, 10), deliveryDeadline: "",
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
    // Data da Criação da OC sempre inicia com o dia atual (não a data do card Bitrix).
    form.setValue("business.purchaseOrderDate", new Date().toISOString().slice(0, 10))
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
          bitrixCompanyId:   Number(clientCompany.id) || undefined,
          cnpj:              clientCompany.cnpj ? formatCNPJ(clientCompany.cnpj) : "",
          name:              clientCompany.name,
          stateRegistration: clientCompany.stateRegistration || "",
          zipCode:           clientCompany.zipCode || "",
          city:              clientCompany.city || "",
          state:             clientCompany.state || "",
          neighborhood:      clientCompany.neighborhood || "",
          address:           clientCompany.address || "",
          number:            clientCompany.number || "",
          complement:        clientCompany.complement || "",
          contactName:       clientCompany.contactName || "",
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
  const onlyInteratellService = !!form.watch("business.onlyInteratellService")
  const tabs = useMemo(
    () => buildTabs(hasInteratellService, onlyInteratellService),
    [hasInteratellService, onlyInteratellService],
  )

  // Com serviço Interatell, o Cliente Serviço já começa com a empresa do card,
  // igual ao passo Clientes: é quase sempre o mesmo cliente. Vem do cliente
  // pré-carregado em Clientes e, na falta dele, direto da empresa do card.
  useEffect(() => {
    if (!onlyInteratellService && !hasInteratellService) return
    if ((form.getValues("serviceCustomers") ?? []).length) return
    const empresa = cardDetails?.clientCompany
    const origem = (form.getValues("customers") ?? [])[0]?.customer
      ?? (empresa?.name ? {
        bitrixCompanyId:   Number(empresa.id) || undefined,
        cnpj:              empresa.cnpj ? formatCNPJ(empresa.cnpj) : "",
        name:              empresa.name,
        stateRegistration: empresa.stateRegistration || "",
        zipCode:           empresa.zipCode || "",
        city:              empresa.city || "",
        state:             empresa.state || "",
        neighborhood:      empresa.neighborhood || "",
        address:           empresa.address || "",
        number:            empresa.number || "",
        complement:        empresa.complement || "",
        contactName:       empresa.contactName || "",
        phone:             empresa.phone || "",
        email:             empresa.email || "",
        isTaxpayer:        false,
        purchaseOrder:     "",
      } : null)
    if (!origem?.name) return
    form.setValue("serviceCustomers", [{
      localId: crypto.randomUUID(), branch: 'barueri', customer: { ...origem }, items: [],
    }])
  }, [onlyInteratellService, hasInteratellService, cardDetails, form])

  const currentIdx = tabs.findIndex(t => t.id === activeTab)

  const validateTab = async (tabId: string): Promise<boolean> => {
    if (tabId === "business") {
      if (!(await form.trigger(["business"]))) return false
      // A condição de compra saiu do schema base (negócio só de serviço não tem
      // compra); sem esta checagem o campo vazio só apareceria no envio final.
      const b = form.getValues("business")
      return true
    }
    if (tabId === "suppliers") {
      const groups = form.getValues("supplierGroups")
      if (!groups?.length) { toast.error("Adicione pelo menos um fornecedor com produtos."); return false }
      if (groups.some((g: any) => !g.products?.length)) {
        toast.error("Todos os grupos de fornecedores precisam ter pelo menos um produto."); return false
      }
      const semFamilia = groups.flatMap((g: any) =>
        (g.products ?? [])
          .filter((p: any) => !String(p.family ?? '').trim())
          .map((p: any) => `${g.supplier?.name || 'Fornecedor sem nome'}: ${codigoProduto(p) || p.description || 'produto sem código'}`),
      )
      if (semFamilia.length) {
        toast.error("Informe a família Omie antes de prosseguir.", {
          description: semFamilia.join(' · '), duration: 10000,
        })
        return false
      }
      const reservaCompra = form.getValues("business.purchasePaymentCondition")
      const semCondicaoCompra = groups
        .filter((g: any) => !String(g.purchasePaymentCondition || reservaCompra || '').trim())
        .map((g: any) => g.supplier?.name || 'Fornecedor sem nome')
      if (semCondicaoCompra.length) {
        toast.error("Informe a condição de pagamento de compra antes de prosseguir.", {
          description: semCondicaoCompra.join(' · '), duration: 8000,
        })
        return false
      }
      // O prazo é por fornecedor e vai como dDtPrevisao da OC dele.
      const semPrazo = groups
        .map((g: any, i: number) => (!String(g.deliveryDeadline ?? '').trim() ? (g.supplier?.name || `Fornecedor ${i + 1}`) : ''))
        .filter(Boolean)
      if (semPrazo.length) {
        toast.error(
          semPrazo.length === 1
            ? `Informe o prazo de entrega de ${semPrazo[0]}.`
            : `Informe o prazo de entrega de: ${semPrazo.join(', ')}.`,
        )
        return false
      }
      return true
    }
    if (tabId === "customers") {
      const customers = form.getValues("customers")
      if (!customers?.length) { toast.error("Adicione pelo menos um cliente."); return false }
      if (customers.some((c: any) => !c.productAllocations?.filter((a: any) => a.quantity > 0).length)) {
        toast.error("Todos os clientes precisam ter pelo menos um produto alocado."); return false
      }
      // O Omie recusa o envio no meio quando falta CNPJ, cidade, UF ou contato —
      // cliente sem UF faz a OS cair com "Cidade não cadastrada", depois de a OC
      // já ter sido criada. A conferência fica aqui, antes de prosseguir.
      const pendencias = resumoPendencias(
        customers.map((c: any) => ({ nome: c.customer?.name, faltando: faltaNoCliente(c.customer) })),
      )
      if (pendencias) {
        toast.error("Corrija o cadastro do cliente antes de prosseguir.", {
          description: `${pendencias}. Use o botão Atualizar para buscar no Bitrix, ou o link Bitrix para corrigir lá.`,
          duration: 12000,
        })
        return false
      }
      const reservaVenda = form.getValues("business.salePaymentCondition")
      const semCondicaoVenda = customers
        .filter((c: any) => !String(c.salePaymentCondition || reservaVenda || '').trim())
        .map((c: any) => c.customer?.name || 'Cliente sem nome')
      if (semCondicaoVenda.length) {
        toast.error("Informe a condição de pagamento de venda antes de prosseguir.", {
          description: semCondicaoVenda.join(' · '), duration: 8000,
        })
        return false
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
      const pendenciasSvc = resumoPendencias(
        svc.map((c: any) => ({ nome: c.customer?.name, faltando: faltaNoCliente(c.customer) })),
      )
      if (pendenciasSvc) {
        toast.error("Corrija o cadastro do cliente de serviço antes de prosseguir.", {
          description: `${pendenciasSvc}. Use o botão Atualizar para buscar no Bitrix, ou o link Bitrix para corrigir lá.`,
          duration: 12000,
        })
        return false
      }
      const reservaSvc = form.getValues("business.salePaymentCondition")
      const semCondicaoSvc = svc
        .filter((c: any) => !String(c.salePaymentCondition || reservaSvc || '').trim())
        .map((c: any) => c.customer?.name || 'Cliente sem nome')
      if (semCondicaoSvc.length) {
        toast.error("Informe a condição de pagamento de venda antes de prosseguir.", {
          description: semCondicaoSvc.join(' · '), duration: 8000,
        })
        return false
      }
      return true
    }
    return true
  }

  /**
   * Grava o rascunho com o que já está preenchido.
   *
   * Antes o rascunho só nascia no botão final: quem parava no meio perdia tudo.
   * Agora salva a cada avanço de etapa e no botão "Salvar rascunho", que não
   * exige o formulário completo — saveDraftAction só guarda o JSON.
   *
   * Só no Backlog: em Processamento e Atualização o deal já existe e tem status
   * próprio, e gravar como 'pending' por cima desfaria o envio.
   */
  const salvarRascunho = async (silencioso = true): Promise<boolean> => {
    if (mode !== 'backlog') return true
    try {
      const payload = payloadDosValores(form.getValues())
      const r = await saveDraftAction(payload as any, existingDeal?.id ?? dealId ?? undefined)
      if (!r.success) {
        if (!silencioso) toast.error(r.error || "Erro ao salvar rascunho.")
        return false
      }
      if (r.dealId) setDealId(r.dealId)
      if (!silencioso) toast.success("Rascunho salvo!")
      return true
    } catch (err: any) {
      if (!silencioso) toast.error("Erro ao salvar rascunho: " + (err?.message || ""))
      return false
    }
  }

  const [salvandoRascunho, setSalvandoRascunho] = useState(false)
  const handleSalvarRascunho = async () => {
    setSalvandoRascunho(true)
    try { await salvarRascunho(false) } finally { setSalvandoRascunho(false) }
  }

  const handleNext = async () => {
    const ok = await validateTab(tabs[currentIdx].id)
    if (!ok) return
    if (!completedTabs.includes(tabs[currentIdx].id)) setCompleted(p => [...p, tabs[currentIdx].id])
    // Grava antes de trocar de aba: avançou, está salvo.
    await salvarRascunho()
    if (currentIdx < tabs.length - 1) setActiveTab(tabs[currentIdx + 1].id)
  }

  const handleBack = () => {
    if (currentIdx > 0) setActiveTab(tabs[currentIdx - 1].id)
  }

  /**
   * Baixar Planilha Excel — substitui o PDF na tela de Atualizações.
   *
   * É a mesma planilha do processo normal: um arquivo por distribuidor, com uma
   * aba por cliente e a aba "Resumo Omie" no fim. Monta a partir do que está na
   * tela, então sai com os dados já atualizados, antes mesmo de reenviar.
   */
  const handleDownloadPlanilha = async () => {
    if (!existingDeal) return
    setGeneratingPDF(true)
    try {
      normalizeFormCNPJs(form)
      const atual = payloadDosValores(form.getValues())
      const n = await downloadOcExcels(atual, existingDeal.id)
      if (n === 0) {
        toast.warning("Nenhuma planilha gerada — nenhum produto alocado a cliente nem serviço Interatell com item.")
      } else {
        toast.success(n > 1 ? `${n} planilhas baixadas (uma por distribuidor)!` : "Planilha baixada com sucesso!")
      }
    } catch (err: any) {
      toast.error("Erro ao gerar a planilha: " + (err?.message || ""))
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
        business: ["business"], suppliers: ["supplierGroups", "interatellBranches"],
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
      // "Faturamento via" passou a viver em cada grupo de fornecedor. O campo do
      // negocio vira derivado e e gravado no proprio values porque saveDraftAction
      // recebe values (nao o payload) e PDF, diff e historico leem esse campo.
      if (values.business.onlyInteratellService) {
        // Só serviço: descarta fornecedor e cliente de produto que tenham ficado de
        // antes de marcar a opção — senão o envio ainda geraria OC e OV. Serviço
        // Interatell é sempre faturado por Barueri.
        values.supplierGroups = []
        values.customers = []
        values.interatellBranches = ['barueri']
      } else {
        values.interatellBranches = deriveBranches(values.supplierGroups)
      }
      // Cliente Serviço pré-carregado fica para trás se o serviço for desmarcado:
      // sem isto o envio ainda cadastraria o cliente na filial de Barueri.
      if (!values.business.onlyInteratellService && !values.business.hasInteratellService) {
        values.serviceCustomers = []
      }
      values.business.deliveryDeadline = deriveDeliveryDeadline(
        values.supplierGroups, values.business.expectedBillingDate ?? '',
      )
      // PDF, relatório e o diff de alterações leem a condição no negócio. Ela
      // agora mora no fornecedor e no cliente, então o campo do negócio guarda a
      // primeira delas, como resumo.
      values.business.purchasePaymentCondition =
        String(values.business.purchasePaymentCondition ?? '').trim()
        || String(values.supplierGroups?.[0]?.purchasePaymentCondition ?? '')
      values.business.salePaymentCondition =
        String(values.business.salePaymentCondition ?? '').trim()
        || String(values.customers?.[0]?.salePaymentCondition ?? values.serviceCustomers?.[0]?.salePaymentCondition ?? '')

      pruneAllocations(values)
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
        // O download automatico do backlog e a planilha no modelo da Interatell;
        // o PDF continua disponivel no botao "Baixar PDF".
        toast.success("Rascunho salvo! Gerando planilha...")
        try {
          const n = await downloadOcExcels(values, result.dealId)
          if (n === 0) {
            toast.warning("Rascunho salvo, mas nenhuma planilha foi gerada — nenhum produto alocado a cliente nem serviço Interatell com item.")
          } else {
            toast.success(n > 1 ? `${n} planilhas baixadas (uma por distribuidor)!` : "Planilha baixada com sucesso!")
          }
        } catch (xlsErr: any) {
          toast.error("Rascunho salvo, mas houve erro ao gerar a planilha: " + (xlsErr?.message || ""))
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
            toast.success("Envio ao Omie iniciado — acompanhe o andamento nesta janela.")
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
            toast.success("Atualização no Omie iniciada — acompanhe o andamento nesta janela.")
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
    backlog: { label: "Salvar e Gerar Planilha", icon: FileSpreadsheet, cls: "bg-blue-600 hover:bg-blue-700" },
    omie:    { label: "Enviar ao Omie",     icon: Send,      cls: "bg-purple-600 hover:bg-purple-700" },
    update:  { label: "Atualizar no Omie",  icon: RefreshCw, cls: "bg-emerald-600 hover:bg-emerald-700" },
  }
  const submitCfg = SUBMIT_CONFIG[mode]
  const SubmitIcon = submitCfg.icon

  return (
    <Form {...form}>
      <form onSubmit={e => e.preventDefault()} className="space-y-6">

        {/* Etapa 6 (Processamento no Omie): o formulário só é conferido e enviado. */}
        {travado && (
          <div className="flex items-start gap-2.5 rounded-xl border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-800">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              <strong>Etapa 6 · Processamento no Omie: edição bloqueada.</strong>{" "}
              Confira os dados e envie. Para alterar qualquer coisa, devolva o card ao Backlog no Bitrix.
            </p>
          </div>
        )}

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
          <TabsList
            className="w-full grid gap-1"
            style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
          >
            {/* min-w-0 + truncate: "Fornecedores/Produtos" nao cabe na celula em telas
                estreitas (iframe do Bitrix). Sem isso o conteudo transborda e o check,
                que fica a esquerda do texto, sai da area visivel. */}
            {tabs.map(tab => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                disabled={!completedTabs.includes(tab.id) && tab.id !== activeTab}
                className="text-xs sm:text-sm min-w-0 gap-1"
                title={travado ? `${tab.label}: edição bloqueada na etapa 6 (Processamento no Omie)` : undefined}
              >
                {travado ? (
                  <Lock className="w-3 h-3 shrink-0 text-purple-500" />
                ) : completedTabs.includes(tab.id) && tab.id !== activeTab && (
                  <CheckCircle className="w-3 h-3 shrink-0 text-green-500" />
                )}
                <span className="truncate">{tab.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Travado: os campos ficam desabilitados, cliques são barrados e,
              ao passar o mouse, aparece o aviso. Rolagem continua livre. */}
          <div
            className={`mt-6 ${travado ? "relative group/trava" : ""}`}
            onClickCapture={travado ? barraEdicao : undefined}
            onPointerDownCapture={travado ? barraEdicao : undefined}
          >
            {travado && (
              <div className="pointer-events-none sticky top-3 z-30 flex h-0 justify-center">
                <span className="flex items-center gap-1.5 rounded-full bg-purple-700 px-3 py-1.5 text-xs font-medium text-white shadow-lg opacity-0 transition-opacity duration-200 group-hover/trava:opacity-100">
                  <Lock className="h-3.5 w-3.5" />
                  Etapa 6: nada pode ser editado aqui
                </span>
              </div>
            )}
            <fieldset disabled={travado} className={travado ? "cursor-not-allowed opacity-90 [&_*]:cursor-not-allowed" : "contents"}>
            <TabsContent value="business">
              <BusinessTab form={form} />
            </TabsContent>
            <TabsContent value="suppliers"><SupplierGroupsTab form={form} /></TabsContent>
            <TabsContent value="customers"><CustomersTab form={form} /></TabsContent>
            {(hasInteratellService || onlyInteratellService) && (
              <TabsContent value="serviceCustomers"><ServiceCustomersTab form={form} /></TabsContent>
            )}
            <TabsContent value="notes"><NotesTab form={form} /></TabsContent>
            <TabsContent value="ocNumbers"><OcNumbersTab form={form} /></TabsContent>
            </fieldset>
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
            {/* Salvar rascunho em qualquer etapa: não exige o formulário
                completo, só grava o que já foi preenchido. */}
            {mode === 'backlog' && (
              <Button
                type="button"
                variant="outline"
                onClick={handleSalvarRascunho}
                disabled={salvandoRascunho}
                className="gap-1.5 text-blue-700 border-blue-200 hover:bg-blue-50 hover:border-blue-400"
              >
                {salvandoRascunho
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</>
                  : <><Save className="w-4 h-4" /> Salvar rascunho</>
                }
              </Button>
            )}

            {/* A planilha da OC é baixada na gravação final e na Atualização. */}
            {isUpdate ? (
              existingDeal && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleDownloadPlanilha}
                  disabled={isGeneratingPDF}
                  className="gap-1.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50 hover:border-emerald-400"
                >
                  {isGeneratingPDF
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Gerando...</>
                    : <><FileSpreadsheet className="w-4 h-4" /> Baixar Planilha Excel</>
                  }
                </Button>
              )
            ) : null}

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


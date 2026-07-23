'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { CurrencyInput } from '@/components/ui/currency-input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, Search, Save, RotateCcw, Building2, Plus, CheckCircle, AlertCircle, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { getBitrixClientsAction, getBitrixSuppliersAction, lookupCnpjAction, getActiveOrderUpdateApprovalAction, requestOrderUpdateApprovalAction, getMyPendingOrderApprovalsAction } from '@/lib/actions'
import { formatCNPJ, isCNPJComplete } from '@/lib/utils'
import { formatPaymentConditionLabel, paymentConditionCodeOnly, DEFAULT_COMPRA_CONDITIONS, DEFAULT_VENDA_CONDITIONS } from '@/lib/payment-condition-utils'
import { useCurrentUser } from '@/components/current-user-provider'

type OrderKind = 'OC' | 'OV' | 'OS' | 'SW' | 'LC' | 'LIC' | 'ST' | 'SRV'

type OrderItem = {
  key: string
  codigo: string
  descricao: string
  quantidade: number
  valorUnitario: number
  ncm?: string
  cfop?: string
}

type ParceiroView = {
  codigoOmie: number
  razaoSocial: string
  nomeFantasia: string
  cnpj: string
  inscricaoEstadual: string
  email: string
  contato: string
  telefone: string
  endereco: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  estado: string
  cep: string
}

type OrderView = {
  orderKind: OrderKind
  orderLabel: string
  numero: string
  intCode: string
  internalId: number
  branch: 'barueri' | 'es'
  header: {
    observacaoExterna: string
    observacaoInterna: string
    dataPrevisao: string
    condicaoPagamento: string
    parceiro: string
  }
  cliente?: ParceiroView
  fornecedor?: ParceiroView
  items: OrderItem[]
  meta: Record<string, unknown>
}

type OrderPatch = {
  header?: Partial<OrderView['header']>
  cliente?: Partial<ParceiroView>
  fornecedor?: Partial<ParceiroView>
  items?: Array<Partial<OrderItem> & { key: string }>
  itemsReplace?: OrderItem[]
}

type PendingPatchDraft = {
  orderKind: OrderKind
  numero: string
  branch: 'barueri' | 'es'
  patch: OrderPatch
  parceiroName?: string
}

type FormState = {
  header: OrderView['header']
  parceiro?: ParceiroView
  items: OrderItem[]
}

const emptyParceiro = (): ParceiroView => ({
  codigoOmie: 0,
  razaoSocial: '',
  nomeFantasia: '',
  cnpj: '',
  inscricaoEstadual: '',
  email: '',
  contato: '',
  telefone: '',
  endereco: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  estado: '',
  cep: '',
})

/** IE e endereço são sempre preenchidos manualmente no painel (não vêm do cadastro Omie/Bitrix). */
function parceiroParaEdicaoManual(p: ParceiroView): ParceiroView {
  return {
    ...p,
    inscricaoEstadual: '',
    endereco: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    estado: '',
    cep: '',
    contato: '',
    telefone: '',
    email: '',
  }
}

function getOrderParceiro(order: OrderView): ParceiroView | undefined {
  return order.fornecedor ?? order.cliente
}

/** Reaplica um rascunho de patch sobre o formulário recém-carregado do Omie. */
function applyPatchToForm(form: FormState, patch: OrderPatch): FormState {
  let header = { ...form.header }
  if (patch.header) {
    const h = { ...patch.header } as Record<string, unknown>
    if (h.observacao !== undefined && h.observacaoExterna === undefined) {
      h.observacaoExterna = h.observacao
    }
    delete h.observacao
    header = { ...header, ...h } as typeof header
  }

  let parceiro = form.parceiro ? { ...form.parceiro } : undefined
  const parPatch = patch.fornecedor ?? patch.cliente
  if (parPatch) {
    parceiro = { ...(parceiro ?? emptyParceiro()), ...parPatch }
    header = { ...header, parceiro: parceiro.razaoSocial || parceiro.nomeFantasia || header.parceiro }
  }

  let items = form.items
  if (patch.itemsReplace?.length) {
    items = patch.itemsReplace.map(i => ({ ...i }))
  } else if (patch.items?.length) {
    items = form.items.map(it => {
      const ch = patch.items!.find(p => p.key === it.key)
      return ch ? { ...it, ...ch } : it
    })
  }

  return { header, parceiro, items }
}

function itemsStructureChanged(baseline: OrderItem[], current: OrderItem[]): boolean {
  if (baseline.length !== current.length) return true
  const baseByKey = new Map(baseline.map(i => [i.key, i]))
  return current.some(i => {
    const base = baseByKey.get(i.key)
    if (!base) return true // linha nova
    // Trocar o código/part number é troca de produto → reenvia a lista completa,
    // para o back resolver o novo SKU no catálogo Omie.
    return String(i.codigo ?? '') !== String(base.codigo ?? '')
  })
}

function companyToParceiro(company: Record<string, string | undefined>): ParceiroView {
  const name = String(company.name ?? '')
  return parceiroParaEdicaoManual({
    codigoOmie: 0,
    razaoSocial: name,
    nomeFantasia: name,
    cnpj: company.cnpj ? formatCNPJ(company.cnpj) : '',
    inscricaoEstadual: '',
    email: '',
    contato: '',
    telefone: '',
    endereco: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    estado: '',
    cep: '',
  })
}

const emptyManual = {
  name: '',
  tradeName: '',
  cnpj: '',
  inscricaoEstadual: '',
  email: '',
  phone: '',
  contactName: '',
  address: '',
  number: '',
  complement: '',
  neighborhood: '',
  city: '',
  state: '',
  zipCode: '',
}

function manualToParceiro(manual: typeof emptyManual): ParceiroView {
  const name = manual.name.trim()
  const trade = manual.tradeName.trim()
  return {
    codigoOmie: 0,
    razaoSocial: name,
    nomeFantasia: trade || name,
    cnpj: manual.cnpj ? formatCNPJ(manual.cnpj) : '',
    inscricaoEstadual: manual.inscricaoEstadual,
    email: manual.email,
    contato: manual.contactName,
    telefone: manual.phone,
    endereco: manual.address,
    numero: manual.number || 'S/N',
    complemento: manual.complement,
    bairro: manual.neighborhood,
    cidade: manual.city,
    estado: manual.state.toUpperCase().slice(0, 2),
    cep: manual.zipCode,
  }
}

function ParceiroPickerDialog({
  open,
  onClose,
  kind,
  initialMode = 'list',
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  kind: 'fornecedor' | 'cliente'
  initialMode?: 'list' | 'manual'
  onConfirm: (parceiro: ParceiroView) => void
}) {
  const [mode, setMode] = useState<'list' | 'manual'>('list')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<Record<string, string>[]>([])
  const [selected, setSelected] = useState<Record<string, string> | null>(null)
  const [error, setError] = useState('')
  const [manual, setManual] = useState(emptyManual)
  const [cnpjLoading, setCnpjLoading] = useState(false)

  const title = kind === 'fornecedor' ? 'Fornecedor desta OC' : 'Cliente deste pedido'
  const listLabel = kind === 'fornecedor' ? 'fornecedor' : 'cliente'

  const handleSearch = async (q: string) => {
    setLoading(true)
    setError('')
    setResults([])
    setSelected(null)
    try {
      const data = kind === 'fornecedor'
        ? await getBitrixSuppliersAction(q)
        : await getBitrixClientsAction(q)
      const rows = (data ?? []) as Record<string, string>[]
      if (!rows.length) {
        setError(q
          ? `Nenhum ${listLabel} encontrado para esse termo.`
          : `Nenhum ${listLabel} cadastrado na lista Bitrix24.`)
        return
      }
      setResults(rows)
    } catch {
      setError(`Erro ao buscar ${listLabel}s na lista.`)
    } finally {
      setLoading(false)
    }
  }

  const triggerCnpjLookup = async (digits: string) => {
    setCnpjLoading(true)
    setError('')
    try {
      const res = await lookupCnpjAction(digits)
      if (res.success) {
        setManual(m => ({
          ...m,
          name: res.name || m.name,
          tradeName: res.tradeName || m.tradeName,
        }))
        toast.success('Razão social preenchida pelo CNPJ — complete IE e endereço manualmente.')
      } else {
        toast.warning(`Consulta CNPJ: ${res.error || 'não encontrado'}. Preencha manualmente.`)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'falha de rede'
      toast.warning(`Erro ao consultar CNPJ: ${msg}`)
    } finally {
      setCnpjLoading(false)
    }
  }

  const handleCnpjChange = (value: string) => {
    setManual(m => ({ ...m, cnpj: value }))
    setError('')
    const digits = value.replace(/\D/g, '')
    if (digits.length === 14) void triggerCnpjLookup(digits)
  }

  useEffect(() => {
    if (!open) return
    setMode(initialMode)
    setQuery('')
    setSelected(null)
    setManual(emptyManual)
    setError('')
    if (initialMode === 'list') void handleSearch('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind, initialMode])

  const handleListConfirm = () => {
    if (!selected) {
      setError(`Selecione um ${listLabel} da lista.`)
      return
    }
    onConfirm(companyToParceiro(selected))
    onClose()
  }

  const handleManualConfirm = () => {
    if (!manual.name.trim()) {
      setError('Razão social é obrigatória.')
      return
    }
    if (manual.cnpj.trim() && !isCNPJComplete(manual.cnpj)) {
      setError('CNPJ inválido — deve ter 14 dígitos.')
      return
    }
    if (!manual.city.trim() || manual.state.trim().length !== 2) {
      setError('Cidade e UF (2 letras) são obrigatórios para cadastrar a empresa no Omie.')
      return
    }
    onConfirm(manualToParceiro(manual))
    onClose()
  }

  const setManualField = (field: keyof typeof emptyManual, value: string) => {
    setManual(m => ({ ...m, [field]: value }))
    setError('')
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-teal-600" />
            {title}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-gray-500 -mt-2">
          Vale <strong>só para este pedido</strong> no Omie — não altera o cadastro global da empresa.
        </p>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setMode('list'); setError(''); void handleSearch('') }}
            className={`px-3 py-1.5 text-sm rounded border transition-colors ${
              mode === 'list' ? 'bg-teal-600 text-white border-teal-600' : 'text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            Buscar na lista
          </button>
          <button
            type="button"
            onClick={() => { setMode('manual'); setError('') }}
            className={`px-3 py-1.5 text-sm rounded border transition-colors ${
              mode === 'manual' ? 'bg-teal-600 text-white border-teal-600' : 'text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            Adicionar manualmente
          </button>
        </div>

        {mode === 'list' ? (
          <>
            <div className="flex gap-2">
              <Input
                placeholder={`Buscar ${listLabel} por nome ou CNPJ…`}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && void handleSearch(query)}
              />
              <Button type="button" variant="outline" onClick={() => void handleSearch(query)} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </Button>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="space-y-1 max-h-56 overflow-y-auto border rounded-lg">
              {results.map(row => {
                const active = selected?.id === row.id
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setSelected(row)}
                    className={`w-full text-left px-3 py-2 text-sm border-b last:border-b-0 transition-colors ${
                      active ? 'bg-teal-50 border-teal-200' : 'hover:bg-gray-50'
                    }`}
                  >
                    <p className="font-medium text-gray-800">{row.name}</p>
                    <p className="text-xs text-gray-500 font-mono">{row.cnpj}</p>
                  </button>
                )
              })}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
              <Button type="button" onClick={handleListConfirm} disabled={!selected}>Usar neste pedido</Button>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs">Razão social *</Label>
                <Input
                  placeholder="Nome / Razão Social"
                  autoFocus
                  value={manual.name}
                  onChange={e => setManualField('name', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">
                  CNPJ {cnpjLoading && <span className="text-teal-500 font-normal">buscando…</span>}
                </Label>
                <div className="flex gap-1">
                  <Input
                    className="flex-1 font-mono"
                    placeholder="00.000.000/0000-00"
                    value={manual.cnpj}
                    onChange={e => handleCnpjChange(e.target.value)}
                    disabled={cnpjLoading}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="shrink-0"
                    disabled={cnpjLoading || manual.cnpj.replace(/\D/g, '').length !== 14}
                    onClick={() => void triggerCnpjLookup(manual.cnpj.replace(/\D/g, ''))}
                    title="Buscar dados do CNPJ (Brasil API)"
                  >
                    {cnpjLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  </Button>
                </div>
                <p className="text-[10px] text-gray-400">CNPJ busca só a razão social — IE e endereço são manuais.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Nome fantasia</Label>
                <Input
                  value={manual.tradeName}
                  onChange={e => setManualField('tradeName', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">IE (Inscrição Estadual)</Label>
                <Input
                  value={manual.inscricaoEstadual}
                  onChange={e => setManualField('inscricaoEstadual', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Contato</Label>
                <Input
                  value={manual.contactName}
                  onChange={e => setManualField('contactName', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Telefone</Label>
                <Input
                  value={manual.phone}
                  onChange={e => setManualField('phone', e.target.value)}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs">E-mail</Label>
                <Input
                  type="email"
                  value={manual.email}
                  onChange={e => setManualField('email', e.target.value)}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs">Endereço</Label>
                <Input
                  value={manual.address}
                  onChange={e => setManualField('address', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Número</Label>
                <Input
                  value={manual.number}
                  onChange={e => setManualField('number', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Complemento</Label>
                <Input
                  value={manual.complement}
                  onChange={e => setManualField('complement', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Bairro</Label>
                <Input
                  value={manual.neighborhood}
                  onChange={e => setManualField('neighborhood', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">CEP</Label>
                <Input
                  className="font-mono"
                  value={manual.zipCode}
                  onChange={e => setManualField('zipCode', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Cidade</Label>
                <Input
                  value={manual.city}
                  onChange={e => setManualField('city', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">UF</Label>
                <Input
                  maxLength={2}
                  value={manual.state}
                  onChange={e => setManualField('state', e.target.value.toUpperCase())}
                />
              </div>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
              <Button type="button" onClick={handleManualConfirm}>Usar neste pedido</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

const ORDER_TYPES: { value: OrderKind; label: string }[] = [
  { value: 'OC', label: 'OC — Ordem de Compra' },
  { value: 'OV', label: 'OV — Ordem de Venda (HW)' },
  { value: 'SW', label: 'OS — Software (SW)' },
  { value: 'LC', label: 'OS — Licença (LC)' },
  { value: 'LIC', label: 'OS — Licença (LIC)' },
  { value: 'ST', label: 'OS — Serviço Terceiro (ST)' },
  { value: 'SRV', label: 'OS — Serviço (SRV)' },
  { value: 'OS', label: 'OS — Ordem de Serviço (geral)' },
]

export type OmiePedidoPrefill = {
  orderKind: OrderKind
  numero: string
  branch?: 'barueri' | 'es'
}

interface OmiePartialUpdateTabProps {
  dealId?: number
  branches?: ('barueri' | 'es')[]
  /** Preenchido ao clicar em OC/OV no card do deal */
  prefill?: OmiePedidoPrefill | null
}

export function OmiePartialUpdateTab({ dealId, branches, prefill }: OmiePartialUpdateTabProps) {
  const { user } = useCurrentUser()
  const [approval, setApproval] = useState<{
    id?: number
    status?: string
    reviewed_by_name?: string
    reason?: string
    pending_patch?: PendingPatchDraft | null
  } | null>(null)
  const [requestingApproval, setRequestingApproval] = useState(false)
  const [changeDescription, setChangeDescription] = useState('')
  const [justApproved, setJustApproved] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [resumedKey, setResumedKey] = useState('')
  const [myPending, setMyPending] = useState<Array<{
    id: number
    status: string
    reason?: string
    pending_patch?: PendingPatchDraft | null
    order_kind?: string
    order_numero?: string
    order_branch?: string
    reviewed_by_name?: string
  }>>([])

  // Só admin atualiza direto. Qualquer outro papel (ou sessão não identificada) precisa de aprovação.
  const needsApproval = user?.role !== 'admin'
  const hasApproval = approval?.status === 'approved'
  const pendingApproval = approval?.status === 'pending'
  const updateBlocked = needsApproval && !hasApproval

  const branchList = branches?.length ? branches : (['barueri', 'es'] as const)
  const defaultBranch = branchList[0] ?? 'barueri'
  const [orderKind, setOrderKind] = useState<OrderKind>('OC')
  const [branch, setBranch] = useState<'barueri' | 'es'>(defaultBranch)
  const [numero, setNumero] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [order, setOrder] = useState<OrderView | null>(null)
  const [baseline, setBaseline] = useState<OrderView | null>(null)
  const [form, setForm] = useState<{
    header: OrderView['header']
    parceiro?: ParceiroView
    items: OrderItem[]
  } | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerInitialMode, setPickerInitialMode] = useState<'list' | 'manual'>('list')
  const [cnpjLoading, setCnpjLoading] = useState(false)
  const lastPrefillKey = useRef('')

  const openPicker = (mode: 'list' | 'manual') => {
    setPickerInitialMode(mode)
    setPickerOpen(true)
  }

  const activeOrderKind = order?.orderKind ?? orderKind
  const parceiroLabel = activeOrderKind === 'OC' ? 'Fornecedor' : 'Cliente'
  const parceiroPickerKind = activeOrderKind === 'OC' ? 'fornecedor' as const : 'cliente' as const

  const branchOptions = useMemo(() => {
    const opts: { value: 'barueri' | 'es'; label: string }[] = []
    if (branchList.includes('barueri')) opts.push({ value: 'barueri', label: 'Barueri (SP)' })
    if (branchList.includes('es')) opts.push({ value: 'es', label: 'Filial ES' })
    if (!opts.length) opts.push({ value: 'barueri', label: 'Barueri (SP)' })
    return opts
  }, [branchList])

  const applyOrderToForm = (o: OrderView) => {
    const parceiroRaw = getOrderParceiro(o)
    const parceiro = parceiroRaw ? parceiroParaEdicaoManual({ ...parceiroRaw }) : undefined
    const displayName = parceiroRaw?.razaoSocial || parceiroRaw?.nomeFantasia || o.header.parceiro
    setOrder(o)
    setBaseline(JSON.parse(JSON.stringify(o)))
    setForm({
      header: { ...o.header, parceiro: displayName },
      parceiro: parceiro ? { ...parceiro } : undefined,
      items: o.items.map(i => ({ ...i })),
    })
  }

  const fetchOrder = async (params: {
    kind: OrderKind
    br: 'barueri' | 'es'
    num: string
  }) => {
    const trimmed = params.num.trim()
    if (!trimmed) {
      toast.error('Informe o número do pedido no Omie')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/omie/consult-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dealId: dealId ?? 0,
          branch: params.br,
          orderKind: params.kind,
          numero: trimmed,
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Pedido não encontrado')
      const o = data.order as OrderView
      applyOrderToForm(o)
      setOrderKind(o.orderKind)
      setBranch(o.branch)
      setNumero(String(o.numero))
      toast.success(`${o.orderLabel} carregada do Omie`)
      return o
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao buscar pedido')
      setOrder(null)
      setBaseline(null)
      setForm(null)
      return null
    } finally {
      setLoading(false)
    }
  }

  /** Recarrega o pedido do Omie e reaplica o rascunho salvo (retomar após aprovação). */
  const resumeDraft = async (draft: PendingPatchDraft) => {
    setResuming(true)
    try {
      const o = await fetchOrder({ kind: draft.orderKind, br: draft.branch, num: draft.numero })
      if (!o) return
      setForm(prev => (prev ? applyPatchToForm(prev, draft.patch) : prev))
      toast.success('Edição retomada — revise e salve no Omie.')
    } finally {
      setResuming(false)
    }
  }

  const loadOrderApproval = async (o?: OrderView | null) => {
    const ord = o ?? order
    if (!needsApproval || !ord) { setApproval(null); return }
    const r = await getActiveOrderUpdateApprovalAction({
      orderKind: ord.orderKind, numero: String(ord.numero), branch: ord.branch,
    })
    if (r.success) setApproval(r.request as typeof approval)
  }

  const loadMyPending = async () => {
    if (!needsApproval) { setMyPending([]); return }
    const r = await getMyPendingOrderApprovalsAction()
    if (r.success) setMyPending(r.requests as typeof myPending)
  }

  // Aprovação vigente do pedido carregado (por número).
  useEffect(() => {
    if (order) void loadOrderApproval(order)
    else setApproval(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.orderKind, order?.numero, order?.branch, needsApproval])

  // Rascunhos do usuário aguardando/aprovados (para retomar sem pedido carregado).
  useEffect(() => {
    void loadMyPending()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsApproval])

  // Polling enquanto aguarda a aprovação do pedido carregado.
  useEffect(() => {
    if (!pendingApproval || !order) return
    const intervalId = setInterval(async () => {
      const r = await getActiveOrderUpdateApprovalAction({
        orderKind: order.orderKind, numero: String(order.numero), branch: order.branch,
      })
      if (r.success && r.request?.status === 'approved') {
        setApproval(r.request as typeof approval)
        setJustApproved(true)
        toast.success('Aprovação recebida! Você já pode atualizar no Omie.', { duration: 8000 })
        setTimeout(() => setJustApproved(false), 6000)
      }
    }, 8000)
    return () => clearInterval(intervalId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingApproval, order?.orderKind, order?.numero, order?.branch])

  const handleFetch = () => void fetchOrder({ kind: orderKind, br: branch, num: numero })

  useEffect(() => {
    if (!prefill?.numero) return
    const key = `${prefill.orderKind}:${prefill.numero}:${prefill.branch ?? defaultBranch}`
    if (lastPrefillKey.current === key) return
    lastPrefillKey.current = key
    setOrderKind(prefill.orderKind)
    setNumero(prefill.numero)
    if (prefill.branch) setBranch(prefill.branch)
    void fetchOrder({
      kind: prefill.orderKind,
      br: prefill.branch ?? defaultBranch,
      num: prefill.numero,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.orderKind, prefill?.numero, prefill?.branch])

  const buildPatch = (): OrderPatch | null => {
    if (!form || !baseline || !order) return null
    const patch: OrderPatch = {}

    const headerPatch: Partial<OrderView['header']> = {}
    if (form.header.observacaoExterna !== baseline.header.observacaoExterna) {
      headerPatch.observacaoExterna = form.header.observacaoExterna
    }
    if (form.header.observacaoInterna !== baseline.header.observacaoInterna) {
      headerPatch.observacaoInterna = form.header.observacaoInterna
    }
    if (form.header.dataPrevisao !== baseline.header.dataPrevisao) headerPatch.dataPrevisao = form.header.dataPrevisao
    if (form.header.condicaoPagamento !== baseline.header.condicaoPagamento) {
      headerPatch.condicaoPagamento = paymentConditionCodeOnly(form.header.condicaoPagamento)
    }
    if (Object.keys(headerPatch).length) patch.header = headerPatch

    // O formulário começa com IE/endereço/contato em branco (parceiroParaEdicaoManual).
    // Comparamos contra a MESMA base em branco para não gerar um patch de parceiro
    // quando o usuário não mexeu nele (senão dispararia a re-resolução do cliente/fornecedor).
    const baseParceiroRaw = getOrderParceiro(baseline)
    const baseParceiro = baseParceiroRaw ? parceiroParaEdicaoManual({ ...baseParceiroRaw }) : undefined
    if (form.parceiro) {
      const parceiroPatch: Partial<ParceiroView> = {}
      type ParceiroTextField = Exclude<keyof ParceiroView, 'codigoOmie'>
      const fields: ParceiroTextField[] = [
        'razaoSocial', 'nomeFantasia', 'cnpj', 'inscricaoEstadual', 'email', 'contato', 'telefone',
        'endereco', 'numero', 'complemento', 'bairro', 'cidade', 'estado', 'cep',
      ]
      for (const field of fields) {
        const current = form.parceiro[field]
        const base = baseParceiro?.[field] ?? ''
        if (current !== base) parceiroPatch[field] = current
      }
      if (Object.keys(parceiroPatch).length) {
        if (order.orderKind === 'OC') patch.fornecedor = parceiroPatch
        else patch.cliente = parceiroPatch
      }
    }

    const structureChanged = itemsStructureChanged(baseline.items, form.items)
    if (structureChanged) {
      patch.itemsReplace = form.items.map(i => ({ ...i }))
    } else {
      const itemPatches: Array<Partial<OrderItem> & { key: string }> = []
      for (const item of form.items) {
        const base = baseline.items.find(b => b.key === item.key)
        if (!base) continue
        const diff: Partial<OrderItem> & { key: string } = { key: item.key }
        let changed = false
        if (item.descricao !== base.descricao) { diff.descricao = item.descricao; changed = true }
        if (item.quantidade !== base.quantidade) { diff.quantidade = item.quantidade; changed = true }
        if (item.valorUnitario !== base.valorUnitario) { diff.valorUnitario = item.valorUnitario; changed = true }
        if (item.ncm !== base.ncm) { diff.ncm = item.ncm; changed = true }
        if (item.cfop !== base.cfop) { diff.cfop = item.cfop; changed = true }
        if (changed) itemPatches.push(diff)
      }
      if (itemPatches.length) patch.items = itemPatches
    }

    return patch
  }

  const buildApprovalReason = () => {
    if (!order) return undefined
    const patch = buildPatch()
    const parts = [`${order.orderLabel} nº ${order.numero}`]
    if (patch?.fornecedor) parts.push('troca/edição de fornecedor')
    if (patch?.cliente) parts.push('troca/edição de cliente')
    if (patch?.header) parts.push('cabeçalho do pedido')
    if (patch?.itemsReplace?.length) parts.push(`${patch.itemsReplace.length} item(ns) (lista substituída)`)
    else if (patch?.items?.length) parts.push(`${patch.items.length} item(ns)`)
    return parts.join(' · ')
  }

  const buildPendingDraft = (): PendingPatchDraft | null => {
    if (!order) return null
    const patch = buildPatch()
    if (!patch || (!patch.header && !patch.cliente && !patch.fornecedor && !patch.items?.length && !patch.itemsReplace?.length)) return null
    return {
      orderKind: order.orderKind,
      numero: String(order.numero),
      branch: order.branch,
      patch,
      parceiroName: form?.parceiro?.razaoSocial || form?.parceiro?.nomeFantasia,
    }
  }

  const handleRequestApproval = async () => {
    if (!order) {
      toast.error('Busque um pedido pelo número antes de solicitar aprovação.')
      return
    }
    const draft = buildPendingDraft()
    if (!draft) {
      toast.error('Faça a alteração desejada (ex.: trocar fornecedor) antes de solicitar aprovação.')
      return
    }
    const desc = changeDescription.trim()
    if (desc.length < 10) {
      toast.error('Descreva o que está alterando (mínimo 10 caracteres).')
      return
    }
    setRequestingApproval(true)
    try {
      const r = await requestOrderUpdateApprovalAction(
        { orderKind: order.orderKind, numero: String(order.numero), branch: order.branch, dealId: dealId ?? undefined },
        desc,
        buildApprovalReason(),
        draft,
      )
      if (r.success) {
        toast.success(r.status === 'approved'
          ? 'Já existe uma aprovação vigente.'
          : 'Solicitação enviada ao financeiro! Sua edição foi salva — você pode fechar esta tela e voltar depois.')
        setChangeDescription('')
        await loadOrderApproval(order)
        await loadMyPending()
      } else {
        toast.error(r.error || 'Erro ao solicitar aprovação.')
      }
    } finally {
      setRequestingApproval(false)
    }
  }

  const pendingDraft = approval?.pending_patch ?? null

  // Reaplica automaticamente o rascunho salvo quando o pedido é carregado e ainda não há alterações locais.
  useEffect(() => {
    if (!pendingDraft || !order || loading || resuming) return
    const key = `${order.orderKind}:${order.numero}:${order.branch}`
    if (resumedKey === key) return
    setResumedKey(key)
    setForm(prev => (prev ? applyPatchToForm(prev, pendingDraft.patch) : prev))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDraft, order?.orderKind, order?.numero, order?.branch, loading])

  const handleSave = async () => {
    if (!order || !form || !baseline) {
      toast.error('Busque um pedido antes de atualizar')
      return
    }
    if (updateBlocked) {
      toast.error('Esta atualização precisa de aprovação do financeiro. Clique em "Solicitar aprovação".')
      return
    }
    const patch = buildPatch()
    if (!patch || (!patch.header && !patch.cliente && !patch.fornecedor && !patch.items?.length && !patch.itemsReplace?.length)) {
      toast.error('Nenhum campo foi alterado')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/omie/patch-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dealId: dealId ?? 0,
          branch: order.branch,
          orderKind: order.orderKind,
          numero: String(order.numero),
          meta: order.meta,
          patch,
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Falha ao atualizar')

      toast.success(`Pedido ${order.orderLabel} atualizado no Omie!`)
      if (form && order) {
        const synced: OrderView = {
          ...order,
          header: {
            ...form.header,
            parceiro: form.parceiro?.razaoSocial || form.parceiro?.nomeFantasia || form.header.parceiro,
          },
          ...(order.orderKind === 'OC'
            ? { fornecedor: form.parceiro ? { ...form.parceiro } : order.fornecedor }
            : { cliente: form.parceiro ? { ...form.parceiro } : order.cliente }),
          items: form.items.map(i => ({ ...i })),
        }
        setBaseline(JSON.parse(JSON.stringify(synced)))
        setOrder(synced)
      }
      await loadOrderApproval(order)
      await loadMyPending()
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao atualizar pedido')
    } finally {
      setSaving(false)
    }
  }

  const resetForm = () => {
    if (!baseline) return
    setForm({
      header: { ...baseline.header },
      parceiro: getOrderParceiro(baseline) ? { ...getOrderParceiro(baseline)! } : undefined,
      items: baseline.items.map(i => ({ ...i })),
    })
    toast.message('Alterações descartadas')
  }

  const updateItem = (key: string, field: keyof OrderItem, value: string | number) => {
    setForm(prev => {
      if (!prev) return prev
      return {
        ...prev,
        items: prev.items.map(it => it.key === key ? { ...it, [field]: value } : it),
      }
    })
  }

  const removeItem = (key: string) => {
    setForm(prev => {
      if (!prev) return prev
      return { ...prev, items: prev.items.filter(it => it.key !== key) }
    })
  }

  const addItem = () => {
    setForm(prev => {
      if (!prev) return prev
      const n = prev.items.length + 1
      return {
        ...prev,
        items: [
          ...prev.items,
          {
            key: `new-${Date.now()}-${n}`,
            codigo: '',
            descricao: '',
            quantidade: 1,
            valorUnitario: 0,
            ncm: '',
            cfop: '',
          },
        ],
      }
    })
  }

  const updateParceiro = (field: keyof ParceiroView, value: string) => {
    setForm(prev => {
      if (!prev) return prev
      const parceiro = prev.parceiro ?? emptyParceiro()
      return { ...prev, parceiro: { ...parceiro, [field]: value } }
    })
  }

  const applyParceiroFromList = (parceiro: ParceiroView) => {
    const p = parceiroParaEdicaoManual({ ...parceiro })
    setForm(prev => {
      if (!prev) return prev
      return {
        ...prev,
        header: {
          ...prev.header,
          parceiro: p.razaoSocial || p.nomeFantasia || prev.header.parceiro,
        },
        parceiro: p,
      }
    })
    toast.success(`${parceiroLabel} selecionado — salve para vincular ao pedido`)
  }

  const triggerParceiroCnpjLookup = async (digits: string) => {
    setCnpjLoading(true)
    try {
      const res = await lookupCnpjAction(digits)
      if (!res.success) {
        toast.warning(`Consulta CNPJ: ${res.error || 'não encontrado'}`)
        return
      }
      setForm(prev => {
        if (!prev) return prev
        const parceiro = prev.parceiro ?? emptyParceiro()
        return {
          ...prev,
          header: {
            ...prev.header,
            parceiro: res.name || parceiro.razaoSocial || prev.header.parceiro,
          },
          parceiro: {
            ...parceiro,
            razaoSocial: res.name || parceiro.razaoSocial,
            nomeFantasia: res.tradeName || res.name || parceiro.nomeFantasia,
            cnpj: formatCNPJ(digits),
          },
        }
      })
      toast.success('Razão social atualizada — preencha IE e endereço manualmente.')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'falha de rede'
      toast.warning(`Erro ao consultar CNPJ: ${msg}`)
    } finally {
      setCnpjLoading(false)
    }
  }

  const handleParceiroCnpjChange = (value: string) => {
    updateParceiro('cnpj', value)
    const digits = value.replace(/\D/g, '')
    if (digits.length === 14) void triggerParceiroCnpjLookup(digits)
  }

  const patchPreview = buildPatch()
  const hasChanges = !!(patchPreview?.header || patchPreview?.cliente || patchPreview?.fornecedor || patchPreview?.items?.length || patchPreview?.itemsReplace?.length)
  const showParceiroSection = !!form && !!order

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Atualizar pedido pelo número Omie</h2>
        <p className="text-sm text-gray-500 mt-1">
          Informe o tipo e o número (OC, OV, OS, Licença, SW…). Os dados são carregados do Omie para você editar
          apenas o que precisa — o restante permanece igual.
        </p>
        {needsApproval && !order && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
            Inside Sales: pesquise o pedido pelo número, faça as alterações e clique em <strong>Solicitar aprovação</strong>. O financeiro aprova e você conclui a atualização no Omie.
          </p>
        )}
      </div>

      {needsApproval && !order && myPending.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-gray-700">Suas edições aguardando conclusão</p>
          {myPending.map(req => {
            const draft = req.pending_patch
            const approved = req.status === 'approved'
            return (
              <div
                key={req.id}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 border ${
                  approved ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'
                }`}
              >
                <div className="flex items-start gap-2">
                  {approved ? <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" /> : <Loader2 className="w-4 h-4 mt-0.5 shrink-0 animate-spin" />}
                  <div className="text-sm">
                    <p className="font-semibold">
                      {req.order_kind} nº {req.order_numero}
                      {draft?.parceiroName ? ` · ${draft.parceiroName}` : ''}
                    </p>
                    <p className="text-xs opacity-90">
                      {approved ? 'Aprovada — clique em Retomar e salve no Omie.' : 'Aguardando aprovação do financeiro.'}
                    </p>
                  </div>
                </div>
                {draft && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    disabled={resuming}
                    onClick={() => void resumeDraft(draft)}
                  >
                    {resuming ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Retomar edição'}
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {pendingDraft && (
        <div className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 border ${
          hasApproval
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-amber-50 border-amber-200 text-amber-800'
        }`}>
          <div className="flex items-start gap-2">
            {hasApproval ? <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" /> : <Loader2 className="w-4 h-4 mt-0.5 shrink-0 animate-spin" />}
            <div className="text-sm">
              <p className="font-semibold">
                {hasApproval ? 'Edição aprovada e salva' : 'Edição salva — aguardando aprovação do financeiro'}
              </p>
              <p className="text-xs opacity-90">
                {pendingDraft.orderKind} nº {pendingDraft.numero}
                {pendingDraft.parceiroName ? ` · ${pendingDraft.parceiroName}` : ''}
                {hasApproval ? ' — clique em Retomar e depois salve no Omie.' : ' — você pode fechar esta tela e voltar depois.'}
              </p>
            </div>
          </div>
          {!order && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={() => void resumeDraft(pendingDraft)}
              disabled={resuming || loading}
            >
              {resuming ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RotateCcw className="w-4 h-4 mr-1" />}
              Retomar edição
            </Button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 p-4 rounded-xl border bg-gray-50">
        <div className="space-y-1.5">
          <Label className="text-xs">Tipo do pedido</Label>
          <Select value={orderKind} onValueChange={v => setOrderKind(v as OrderKind)}>
            <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ORDER_TYPES.map(t => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Filial Omie</Label>
          <Select value={branch} onValueChange={v => setBranch(v as 'barueri' | 'es')}>
            <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              {branchOptions.map(b => (
                <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label className="text-xs">Número no Omie</Label>
          <div className="flex gap-2">
            <Input
              className="bg-white font-mono"
              placeholder="Ex: 2601010282 ou OC-1-G0"
              value={numero}
              onChange={e => setNumero(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void handleFetch()}
            />
            <Button type="button" onClick={() => void handleFetch()} disabled={loading} className="shrink-0">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              <span className="ml-1.5 hidden sm:inline">Buscar</span>
            </Button>
          </div>
        </div>
      </div>

      {form && order && (
        <div className="space-y-4 border rounded-xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold text-gray-800">{order.orderLabel}</p>
              <p className="text-xs text-gray-500 font-mono">
                Nº {order.numero} · Cód. integração {order.intCode || '—'}
              </p>
            </div>
            {hasChanges && (
              <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-1 rounded-lg border border-amber-200">
                Alterações pendentes
              </span>
            )}
          </div>

          {showParceiroSection && (
            <div className="space-y-3 rounded-xl border-2 border-teal-200 bg-gradient-to-br from-teal-50 to-cyan-50 p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Label className="text-sm font-bold text-teal-800">
                    {parceiroLabel} deste pedido
                  </Label>
                  {form.header.parceiro && (
                    <p className="text-sm font-semibold text-gray-800 mt-1">{form.header.parceiro}</p>
                  )}
                  <p className="text-[11px] text-teal-700 mt-1">
                    Troque ou edite o {parceiroLabel.toLowerCase()} <strong>só neste pedido</strong> — não altera o cadastro global no Omie.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    className="bg-teal-600 hover:bg-teal-700"
                    onClick={() => openPicker('list')}
                  >
                    <Search className="w-3.5 h-3.5 mr-1" />
                    Buscar na lista
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => openPicker('manual')}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Adicionar manualmente
                  </Button>
                </div>
              </div>

              {form.parceiro ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <p className="md:col-span-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                  IE, endereço e contato são <strong>manuais neste pedido</strong> — não use o cadastro da Interatell.
                </p>
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs">Razão social</Label>
                  <Input
                    value={form.parceiro.razaoSocial}
                    onChange={e => updateParceiro('razaoSocial', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Nome fantasia</Label>
                  <Input
                    value={form.parceiro.nomeFantasia}
                    onChange={e => updateParceiro('nomeFantasia', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    CNPJ / CPF {cnpjLoading && <span className="text-teal-500 font-normal">buscando…</span>}
                  </Label>
                  <div className="flex gap-1">
                    <Input
                      className="font-mono flex-1"
                      value={form.parceiro.cnpj}
                      onChange={e => handleParceiroCnpjChange(e.target.value)}
                      disabled={cnpjLoading}
                      placeholder="00.000.000/0000-00"
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="shrink-0"
                      disabled={cnpjLoading || form.parceiro.cnpj.replace(/\D/g, '').length !== 14}
                      onClick={() => void triggerParceiroCnpjLookup(form.parceiro!.cnpj.replace(/\D/g, ''))}
                      title="Buscar razão social pelo CNPJ"
                    >
                      {cnpjLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">IE (Inscrição Estadual)</Label>
                  <Input
                    value={form.parceiro.inscricaoEstadual}
                    onChange={e => updateParceiro('inscricaoEstadual', e.target.value)}
                    placeholder="Ex: 83141588"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Contato</Label>
                  <Input
                    value={form.parceiro.contato}
                    onChange={e => updateParceiro('contato', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Telefone</Label>
                  <Input
                    value={form.parceiro.telefone}
                    onChange={e => updateParceiro('telefone', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">E-mail</Label>
                  <Input
                    value={form.parceiro.email}
                    onChange={e => updateParceiro('email', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs">Endereço</Label>
                  <Input
                    value={form.parceiro.endereco}
                    onChange={e => updateParceiro('endereco', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Número</Label>
                  <Input
                    value={form.parceiro.numero}
                    onChange={e => updateParceiro('numero', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Complemento</Label>
                  <Input
                    value={form.parceiro.complemento}
                    onChange={e => updateParceiro('complemento', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Bairro</Label>
                  <Input
                    value={form.parceiro.bairro}
                    onChange={e => updateParceiro('bairro', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Cidade</Label>
                  <Input
                    value={form.parceiro.cidade}
                    onChange={e => updateParceiro('cidade', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">UF</Label>
                  <Input
                    maxLength={2}
                    value={form.parceiro.estado}
                    onChange={e => updateParceiro('estado', e.target.value.toUpperCase())}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">CEP</Label>
                  <Input
                    className="font-mono"
                    value={form.parceiro.cep}
                    onChange={e => updateParceiro('cep', e.target.value)}
                  />
                </div>
              </div>
              ) : (
                <p className="text-sm text-teal-800/90 font-medium">
                  Nenhum {parceiroLabel.toLowerCase()} vinculado — use &quot;Buscar na lista&quot; ou &quot;Adicionar manualmente&quot; (com busca automática pelo CNPJ).
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Observação externa</Label>
              <Input
                value={form.header.observacaoExterna}
                onChange={e => setForm(f => f ? { ...f, header: { ...f.header, observacaoExterna: e.target.value } } : f)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Observação interna</Label>
              <Input
                value={form.header.observacaoInterna}
                onChange={e => setForm(f => f ? { ...f, header: { ...f.header, observacaoInterna: e.target.value } } : f)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Data de previsão</Label>
              <Input
                type="date"
                value={form.header.dataPrevisao}
                onChange={e => setForm(f => f ? { ...f, header: { ...f.header, dataPrevisao: e.target.value } } : f)}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label className="text-xs">Condição de pagamento (parcela)</Label>
              <Select
                value={(() => {
                  const kind = activeOrderKind === 'OC' ? 'purchase' as const : 'sale' as const
                  const label = formatPaymentConditionLabel(form.header.condicaoPagamento, kind)
                  return label === '—' ? '' : label
                })()}
                onValueChange={v => setForm(f => f ? {
                  ...f,
                  header: { ...f.header, condicaoPagamento: paymentConditionCodeOnly(v) },
                } : f)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a parcela…">
                    {formatPaymentConditionLabel(
                      form.header.condicaoPagamento,
                      activeOrderKind === 'OC' ? 'purchase' : 'sale',
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(activeOrderKind === 'OC' ? DEFAULT_COMPRA_CONDITIONS : DEFAULT_VENDA_CONDITIONS).map(opt => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-gray-400">
                Enviado ao Omie só o código ({paymentConditionCodeOnly(form.header.condicaoPagamento) || '—'}).
              </p>
            </div>
          </div>

          <ParceiroPickerDialog
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            kind={parceiroPickerKind}
            initialMode={pickerInitialMode}
            onConfirm={applyParceiroFromList}
          />

          {form.items.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-xs font-semibold uppercase text-gray-500">Itens / Serviços</Label>
                <Button type="button" size="sm" variant="outline" onClick={addItem}>
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Adicionar item
                </Button>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="text-left p-2">Código</th>
                      <th className="text-left p-2">Descrição</th>
                      <th className="text-center p-2 w-20">Qtd</th>
                      <th className="text-right p-2 w-28">Valor unit.</th>
                      {(order.orderKind === 'OV' || order.orderKind === 'OC') && (
                        <th className="text-center p-2 w-24">NCM</th>
                      )}
                      {order.orderKind === 'OV' && (
                        <th className="text-center p-2 w-20">CFOP</th>
                      )}
                      <th className="p-2 w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.map(item => (
                      <tr key={item.key} className="border-t">
                        <td className="p-2 font-mono">
                          <Input
                            className="h-8 text-xs font-mono"
                            value={item.codigo}
                            placeholder="SKU / cod. Omie"
                            onChange={e => updateItem(item.key, 'codigo', e.target.value)}
                          />
                        </td>
                        <td className="p-2">
                          <Input
                            className="h-8 text-xs"
                            value={item.descricao}
                            onChange={e => updateItem(item.key, 'descricao', e.target.value)}
                          />
                        </td>
                        <td className="p-2">
                          <Input
                            className="h-8 text-xs text-center"
                            type="number"
                            min={0}
                            step="any"
                            value={item.quantidade}
                            onChange={e => updateItem(item.key, 'quantidade', Number(e.target.value))}
                          />
                        </td>
                        <td className="p-2">
                          <CurrencyInput
                            className="h-8 text-xs text-right"
                            value={item.valorUnitario}
                            resetKey={`${order.numero}:${item.key}:${item.valorUnitario}`}
                            onChange={v => updateItem(item.key, 'valorUnitario', v)}
                          />
                        </td>
                        {order.orderKind === 'OC' && (
                          <td className="p-2">
                            <Input
                              className="h-8 text-xs"
                              value={item.ncm ?? ''}
                              onChange={e => updateItem(item.key, 'ncm', e.target.value)}
                            />
                          </td>
                        )}
                        {order.orderKind === 'OV' && (
                          <>
                            <td className="p-2">
                              <Input
                                className="h-8 text-xs"
                                value={item.ncm ?? ''}
                                onChange={e => updateItem(item.key, 'ncm', e.target.value)}
                              />
                            </td>
                            <td className="p-2">
                              <Input
                                className="h-8 text-xs"
                                value={item.cfop ?? ''}
                                onChange={e => updateItem(item.key, 'cfop', e.target.value)}
                              />
                            </td>
                          </>
                        )}
                        <td className="p-2 text-center">
                          {/* OC (Pedido de Compra) não permite excluir item por API
                              (UpsertPedCompra não remove item omitido) — some com o botão. */}
                          {order.orderKind !== 'OC' && (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                              onClick={() => removeItem(item.key)}
                              title="Remover item"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-gray-500">
                {order.orderKind === 'OC'
                  ? 'Você pode adicionar itens ou trocar o produto de um item. A exclusão de item não é feita aqui — remova direto no Omie, se necessário.'
                  : 'Ao adicionar ou remover itens, a lista completa é reenviada ao Omie na atualização.'}
              </p>
            </div>
          )}

          {form.items.length === 0 && (
            <div className="rounded-lg border border-dashed p-4 text-center space-y-2">
              <p className="text-sm text-gray-500">Nenhum item no pedido.</p>
              <Button type="button" size="sm" variant="outline" onClick={addItem}>
                <Plus className="w-3.5 h-3.5 mr-1" />
                Adicionar item
              </Button>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2 border-t">
            {needsApproval && (
              justApproved ? (
                <div className="w-full flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-700 text-sm font-medium mb-1">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  Aprovação recebida! Você já pode salvar a atualização no Omie.
                </div>
              ) : hasApproval ? (
                <div className="w-full flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-700 text-sm font-medium mb-1">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  Atualização aprovada{approval?.reviewed_by_name ? ` por ${approval.reviewed_by_name}` : ''}. Pode salvar no Omie.
                </div>
              ) : pendingApproval ? (
                <div className="w-full flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm mb-1">
                  <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                  Aguardando aprovação do financeiro…
                </div>
              ) : (
                <div className="w-full space-y-2 p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-700 text-sm mb-1">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>
                      {hasChanges
                        ? 'Suas alterações precisam de aprovação do financeiro antes de irem ao Omie.'
                        : 'Faça as alterações necessárias e solicite aprovação do financeiro.'}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="change-description" className="text-xs font-semibold text-blue-800">
                      O que está alterando? <span className="text-red-500">*</span>
                    </Label>
                    <Textarea
                      id="change-description"
                      value={changeDescription}
                      onChange={e => setChangeDescription(e.target.value)}
                      placeholder="Ex.: Removi o item X e incluí o item Y; ajustei quantidade e valor unitário."
                      rows={3}
                      className="text-sm bg-white border-blue-200 focus-visible:ring-blue-300"
                    />
                    <p className="text-[10px] text-blue-600/80">Este texto vai junto com a solicitação para o financeiro.</p>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleRequestApproval()}
                      disabled={requestingApproval || !hasChanges || changeDescription.trim().length < 10}
                      className="bg-amber-600 hover:bg-amber-700 shrink-0"
                    >
                      {requestingApproval
                        ? <><Loader2 className="w-4 h-4 animate-spin mr-1" /> Enviando…</>
                        : <><Send className="w-4 h-4 mr-1" /> Solicitar aprovação</>}
                    </Button>
                  </div>
                </div>
              )
            )}
            {!updateBlocked && (
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || !hasChanges}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                Atualizar só o que alterei
              </Button>
            )}
            <Button type="button" variant="outline" onClick={resetForm} disabled={!hasChanges}>
              <RotateCcw className="w-4 h-4 mr-1" /> Desfazer alterações
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

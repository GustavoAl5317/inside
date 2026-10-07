"use client"

import { useState, useEffect } from "react"
import { useFieldArray, type UseFormReturn } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Trash2, Plus, Search, Users, Building2, ChevronDown, ChevronUp, Eye, Loader2, ExternalLink } from "lucide-react"
import { searchBitrixCompaniesAction, getBitrixCompanyDetailsAction, createBitrixClientAction, lookupCnpjAction } from "@/lib/actions"
import { isCNPJComplete, formatCNPJ, formatCurrency } from "@/lib/utils"
import { CurrencyInput } from "@/components/ui/currency-input"
import { toast } from "sonner"
import { OmieLimitAlert } from "@/components/omie-limit-alert"
import { abrirEmpresaBitrix } from "@/lib/bx24-open"
import { camposExcedidos } from "@/lib/omie-limites"

interface CustomersTabProps {
  form: UseFormReturn<any>
}

const emptyCustomer = {
  name: "", cnpj: "", stateRegistration: "", email: "", phone: "",
  address: "", number: "", complement: "", neighborhood: "",
  city: "", state: "", zipCode: "", contactName: "",
}

// ── Diálogo: filial buscada na base de empresas do Bitrix ────────────────────
// O cadastro de cliente é único e mora no Bitrix, então filial nova só entra por
// busca. Os campos digitáveis ficam só para editar uma filial já adicionada.
// Exportado para o step de Cliente Serviço (SRV) reusar a mesma seleção.
export function CustomerDialog({
  open,
  onClose,
  onConfirm,
  initialData,
  isEdit = false,
}: {
  open: boolean
  onClose: () => void
  onConfirm: (data: any) => void
  initialData?: any
  isEdit?: boolean
}) {
  // "list" = busca no Bitrix. "manual" existe só no modo edição.
  const [mode, setMode] = useState<"manual" | "list">(isEdit ? "manual" : "list")
  const [manual, setManual] = useState<typeof emptyCustomer>(isEdit && initialData ? { ...emptyCustomer, ...initialData } : emptyCustomer)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [cepLoading, setCepLoading] = useState(false)
  const [branch, setBranch] = useState<'barueri' | 'es'>(initialData?.branch === 'es' ? 'es' : 'barueri')

  useEffect(() => {
    if (open) {
      setManual(isEdit && initialData ? { ...emptyCustomer, ...initialData } : emptyCustomer)
      setBranch(initialData?.branch === 'es' ? 'es' : 'barueri')
      setError("")
      setMode(isEdit ? "manual" : "list")
    }
  }, [open])

  // modo lista
  const [query, setQuery] = useState("")
  const [listLoading, setListLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [results, setResults] = useState<any[]>([])
  const [selected, setSelected] = useState<any>(null)

  const handleLoadList = async (q = "") => {
    setListLoading(true); setError(""); setResults([]); setSelected(null)
    const res = await searchBitrixCompaniesAction(q)
    setListLoading(false)
    if (!res.success) { setError(res.error || "Falha ao consultar o Bitrix."); return }
    if (!res.companies.length) {
      setError(q ? "Nenhuma empresa encontrada no Bitrix." : "Nenhuma empresa na base do Bitrix.")
      return
    }
    setResults(res.companies)
  }

  /**
   * CNPJ, IE, endereço e contato não vêm na listagem de empresas: moram no
   * requisito e no contato vinculado. São buscados ao escolher a empresa.
   *
   * O endereço do requisito está vazio na maior parte da base (numa amostra de
   * 60 empresas, 53 tinham CNPJ e só 16 tinham endereço). Quem completa pela
   * Receita é getCRMCompanyFullDetails, no servidor — aqui só exibe o que voltou.
   */
  const handleSelect = async (empresa: any) => {
    setSelected(empresa); setError("")
    if (empresa?.detalhado) return
    setDetailLoading(true)
    const { success, ...dados } = await getBitrixCompanyDetailsAction(Number(empresa.id))
    if (!success) {
      setDetailLoading(false)
      setError("Não foi possível carregar os dados da empresa no Bitrix.")
      return
    }

    const completo: any = { ...empresa, ...dados, name: dados.name || empresa.name, detalhado: true }

    setDetailLoading(false)
    setSelected(completo)
    setResults(rs => rs.map(r => (r.id === empresa.id ? completo : r)))
  }

  useEffect(() => {
    if (open && mode === "list") handleLoadList("")
  }, [open, mode])

  const triggerCnpjLookup = async (digits: string) => {
    setCepLoading(true)
    setError("")
    try {
      const res = await lookupCnpjAction(digits)
      console.log('[lookupCnpj client] resposta:', res)
      if (res.success) {
        setManual(m => ({
          ...m,
          name:         res.name         ? res.name         : m.name,
          address:      res.address      ? res.address      : m.address,
          number:       res.number       ? res.number       : m.number,
          complement:   res.complement   ? res.complement   : m.complement,
          neighborhood: res.neighborhood ? res.neighborhood : m.neighborhood,
          city:         res.city         ? res.city         : m.city,
          state:        res.state        ? res.state        : m.state,
          zipCode:      res.zipCode      ? res.zipCode      : m.zipCode,
          email:        res.email        ? res.email        : m.email,
          phone:        res.phone        ? res.phone        : m.phone,
        }))
        toast.success("Dados do CNPJ preenchidos automaticamente!")
      } else {
        toast.warning(`Preenchimento automático indisponível: ${res.error || "CNPJ não encontrado"}. Preencha manualmente.`)
      }
    } catch (err: any) {
      toast.warning(`Erro ao consultar CNPJ: ${err?.message || "falha de rede"}. Preencha manualmente.`)
    } finally {
      setCepLoading(false)
    }
  }

  const handleCnpjChange = (value: string) => {
    set("cnpj", value)
    const digits = value.replace(/\D/g, '')
    if (digits.length === 14) {
      triggerCnpjLookup(digits)
    }
  }

  const handleManualConfirm = async () => {
    if (!manual.name.trim()) { setError("Nome é obrigatório"); return }
    if (!manual.contactName.trim()) { setError("Contato é obrigatório"); return }
    if (manual.cnpj.trim() && !isCNPJComplete(manual.cnpj)) {
      setError("CNPJ inválido — deve ter 12 a 14 dígitos"); return
    }

    // Consulta: nada volta para o Bitrix — o cadastro de la e a fonte.
    if (isEdit) {
      onConfirm({ ...manual, cnpj: manual.cnpj ? formatCNPJ(manual.cnpj) : "", branch })
      setError("")
      onClose()
      return
    }

    setSaving(true)
    try {
      const saved = await createBitrixClientAction(manual)
      if (!saved.success) {
        toast.warning("Não foi possível salvar na lista Bitrix24, mas o cliente foi adicionado ao formulário.")
      }
    } catch {
      toast.warning("Não foi possível salvar na lista Bitrix24, mas o cliente foi adicionado ao formulário.")
    } finally {
      setSaving(false)
    }

    onConfirm({ ...manual, cnpj: manual.cnpj ? formatCNPJ(manual.cnpj) : "", branch })
    setManual(emptyCustomer)
    setError("")
    onClose()
  }

  const handleListConfirm = () => {
    if (!selected) return
    onConfirm({ ...selected, cnpj: selected.cnpj ? formatCNPJ(selected.cnpj) : "", branch })
    setQuery(""); setResults([]); setSelected(null); setError("")
    onClose()
  }

  // Consulta: o cadastro e do Bitrix, so o contato e editavel aqui.
  const travado = isEdit ? 'bg-gray-100 text-gray-600 cursor-not-allowed' : ''

  const set = (field: keyof typeof emptyCustomer, value: string) => {
    setManual(m => ({ ...m, [field]: value }))
    setError("")
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-purple-600" />
            {isEdit ? "Dados do cliente" : "Adicionar Filial — Buscar no Bitrix"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {isEdit && initialData?.bitrixCompanyId && (
            <button
              type="button"
              onClick={() => abrirEmpresaBitrix(initialData.bitrixCompanyId)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-purple-600 hover:text-purple-800 underline underline-offset-2"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Abrir esta empresa no Bitrix
            </button>
          )}

          <p className="text-xs text-gray-500">
            {isEdit
              ? "O cadastro do cliente é do Bitrix e aqui é só consulta. Para corrigir razão social, CNPJ ou endereço, altere no Bitrix e adicione a filial de novo. Só o contato é editável."
              : "O cadastro dos clientes é único e fica no Bitrix. Para incluir uma filial que não aparece aqui, cadastre a empresa no Bitrix primeiro."}
          </p>

          {/* ── Modo: Manual ── */}
          {mode === "manual" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-700">Razão Social *</label>
                  <Input className={`mt-1 ${travado}`} placeholder="Nome / Razão Social" autoFocus={!isEdit}
                    disabled={isEdit}
                    value={manual.name} onChange={e => set("name", e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">
                    CNPJ {cepLoading && <span className="text-purple-500 font-normal">buscando...</span>}
                  </label>
                  <div className="flex gap-1 mt-1">
                    <Input className={`flex-1 ${travado}`} placeholder="00.000.000/0000-00"
                      value={manual.cnpj}
                      onChange={e => handleCnpjChange(e.target.value)}
                      disabled={cepLoading || isEdit}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0 px-2"
                      disabled={isEdit || cepLoading || manual.cnpj.replace(/\D/g, '').length !== 14}
                      onClick={() => triggerCnpjLookup(manual.cnpj.replace(/\D/g, ''))}
                      title="Buscar dados do CNPJ"
                    >
                      {cepLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Inscrição Estadual</label>
                  <Input className={`mt-1 ${travado}`} placeholder="IE" disabled={isEdit}
                    value={manual.stateRegistration} onChange={e => set("stateRegistration", e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">
                    Contato {isEdit && <span className="text-purple-600 font-normal">· único campo editável</span>}
                  </label>
                  <Input className="mt-1" placeholder="Nome do contato" autoFocus={isEdit}
                    value={manual.contactName} onChange={e => set("contactName", e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Telefone</label>
                  <Input className={`mt-1 ${travado}`} placeholder="(11) 99999-9999" disabled={isEdit}
                    value={manual.phone} onChange={e => set("phone", e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-700">E-mail</label>
                  <Input className={`mt-1 ${travado}`} placeholder="email@empresa.com" disabled={isEdit}
                    value={manual.email} onChange={e => set("email", e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-700">Endereço</label>
                  <Input className={`mt-1 ${travado}`} placeholder="Rua / Avenida" disabled={isEdit}
                    value={manual.address} onChange={e => set("address", e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Número</label>
                  <Input className={`mt-1 ${travado}`} placeholder="Número" disabled={isEdit}
                    value={manual.number} onChange={e => set("number", e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Complemento</label>
                  <Input className={`mt-1 ${travado}`} placeholder="Apto, sala..." disabled={isEdit}
                    value={manual.complement} onChange={e => set("complement", e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Bairro</label>
                  <Input className={`mt-1 ${travado}`} placeholder="Bairro" disabled={isEdit}
                    value={manual.neighborhood} onChange={e => set("neighborhood", e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">CEP</label>
                  <Input className={`mt-1 ${travado}`} placeholder="00000-000" maxLength={9} disabled={isEdit}
                    value={manual.zipCode} onChange={e => set("zipCode", e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Cidade</label>
                  <Input className={`mt-1 ${travado}`} placeholder="Cidade" disabled={isEdit}
                    value={manual.city} onChange={e => set("city", e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Estado (UF)</label>
                  <Input className={`mt-1 ${travado}`} placeholder="SP" maxLength={2} disabled={isEdit}
                    value={manual.state} onChange={e => set("state", e.target.value.toUpperCase())} />
                </div>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={onClose}>{isEdit ? "Fechar" : "Cancelar"}</Button>
                <Button onClick={handleManualConfirm} disabled={saving} className="bg-purple-600 hover:bg-purple-700">
                  {saving ? "Salvando..." : isEdit ? "Salvar contato" : "Confirmar e Salvar na Lista"}
                </Button>
              </div>
            </div>
          )}

          {/* ── Modo: Buscar na Lista #63 ── */}
          {mode === "list" && (
            <>
              <div className="flex gap-2">
                <Input
                  placeholder="Razão social da empresa no Bitrix..."
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleLoadList(query)}
                  autoFocus
                />
                <Button onClick={() => handleLoadList(query)} disabled={listLoading} className="shrink-0">
                  {listLoading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Search className="w-4 h-4 mr-1" />}
                  Buscar no Bitrix
                </Button>
              </div>

              {results.length > 0 && !query.trim() && (
                <p className="text-xs text-gray-400">
                  Primeiras {results.length} empresas da base. Digite para filtrar.
                </p>
              )}

              {results.length > 0 && (
                <div className="max-h-56 overflow-y-auto border rounded-lg divide-y">
                  {results.map(c => (
                    <button key={c.id} onClick={() => handleSelect(c)}
                      className={`w-full text-left px-3 py-2.5 hover:bg-purple-50 transition-colors ${selected?.id === c.id ? "bg-purple-50 font-medium" : ""}`}>
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-gray-500">
                        {c.detalhado
                          ? (c.cnpj || <span className="text-orange-500">CNPJ não cadastrado no Bitrix</span>)
                          : <span className="text-gray-400">clique para carregar CNPJ e endereço</span>}
                        {c.city ? ` · ${c.city}${c.state ? `/${c.state}` : ""}` : ""}
                      </p>
                    </button>
                  ))}
                </div>
              )}

              {selected && (
                <div className="border rounded-lg p-3 bg-purple-50 border-purple-200 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-purple-900 text-sm">{selected.name}</p>
                    {selected.id && (
                      <button
                        type="button"
                        onClick={() => abrirEmpresaBitrix(selected.id)}
                        title="Abrir a empresa no Bitrix para corrigir o cadastro"
                        className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-purple-600 hover:text-purple-800 underline underline-offset-2 decoration-dotted"
                      >
                        <ExternalLink className="w-3 h-3" /> Bitrix
                      </button>
                    )}
                  </div>
                  {detailLoading && (
                    <p className="text-xs text-purple-600 flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> buscando CNPJ, endereço e contato no Bitrix...
                    </p>
                  )}
                  {selected.cnpj
                    ? <p className="text-xs text-purple-700">CNPJ: {selected.cnpj}</p>
                    : !detailLoading && (
                        <p className="text-xs text-orange-600">
                          Sem CNPJ no requisito desta empresa no Bitrix — o envio ao Omie vai falhar.
                        </p>
                      )}
                  {selected.contactName && <p className="text-xs text-purple-700">Contato: {selected.contactName}</p>}
                  {!detailLoading && !selected.address && (
                    <p className="text-xs text-orange-600">
                      Sem endereço no Bitrix e sem retorno da Receita. Preencha no cadastro da
                      empresa no Bitrix antes de enviar ao Omie.
                    </p>
                  )}
                  {selected.address && (
                    <p className="text-xs text-purple-600">
                      {selected.address}{selected.number ? `, ${selected.number}` : ""}
                      {selected.neighborhood ? ` — ${selected.neighborhood}` : ""}
                    </p>
                  )}
                  {selected.city && (
                    <p className="text-xs text-purple-600">
                      {selected.city}{selected.state ? `/${selected.state}` : ""}
                      {selected.zipCode ? ` — CEP ${selected.zipCode}` : ""}
                    </p>
                  )}
                </div>
              )}

              {selected && <OmieLimitAlert company={selected} variant="inline" />}

              {error && <p className="text-sm text-amber-600">{error}</p>}


              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={onClose}>Cancelar</Button>
                <Button onClick={handleListConfirm} disabled={!selected || detailLoading}
                  className="bg-purple-600 hover:bg-purple-700">
                  Confirmar
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Seletor de produtos de um fornecedor para um cliente ─────────────────────
function SupplierProductSelector({
  group, gIdx, customerIndex, allocations, allCustomers, basePath, form,
  getMyAllocation, getOthersAllocation, setAllocation,
}: {
  group: any
  gIdx: number
  customerIndex: number
  allocations: any[]
  allCustomers: any[]
  basePath: string
  form: any
  getMyAllocation: (groupLocalId: string, pIdx: number) => number
  getOthersAllocation: (groupLocalId: string, pIdx: number) => number
  setAllocation: (groupLocalId: string, productIndex: number, partnumber: string, description: string, quantity: number, unitSale?: number) => void
}) {
  const [selectionOpen, setSelectionOpen] = useState(false)

  const isSelected = (pIdx: number) =>
    allocations.some(x => x.groupLocalId === group.localId && x.productIndex === pIdx)

  const toggleProduct = (pIdx: number, product: any) => {
    const current: any[] = form.getValues(`${basePath}.productAllocations`) || []
    const existingIdx = current.findIndex(x => x.groupLocalId === group.localId && x.productIndex === pIdx)
    if (existingIdx >= 0) {
      form.setValue(`${basePath}.productAllocations`, current.filter((_: any, i: number) => i !== existingIdx))
    } else {
      form.setValue(`${basePath}.productAllocations`, [...current, {
        groupLocalId: group.localId,
        productIndex: pIdx,
        partnumber: product.partnumber,
        description: product.description || "",
        quantity: 0,
        unitSale: 0,
        totalSale: 0,
      }])
    }
  }

  const selectedCount = group.products.filter((_: any, pIdx: number) => isSelected(pIdx)).length

  return (
    <div className="pl-7 space-y-2">
      {/* Botão para abrir/fechar seleção */}
      <button
        type="button"
        onClick={() => setSelectionOpen(o => !o)}
        className="flex items-center gap-1.5 text-xs text-purple-600 hover:text-purple-800 font-medium py-1"
      >
        <Plus className="w-3.5 h-3.5" />
        {selectedCount === 0
          ? "Escolher produtos do fornecedor"
          : `${selectedCount} produto(s) selecionado(s) — editar seleção`}
      </button>

      {/* Checklist de seleção */}
      {selectionOpen && (
        <div className="border rounded-lg bg-white divide-y">
          {group.products.map((product: any, pIdx: number) => {
            const selected = isSelected(pIdx)
            const supplierQty = product.quantity || 0
            const othersQty = getOthersAllocation(group.localId, pIdx)
            const available = Math.max(0, supplierQty - othersQty)
            return (
              <label
                key={pIdx}
                className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-purple-50 transition-colors ${selected ? "bg-purple-50/60" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleProduct(pIdx, product)}
                  className="w-4 h-4 accent-purple-600 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">{product.partnumber}</p>
                  <p className="text-[11px] text-gray-500 truncate">{product.description}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[11px] text-gray-600">Disp: <span className="font-semibold">{available}</span></p>
                  {othersQty > 0 && <p className="text-[10px] text-orange-500">{othersQty} já alocado(s)</p>}
                </div>
              </label>
            )
          })}
        </div>
      )}

      {/* Produtos selecionados com inputs de qtd e preço */}
      {selectedCount > 0 && (
        <div className="space-y-1">
          <div className="grid grid-cols-12 gap-2 px-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
            <div className="col-span-4">Produto</div>
            <div className="col-span-1 text-center">Total</div>
            <div className="col-span-1 text-center">Outros</div>
            <div className="col-span-2 text-center">Qtd</div>
            <div className="col-span-4">Preço Venda (R$)</div>
          </div>

          {allocations
            .filter(a => a.groupLocalId === group.localId)
            .map(alloc => {
              const product = group.products[alloc.productIndex]
              if (!product) return null
              const pIdx = alloc.productIndex
              const supplierQty = product.quantity || 0
              const othersQty = getOthersAllocation(group.localId, pIdx)
              const maxCanTake = Math.max(0, supplierQty - othersQty)
              const myQty = alloc.quantity || 0
              const myUnitSale = alloc.unitSale || 0
              const isOver = myQty > maxCanTake

              return (
                <div
                  key={pIdx}
                  className={`grid grid-cols-12 gap-2 items-center p-2 border rounded-lg bg-white text-sm ${isOver ? "border-red-300 bg-red-50" : ""}`}
                >
                  <div className="col-span-4">
                    <p className="font-medium text-xs truncate">{product.partnumber}</p>
                    <p className="text-[11px] text-gray-500 truncate">{product.description}</p>
                  </div>
                  <div className="col-span-1 text-center">
                    <span className="text-xs font-semibold text-gray-700">{supplierQty}</span>
                  </div>
                  <div className="col-span-1 text-center">
                    {othersQty > 0
                      ? <span className="text-xs font-semibold text-orange-600">{othersQty}</span>
                      : <span className="text-xs text-gray-300">—</span>}
                  </div>
                  <div className="col-span-2 flex items-center gap-1">
                    <Input
                      type="number" min={0} max={maxCanTake}
                      className={`h-7 text-xs text-center ${isOver ? "border-red-400" : ""}`}
                      value={myQty > 0 ? myQty : ""}
                      placeholder="0"
                      onChange={e => {
                        const raw = parseInt(e.target.value) || 0
                        const val = Math.min(Math.max(0, raw), maxCanTake)
                        setAllocation(group.localId, pIdx, product.partnumber, product.description || "", val)
                      }}
                    />
                    {maxCanTake > 0 && myQty < maxCanTake && (
                      <button
                        type="button"
                        title={`Alocar todos os ${maxCanTake}`}
                        className="text-[11px] text-blue-500 hover:text-blue-700 whitespace-nowrap shrink-0 font-medium"
                        onClick={() => setAllocation(group.localId, pIdx, product.partnumber, product.description || "", maxCanTake)}
                      >✓</button>
                    )}
                  </div>
                  <div className="col-span-4 flex items-center gap-1">
                    <CurrencyInput
                      className="h-7 text-xs"
                      placeholder="0,00"
                      value={myUnitSale}
                      resetKey={`${group.localId}:${pIdx}:${myUnitSale}`}
                      onChange={val => setAllocation(group.localId, pIdx, product.partnumber, product.description || "", myQty, val)}
                    />
                    {myQty > 0 && myUnitSale > 0 && (
                      <span className="text-[10px] text-gray-500 whitespace-nowrap shrink-0">
                        = {formatCurrency(myQty * myUnitSale)}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
        </div>
      )}
    </div>
  )
}

// ── Card de um cliente ────────────────────────────────────────────────────────
function CustomerCard({
  customerIndex,
  form,
  supplierGroups,
  allCustomers,
  onRemove,
  onEdit,
}: {
  customerIndex: number
  form: UseFormReturn<any>
  supplierGroups: any[]
  allCustomers: any[]
  onRemove: () => void
  onEdit: () => void
}) {
  const [expanded, setExpanded] = useState(true)

  const basePath = `customers.${customerIndex}`
  const customer = form.watch(`${basePath}.customer`)
  const allocations: any[] = form.watch(`${basePath}.productAllocations`) || []
  // Clientes ES só veem fornecedores ES; clientes Barueri só veem fornecedores Barueri
  // A filial da venda e derivada de onde o produto foi comprado, entao o cliente
  // enxerga todos os fornecedores — inclusive de filiais diferentes, que geram
  // uma OV por empresa.
  const visibleSupplierGroups = supplierGroups

  // Filiais efetivamente usadas por este cliente, a partir das alocacoes.
  const filiaisDoCliente: string[] = [...new Set(
    (allocations || [])
      .filter((a: any) => Number(a.quantity) > 0)
      .map((a: any) => {
        const g = supplierGroups.find((x: any) => x.localId === a.groupLocalId)
        return (g?.branch === 'es' ? 'es' : 'barueri')
      }),
  )]

  // Retorna a quantidade alocada por ESTE cliente para um produto específico
  const getMyAllocation = (groupLocalId: string, productIndex: number): number => {
    const a = allocations.find(
      x => x.groupLocalId === groupLocalId && x.productIndex === productIndex
    )
    return a?.quantity || 0
  }

  // Retorna a soma das quantidades alocadas pelos OUTROS clientes para um produto específico
  const getOthersAllocation = (groupLocalId: string, productIndex: number): number => {
    return allCustomers.reduce((sum: number, c: any, cIdx: number) => {
      if (cIdx === customerIndex) return sum
      const cAllocs: any[] = c.productAllocations || []
      const a = cAllocs.find(
        x => x.groupLocalId === groupLocalId && x.productIndex === productIndex
      )
      return sum + (a?.quantity || 0)
    }, 0)
  }

  // Atualiza a alocação deste cliente para um produto específico
  const setAllocation = (
    groupLocalId: string,
    productIndex: number,
    partnumber: string,
    description: string,
    quantity: number,
    unitSale?: number
  ) => {
    const current: any[] = form.getValues(`${basePath}.productAllocations`) || []
    const idx = current.findIndex(
      x => x.groupLocalId === groupLocalId && x.productIndex === productIndex
    )
    const existing = idx >= 0 ? current[idx] : {}
    const resolvedUnitSale = unitSale !== undefined ? unitSale : (existing.unitSale || 0)
    const entry = {
      groupLocalId, productIndex, partnumber, description, quantity,
      unitSale: resolvedUnitSale,
      totalSale: resolvedUnitSale * quantity,
    }
    const next = idx >= 0
      ? current.map((x, i) => (i === idx ? entry : x))
      : [...current, entry]
    form.setValue(`${basePath}.productAllocations`, next)
  }

  /**
   * Volta do Bitrix com o cadastro atualizado.
   *
   * O slider do BX24 avisa quando fecha; sem recarregar, o app seguiria com os
   * dados de antes da correção. Contato e PO ficam como estão: são digitados
   * aqui e não vêm do Bitrix.
   */
  const recarregarDoBitrix = async () => {
    const id = Number(customer?.bitrixCompanyId)
    if (!id) return
    const { success, ...dados } = await getBitrixCompanyDetailsAction(id)
    if (!success || !dados.name) return
    form.setValue(`${basePath}.customer`, {
      ...customer, ...dados,
      contactName:   customer?.contactName || dados.contactName || "",
      purchaseOrder: customer?.purchaseOrder ?? "",
    }, { shouldDirty: true })
    toast.success("Cadastro recarregado do Bitrix.")
  }

  const contactMissing = !String(customer?.contactName ?? '').trim()
  // Cadastro acima do limite do Omie faz o envio parar no cadastro do cliente.
  const camposForaDoLimite = camposExcedidos(customer)

  const allocatedCount = allocations.filter(a => a.quantity > 0).length
  const totalUnits = allocations.reduce((s, a) => s + (a.quantity || 0), 0)
  const totalSaleValue = allocations.reduce((s, a) => s + (a.totalSale || 0), 0)

  return (
    <div className="border rounded-xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-purple-50 border-b border-purple-100">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">
            {customerIndex + 1}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-semibold text-purple-900">{customer?.name || "Cliente"}</p>
              {/* Abre a ficha da empresa no Bitrix num slider por cima do app:
                  o cadastro se corrige lá, e o formulário continua aberto. */}
              {customer?.bitrixCompanyId && (
                <button
                  type="button"
                  onClick={() => abrirEmpresaBitrix(customer.bitrixCompanyId, recarregarDoBitrix)}
                  title="Abrir a empresa no Bitrix para editar o cadastro"
                  className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-purple-600 hover:text-purple-800 underline underline-offset-2 decoration-dotted"
                >
                  <ExternalLink className="w-3 h-3" /> Bitrix
                </button>
              )}
              {filiaisDoCliente.length === 0 ? (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border bg-gray-100 text-gray-500 border-gray-300">
                  sem alocação
                </span>
              ) : filiaisDoCliente.map((f: string) => (
                <span key={f} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                  f === 'es'
                    ? 'bg-green-100 text-green-700 border-green-300'
                    : 'bg-blue-100 text-blue-700 border-blue-300'
                }`}>
                  {f === 'es' ? 'Fatura ES' : 'Fatura Barueri'}
                </span>
              ))}
            </div>
            <p className="text-xs text-purple-600">
              {customer?.cnpj}
              {customer?.city && ` — ${customer.city}/${customer.state}`}
              {" · "}
              <span className={allocatedCount === 0 ? "text-red-500 font-medium" : "text-purple-600"}>
                {allocatedCount === 0
                  ? "Nenhum produto alocado"
                  : `${allocatedCount} produto(s) · ${totalUnits} un · Total venda: ${formatCurrency(totalSaleValue)}`}
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button" size="sm" variant="ghost"
            className="h-8 text-purple-600 hover:bg-purple-100"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
          <Button
            type="button" size="sm" variant="ghost"
            className="h-8 text-purple-500 hover:text-purple-700 hover:bg-purple-100"
            onClick={onEdit}
            title="Ver dados do cliente (só o contato é editável)"
          >
            <Eye className="w-4 h-4" />
          </Button>
          <Button
            type="button" size="sm" variant="ghost"
            className="h-8 text-red-400 hover:text-red-600 hover:bg-red-50"
            onClick={onRemove}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {camposForaDoLimite.length > 0 && (
        <div className="px-4 pt-3">
          <OmieLimitAlert company={customer} />
        </div>
      )}

      {/* Contato do cliente — obrigatório para avançar */}
      <div className={`px-4 py-2.5 border-b flex items-center gap-3 ${
        contactMissing ? 'bg-red-50 border-red-100' : 'bg-white border-gray-100'
      }`}>
        <label className={`text-[11px] font-semibold uppercase shrink-0 ${
          contactMissing ? 'text-red-600' : 'text-gray-500'
        }`}>
          Contato {contactMissing && '*'}
        </label>
        <Input
          className={`h-7 text-xs max-w-xs ${contactMissing ? 'border-red-300 focus-visible:ring-red-400' : ''}`}
          placeholder="Nome do contato no cliente"
          value={customer?.contactName || ""}
          onChange={e => form.setValue(`${basePath}.customer.contactName`, e.target.value)}
        />
        {contactMissing && (
          <span className="text-[11px] text-red-600">
            Obrigatório — o Bitrix não trouxe contato para este cliente.
          </span>
        )}
      </div>

      {/* Cadastro do cliente — só consulta. Vem do Bitrix e se corrige lá; o
          contato é a exceção, na barra acima. */}
      <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/60">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-[11px] font-semibold uppercase text-gray-500">Cadastro (Bitrix)</span>
          <span className="text-[10px] text-gray-400">somente leitura</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1.5">
          {[
            { rotulo: 'Razão Social',       valor: customer?.name },
            { rotulo: 'CNPJ',               valor: customer?.cnpj },
            { rotulo: 'Inscrição Estadual', valor: customer?.stateRegistration },
            { rotulo: 'Contribuinte',       valor: customer?.isTaxpayer ? 'Sim' : 'Não' },
            { rotulo: 'Endereço',           valor: [customer?.address, customer?.number].filter(Boolean).join(', ') },
            { rotulo: 'Complemento',        valor: customer?.complement },
            { rotulo: 'Bairro',             valor: customer?.neighborhood },
            { rotulo: 'CEP',                valor: customer?.zipCode },
            { rotulo: 'Cidade / UF',        valor: [customer?.city, customer?.state].filter(Boolean).join('/') },
            { rotulo: 'Telefone',           valor: customer?.phone },
            { rotulo: 'E-mail',             valor: customer?.email },
          ].map(c => (
            <div key={c.rotulo} className="min-w-0">
              <p className="text-[10px] uppercase tracking-wide text-gray-400">{c.rotulo}</p>
              <p className="text-xs text-gray-700 truncate" title={String(c.valor ?? '')}>
                {String(c.valor ?? '').trim() || <span className="text-gray-300">—</span>}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Numero do pedido do cliente enviado ao Omie: e o numero do negocio,
          nao um campo digitado. Mostrado aqui so para conferencia. */}
      <div className="px-4 py-2 border-b border-gray-100 bg-white flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase shrink-0 text-gray-500">
          Pedido do cliente
        </span>
        <span className="text-xs font-medium text-gray-700">
          {form.watch("business.commercialProposal") || "—"}
        </span>
        <span className="text-[11px] text-gray-400">
          número do negócio · vai para o Omie como "Número do Pedido do cliente"
        </span>
      </div>

      {/* PO informada pelo cliente. Diferente do "Pedido do cliente" acima:
          este é o dado que o cliente mandou (número da PO, e-mail de quem
          informou etc.) e sai só na planilha da OC, no campo "Pedido do
          cliente" do modelo. Não é enviado ao Omie. */}
      <div className="px-4 py-2 border-b border-gray-100 bg-white flex items-center gap-2">
        <label className="text-[11px] font-semibold uppercase shrink-0 text-gray-500">
          PO do cliente
        </label>
        <Input
          className="h-7 text-xs flex-1 max-w-md"
          placeholder="Número da PO, e-mail que informou, etc."
          value={customer?.purchaseOrder || ""}
          onChange={e => form.setValue(`${basePath}.customer.purchaseOrder`, e.target.value, { shouldDirty: true })}
        />
        <span className="text-[11px] text-gray-400 hidden sm:inline">sai na planilha da OC</span>
      </div>

      {/* Alocação de produtos por fornecedor */}
      {expanded && (
        <div className="p-4 bg-gray-50 space-y-4">
          {visibleSupplierGroups.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">
              {supplierGroups.length === 0
                ? "Adicione fornecedores na aba anterior para alocar produtos aqui."
                : "Nenhum fornecedor adicionado."}
            </p>
          ) : (
            visibleSupplierGroups.map((group: any, gIdx: number) => (
              <div key={group.localId} className="space-y-2">
                {/* Cabeçalho do grupo de fornecedor */}
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 bg-blue-600 rounded flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                    {gIdx + 1}
                  </div>
                  <p className="text-sm font-semibold text-blue-800">
                    {group.supplier?.name || `Fornecedor ${gIdx + 1}`}
                  </p>
                </div>

                {(!group.products || group.products.length === 0) ? (
                  <p className="text-xs text-gray-400 pl-7">Sem produtos neste grupo</p>
                ) : (
                  <SupplierProductSelector
                    group={group}
                    gIdx={gIdx}
                    customerIndex={customerIndex}
                    allocations={allocations}
                    allCustomers={allCustomers}
                    basePath={basePath}
                    form={form}
                    getMyAllocation={getMyAllocation}
                    getOthersAllocation={getOthersAllocation}
                    setAllocation={setAllocation}
                  />
                )}
              </div>
            ))
          )}

          {/* Resumo total do cliente */}
          {totalUnits > 0 && (
            <div className="border-t pt-3 flex justify-between items-center">
              <span className="text-xs text-gray-500">Total alocado para este cliente:</span>
              <Badge variant="outline" className="text-purple-700 border-purple-300">
                {totalUnits} un · {allocatedCount} produto(s) · Venda: {formatCurrency(totalSaleValue)}
              </Badge>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Tab principal ─────────────────────────────────────────────────────────────
export function CustomersTab({ form }: CustomersTabProps) {
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)

  const { fields: customerFields, append: appendCustomer, remove: removeCustomer } = useFieldArray({
    control: form.control,
    name: "customers",
  })

  const supplierGroups = form.watch("supplierGroups") || []
  const allCustomers   = form.watch("customers") || []

  /**
   * Depois de escolhido, o cliente vira consulta: razão social, CNPJ, endereço e
   * o resto vêm do Bitrix e só se corrigem lá. Aqui só o contato muda, que é o
   * dado que o Bitrix costuma não ter.
   */
  const handleEditCustomer = (company: any) => {
    if (editingIdx === null) return
    const current = form.getValues(`customers.${editingIdx}`)
    form.setValue(`customers.${editingIdx}`, {
      ...current,
      customer: { ...current.customer, contactName: company.contactName || "" },
    }, { shouldDirty: true })
    setEditingIdx(null)
  }

  const handleAddCustomer = (company: any) => {
    appendCustomer({
      localId: crypto.randomUUID(),
      branch:  company.branch || 'barueri',
      customer: {
        bitrixCompanyId:   Number(company.id) || undefined,
        cnpj:              company.cnpj,
        name:              company.name,
        stateRegistration: company.stateRegistration || "",
        zipCode:           company.zipCode || "",
        city:              company.city || "",
        state:             company.state || "",
        neighborhood:      company.neighborhood || "",
        address:           company.address || "",
        number:            company.number || "",
        complement:        company.complement || "",
        contactName:       company.contactName || "",
        phone:             company.phone || "",
        email:             company.email || "",
        isTaxpayer:        false,
        purchaseOrder:     "",
      },
      productAllocations: [],
    })
  }

  // Resumo: OC e OV
  const uniqueSuppliers = supplierGroups.length
  const uniqueCustomers = customerFields.length

  // Uma OV por cliente E por filial: o mesmo cliente gera dois pedidos quando
  // recebe produtos comprados em filiais diferentes.
  const totalOVs = allCustomers.reduce((soma: number, c: any) => {
    const filiais = new Set(
      (c.productAllocations ?? [])
        .filter((a: any) => Number(a.quantity) > 0)
        .map((a: any) => {
          const g = supplierGroups.find((x: any) => x.localId === a.groupLocalId)
          return g?.branch === 'es' ? 'es' : 'barueri'
        }),
    )
    return soma + filiais.size
  }, 0)

  // Total de unidades disponíveis vs alocadas
  const totalSupplierUnits = supplierGroups.reduce((sum: number, g: any) =>
    sum + (g.products || []).reduce((s: number, p: any) => s + (p.quantity || 0), 0), 0)
  const totalAllocatedUnits = allCustomers.reduce((sum: number, c: any) =>
    sum + (c.productAllocations || []).reduce((s: number, a: any) => s + (a.quantity || 0), 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Clientes / Filiais</h2>
          <p className="text-sm text-gray-500">
            O cliente do negócio já vem selecionado. Use "Adicionar Filial" quando o
            negócio atender mais de uma filial do mesmo cliente.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => setCustomerDialogOpen(true)}
          className="gap-2 bg-purple-600 hover:bg-purple-700"
        >
          <Plus className="w-4 h-4" /> Adicionar Filial
        </Button>
      </div>

      {/* Resumo de OC/OV + unidades */}
      {(uniqueSuppliers > 0 || uniqueCustomers > 0) && (
        <div className="grid grid-cols-3 gap-3">
          <div className="border rounded-lg p-3 bg-blue-50 border-blue-200 text-center">
            <p className="text-2xl font-bold text-blue-700">{uniqueSuppliers}</p>
            <p className="text-sm text-blue-600">Ordem(ns) de Compra</p>
            <p className="text-xs text-blue-500 mt-0.5">1 OC por fornecedor</p>
          </div>
          <div className="border rounded-lg p-3 bg-purple-50 border-purple-200 text-center">
            <p className="text-2xl font-bold text-purple-700">{totalOVs || uniqueCustomers}</p>
            <p className="text-sm text-purple-600">Ordem(ns) de Venda</p>
            <p className="text-xs text-purple-500 mt-0.5">1 OV por cliente e por filial</p>
          </div>
          {totalSupplierUnits > 0 && (
            <div className={`border rounded-lg p-3 text-center ${
              totalAllocatedUnits === totalSupplierUnits
                ? "bg-green-50 border-green-200"
                : totalAllocatedUnits > totalSupplierUnits
                ? "bg-red-50 border-red-200"
                : "bg-yellow-50 border-yellow-200"
            }`}>
              <p className={`text-2xl font-bold ${
                totalAllocatedUnits === totalSupplierUnits
                  ? "text-green-700"
                  : totalAllocatedUnits > totalSupplierUnits
                  ? "text-red-700"
                  : "text-yellow-700"
              }`}>
                {totalAllocatedUnits}/{totalSupplierUnits}
              </p>
              <p className={`text-sm ${
                totalAllocatedUnits === totalSupplierUnits ? "text-green-600" : "text-yellow-600"
              }`}>Unidades alocadas</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {totalSupplierUnits - totalAllocatedUnits > 0
                  ? `${totalSupplierUnits - totalAllocatedUnits} sem destino`
                  : totalAllocatedUnits === totalSupplierUnits
                  ? "Tudo alocado!"
                  : "Excedeu o estoque"}
              </p>
            </div>
          )}
        </div>
      )}

      {customerFields.length === 0 && (
        <div className="border-2 border-dashed rounded-xl p-12 text-center text-gray-400">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Nenhum cliente adicionado</p>
          <p className="text-sm mt-1">Clique em "Adicionar Filial" para buscar no Bitrix</p>
        </div>
      )}

      <div className="space-y-4">
        {customerFields.map((_, cIdx) => (
          <CustomerCard
            key={cIdx}
            customerIndex={cIdx}
            form={form}
            supplierGroups={supplierGroups}
            allCustomers={allCustomers}
            onRemove={() => removeCustomer(cIdx)}
            onEdit={() => setEditingIdx(cIdx)}
          />
        ))}
      </div>

      <CustomerDialog
        open={customerDialogOpen}
        onClose={() => setCustomerDialogOpen(false)}
        onConfirm={handleAddCustomer}
      />
      <CustomerDialog
        open={editingIdx !== null}
        onClose={() => setEditingIdx(null)}
        onConfirm={handleEditCustomer}
        isEdit
        initialData={editingIdx !== null ? {
          ...form.getValues(`customers.${editingIdx}.customer`),
          branch: form.getValues(`customers.${editingIdx}.branch`) || 'barueri',
        } : undefined}
      />
    </div>
  )
}

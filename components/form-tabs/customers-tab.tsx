"use client"

import { useState, useEffect } from "react"
import { useFieldArray, type UseFormReturn } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Trash2, Plus, Search, Users, Building2, ChevronDown, ChevronUp, Pencil, Loader2 } from "lucide-react"
import { getBitrixClientsAction, createBitrixClientAction, lookupCnpjAction } from "@/lib/actions"
import { isCNPJComplete, formatCNPJ, formatCurrency } from "@/lib/utils"
import { CurrencyInput } from "@/components/ui/currency-input"
import { toast } from "sonner"

interface CustomersTabProps {
  form: UseFormReturn<any>
}

const emptyCustomer = {
  name: "", cnpj: "", stateRegistration: "", email: "", phone: "",
  address: "", number: "", complement: "", neighborhood: "",
  city: "", state: "", zipCode: "", contactName: "",
}

// ── Diálogo: adicionar cliente manualmente ou buscar da lista #63 ─────────────
// Exportado para o step de Cliente Serviço (SRV) reusar a mesma seleção de empresa.
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
  const [mode, setMode] = useState<"manual" | "list">("manual")
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
      if (!isEdit) setMode("manual")
    }
  }, [open])

  // modo lista
  const [query, setQuery] = useState("")
  const [listLoading, setListLoading] = useState(false)
  const [results, setResults] = useState<any[]>([])
  const [selected, setSelected] = useState<any>(null)

  const handleLoadList = async (q = "") => {
    setListLoading(true); setError(""); setResults([]); setSelected(null)
    const data = await getBitrixClientsAction(q)
    setListLoading(false)
    if (!data.length) {
      setError(q ? "Nenhum cliente encontrado." : "Nenhum cliente cadastrado ainda.")
      return
    }
    setResults(data)
  }

  useEffect(() => {
    if (open && mode === "list") handleLoadList("")
  }, [open, mode])

  const handleModeChange = (m: "manual" | "list") => {
    setMode(m); setError(""); setSelected(null); setResults([])
    if (m === "list") handleLoadList("")
  }

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
    if (manual.cnpj.trim() && !isCNPJComplete(manual.cnpj)) {
      setError("CNPJ inválido — deve ter 12 a 14 dígitos"); return
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
            {isEdit ? "Editar Cliente / Filial" : "Adicionar Cliente / Filial"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Seletor de modo — oculto no modo edição */}
          {!isEdit && (
            <div className="flex gap-2">
              <button onClick={() => handleModeChange("manual")}
                className={`px-3 py-1.5 text-sm rounded border transition-colors ${mode === "manual" ? "bg-purple-600 text-white border-purple-600" : "text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
                Adicionar Manualmente
              </button>
              <button onClick={() => handleModeChange("list")}
                className={`px-3 py-1.5 text-sm rounded border transition-colors ${mode === "list" ? "bg-purple-600 text-white border-purple-600" : "text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
                Buscar na Lista
              </button>
            </div>
          )}

          {/* ── Modo: Manual ── */}
          {mode === "manual" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-700">Razão Social *</label>
                  <Input className="mt-1" placeholder="Nome / Razão Social" autoFocus
                    value={manual.name} onChange={e => set("name", e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">
                    CNPJ {cepLoading && <span className="text-purple-500 font-normal">buscando...</span>}
                  </label>
                  <div className="flex gap-1 mt-1">
                    <Input className="flex-1" placeholder="00.000.000/0000-00"
                      value={manual.cnpj}
                      onChange={e => handleCnpjChange(e.target.value)}
                      disabled={cepLoading}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0 px-2"
                      disabled={cepLoading || manual.cnpj.replace(/\D/g, '').length !== 14}
                      onClick={() => triggerCnpjLookup(manual.cnpj.replace(/\D/g, ''))}
                      title="Buscar dados do CNPJ"
                    >
                      {cepLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Inscrição Estadual</label>
                  <Input className="mt-1" placeholder="IE"
                    value={manual.stateRegistration} onChange={e => set("stateRegistration", e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Contato</label>
                  <Input className="mt-1" placeholder="Nome do contato"
                    value={manual.contactName} onChange={e => set("contactName", e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Telefone</label>
                  <Input className="mt-1" placeholder="(11) 99999-9999"
                    value={manual.phone} onChange={e => set("phone", e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-700">E-mail</label>
                  <Input className="mt-1" placeholder="email@empresa.com"
                    value={manual.email} onChange={e => set("email", e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-700">Endereço</label>
                  <Input className="mt-1" placeholder="Rua / Avenida"
                    value={manual.address} onChange={e => set("address", e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Número</label>
                  <Input className="mt-1" placeholder="Número"
                    value={manual.number} onChange={e => set("number", e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Complemento</label>
                  <Input className="mt-1" placeholder="Apto, sala..."
                    value={manual.complement} onChange={e => set("complement", e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Bairro</label>
                  <Input className="mt-1" placeholder="Bairro"
                    value={manual.neighborhood} onChange={e => set("neighborhood", e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">CEP</label>
                  <Input className="mt-1" placeholder="00000-000" maxLength={9}
                    value={manual.zipCode} onChange={e => set("zipCode", e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Cidade</label>
                  <Input className="mt-1" placeholder="Cidade"
                    value={manual.city} onChange={e => set("city", e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Estado (UF)</label>
                  <Input className="mt-1" placeholder="SP" maxLength={2}
                    value={manual.state} onChange={e => set("state", e.target.value.toUpperCase())} />
                </div>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              {/* Filial Interatell */}
              <div className="border rounded-lg p-3 bg-gray-50">
                <p className="text-xs font-semibold text-gray-700 mb-2">Filial Interatell *</p>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={branch === 'barueri'} onChange={() => setBranch('barueri')} className="accent-purple-600" />
                    <span className="text-sm">Barueri (SP)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={branch === 'es'} onChange={() => setBranch('es')} className="accent-purple-600" />
                    <span className="text-sm">Serra (ES)</span>
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={onClose}>Cancelar</Button>
                <Button onClick={handleManualConfirm} disabled={saving} className="bg-purple-600 hover:bg-purple-700">
                  {saving ? "Salvando..." : isEdit ? "Salvar Alterações" : "Confirmar e Salvar na Lista"}
                </Button>
              </div>
            </div>
          )}

          {/* ── Modo: Buscar na Lista #63 ── */}
          {mode === "list" && (
            <>
              <div className="flex gap-2">
                <Input
                  placeholder="Filtrar por nome ou CNPJ..."
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleLoadList(query)}
                  autoFocus
                />
                <Button onClick={() => handleLoadList(query)} disabled={listLoading} className="shrink-0">
                  <Search className="w-4 h-4 mr-1" />{listLoading ? "..." : "Buscar"}
                </Button>
              </div>

              {results.length > 0 && (
                <div className="max-h-56 overflow-y-auto border rounded-lg divide-y">
                  {results.map(c => (
                    <button key={c.id} onClick={() => setSelected(c)}
                      className={`w-full text-left px-3 py-2.5 hover:bg-purple-50 transition-colors ${selected?.id === c.id ? "bg-purple-50 font-medium" : ""}`}>
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-gray-500">
                        {c.cnpj || <span className="text-orange-500">CNPJ não cadastrado</span>}
                        {c.city ? ` · ${c.city}${c.state ? `/${c.state}` : ""}` : ""}
                      </p>
                    </button>
                  ))}
                </div>
              )}

              {selected && (
                <div className="border rounded-lg p-3 bg-purple-50 border-purple-200 space-y-0.5">
                  <p className="font-semibold text-purple-900 text-sm">{selected.name}</p>
                  {selected.cnpj && <p className="text-xs text-purple-700">CNPJ: {selected.cnpj}</p>}
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

              {error && <p className="text-sm text-amber-600">{error}</p>}

              {/* Filial Interatell */}
              <div className="border rounded-lg p-3 bg-gray-50">
                <p className="text-xs font-semibold text-gray-700 mb-2">Filial Interatell *</p>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={branch === 'barueri'} onChange={() => setBranch('barueri')} className="accent-purple-600" />
                    <span className="text-sm">Barueri (SP)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={branch === 'es'} onChange={() => setBranch('es')} className="accent-purple-600" />
                    <span className="text-sm">Serra (ES)</span>
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={onClose}>Cancelar</Button>
                <Button onClick={handleListConfirm} disabled={!selected} className="bg-purple-600 hover:bg-purple-700">
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
  const customerBranch: string = form.watch(`${basePath}.branch`) || 'barueri'
  const allocations: any[] = form.watch(`${basePath}.productAllocations`) || []
  // Clientes ES só veem fornecedores ES; clientes Barueri só veem fornecedores Barueri
  const visibleSupplierGroups = supplierGroups.filter((g: any) => (g.branch || 'barueri') === customerBranch)

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
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                customerBranch === 'es'
                  ? 'bg-green-100 text-green-700 border-green-300'
                  : 'bg-blue-100 text-blue-700 border-blue-300'
              }`}>
                {customerBranch === 'es' ? 'Serra/ES' : 'Barueri/SP'}
              </span>
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
            title="Editar cliente"
          >
            <Pencil className="w-4 h-4" />
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

      {/* Alocação de produtos por fornecedor */}
      {expanded && (
        <div className="p-4 bg-gray-50 space-y-4">
          {visibleSupplierGroups.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">
              {supplierGroups.length === 0
                ? "Adicione fornecedores na aba anterior para alocar produtos aqui."
                : `Nenhum fornecedor da filial ${customerBranch === 'es' ? 'Serra/ES' : 'Barueri/SP'} adicionado.`}
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

  const handleEditCustomer = (company: any) => {
    if (editingIdx === null) return
    const current = form.getValues(`customers.${editingIdx}`)
    form.setValue(`customers.${editingIdx}`, {
      ...current,
      branch: company.branch || current.branch || 'barueri',
      customer: {
        ...current.customer,
        name:              company.name,
        cnpj:              company.cnpj,
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
      },
    })
    setEditingIdx(null)
  }

  const handleAddCustomer = (company: any) => {
    appendCustomer({
      localId: crypto.randomUUID(),
      branch:  company.branch || 'barueri',
      customer: {
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
            Para cada cliente, defina quantas unidades de cada produto ele irá receber.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => setCustomerDialogOpen(true)}
          className="gap-2 bg-purple-600 hover:bg-purple-700"
        >
          <Plus className="w-4 h-4" /> Adicionar Cliente
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
            <p className="text-2xl font-bold text-purple-700">{uniqueCustomers}</p>
            <p className="text-sm text-purple-600">Ordem(ns) de Venda</p>
            <p className="text-xs text-purple-500 mt-0.5">1 OV por cliente</p>
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
          <p className="text-sm mt-1">Clique em "Adicionar Cliente" para começar</p>
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

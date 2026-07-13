"use client"

import { useState, useEffect, useRef } from "react"
import { useFieldArray, type UseFormReturn } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Trash2, Plus, Search, Package, ChevronDown, ChevronUp, Building2, Pencil } from "lucide-react"
import { getBitrixSuppliersAction, searchBitrixProductsAction, searchProductsAction, getBitrixFamiliesFullAction } from "@/lib/actions"
import { formatCurrency, isCNPJComplete, formatCNPJ } from "@/lib/utils"
import { CurrencyInput } from "@/components/ui/currency-input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { states } from "@/lib/utils"

interface SupplierGroupsTabProps {
  form: UseFormReturn<any>
}

// ── Diálogo: buscar fornecedor na lista cadastrada ou por CNPJ ───────────────
function SupplierDialog({
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
  const emptyManual = {
    name: "", cnpj: "", stateRegistration: "",
    zipCode: "", city: "", state: "",
    neighborhood: "", address: "", number: "", complement: "",
    contactName: "", phone: "", email: "",
  }

  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [results, setResults] = useState<any[]>([])
  const [selected, setSelected] = useState<any>(null)
  const [cnpjOverride, setCnpjOverride] = useState("")
  const [manual, setManual] = useState<typeof emptyManual>(isEdit && initialData ? { ...emptyManual, ...initialData } : emptyManual)
  const [mode, setMode] = useState<"list" | "manual">(isEdit ? "manual" : "list")
  const [branch, setBranch] = useState<'barueri' | 'es'>(initialData?.branch === 'es' ? 'es' : 'barueri')

  useEffect(() => {
    if (open) {
      setManual(isEdit && initialData ? { ...emptyManual, ...initialData } : emptyManual)
      setBranch(initialData?.branch === 'es' ? 'es' : 'barueri')
      setError("")
      if (isEdit) { setMode("manual"); return }
      setMode("list")
      handleSearchList("")
    }
  }, [open])

  const handleSearchList = async (q: string) => {
    setLoading(true); setError(""); setResults([]); setSelected(null)
    const data = await getBitrixSuppliersAction(q)
    setLoading(false)
    if (!data || (data as any[]).length === 0) {
      setError(q ? "Nenhum fornecedor encontrado para esse termo." : "Nenhum fornecedor cadastrado ainda. Use 'Adicionar Manualmente' para cadastrar.")
      return
    }
    setResults(data as any[])
  }

  const handleSelectFromList = (company: any) => {
    setSelected(company)
    setCnpjOverride(company.cnpj || "")
  }

  const handleConfirm = () => {
    if (mode === "manual") {
      if (!manual.name.trim()) { setError("Nome é obrigatório"); return }
      if (!isCNPJComplete(manual.cnpj)) { setError("CNPJ deve ter 14 dígitos"); return }
      onConfirm({ ...manual, cnpj: formatCNPJ(manual.cnpj), branch })
      setManual(emptyManual); setError("")
      onClose()
      return
    }

    if (!selected) return
    const finalCnpj = cnpjOverride.trim() || selected.cnpj || ""
    // Só valida CNPJ se o fornecedor não tinha CNPJ e o usuário precisou digitar um
    if (!selected.cnpj && !isCNPJComplete(finalCnpj)) {
      setError("CNPJ deve ter 14 dígitos"); return
    }
    onConfirm({
      cnpj:              formatCNPJ(finalCnpj),
      name:              selected.name,
      stateRegistration: "",
      zipCode:           "",
      city:              "",
      state:             "",
      neighborhood:      "",
      address:           "",
      number:            "",
      complement:        "",
      contactName:       "",
      phone:             "",
      email:             "",
      branch,
    })
    setQuery(""); setResults([]); setSelected(null); setError("")
    onClose()
  }

  const handleModeChange = (newMode: "list" | "manual") => {
    setMode(newMode)
    setError(""); setSelected(null); setResults([])
    if (newMode === "list") handleSearchList("")
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-blue-600" />
            {isEdit ? "Editar Fornecedor" : "Selecionar Fornecedor"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {/* Seletor de modo — oculto no modo edição */}
          {!isEdit && (
            <div className="flex gap-2">
              <button
                onClick={() => handleModeChange("list")}
                className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                  mode === "list"
                    ? "bg-blue-600 text-white border-blue-600"
                    : "text-gray-600 border-gray-300 hover:bg-gray-50"
                }`}
              >
                Lista de Fornecedores
              </button>
              <button
                onClick={() => handleModeChange("manual")}
                className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                  mode === "manual"
                    ? "bg-blue-600 text-white border-blue-600"
                    : "text-gray-600 border-gray-300 hover:bg-gray-50"
                }`}
              >
                Adicionar Manualmente
              </button>
            </div>
          )}

          {/* ── Modo: Lista de Fornecedores ── */}
          {mode === "list" && (
            <>
              <div className="flex gap-2">
                <Input
                  placeholder="Filtrar por nome ou CNPJ..."
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSearchList(query)}
                  autoFocus
                />
                <Button
                  onClick={() => handleSearchList(query)}
                  disabled={loading}
                  className="shrink-0"
                >
                  <Search className="w-4 h-4 mr-1" />
                  {loading ? "..." : "Buscar"}
                </Button>
              </div>

              {results.length > 0 && (
                <div className="max-h-52 overflow-y-auto border rounded-lg divide-y">
                  {results.map((c: any) => (
                    <button
                      key={c.id}
                      onClick={() => handleSelectFromList(c)}
                      className={`w-full text-left px-3 py-2.5 hover:bg-blue-50 transition-colors ${
                        selected?.id === c.id ? "bg-blue-50 font-medium" : ""
                      }`}
                    >
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-gray-500">
                        {c.cnpj || <span className="text-orange-500">CNPJ não cadastrado</span>}
                        {c.city ? ` · ${c.city}${c.state ? `/${c.state}` : ""}` : ""}
                      </p>
                    </button>
                  ))}
                </div>
              )}

              {selected && !selected.cnpj && (
                <div className="p-3 border border-orange-200 bg-orange-50 rounded-lg">
                  <p className="text-xs font-medium text-orange-700 mb-1.5">
                    Este fornecedor não tem CNPJ cadastrado. Informe abaixo:
                  </p>
                  <Input
                    placeholder="00.000.000/0000-00"
                    value={cnpjOverride}
                    onChange={e => { setCnpjOverride(e.target.value); setError("") }}
                    className="h-8 text-sm"
                    autoFocus
                  />
                </div>
              )}
            </>
          )}

          {/* ── Modo: Adicionar Manualmente ── */}
          {mode === "manual" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-700">Nome / Razão Social *</label>
                  <Input className="mt-1" placeholder="Nome do fornecedor" autoFocus
                    value={manual.name} onChange={e => setManual(m => ({ ...m, name: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">CNPJ *</label>
                  <Input className="mt-1" placeholder="00.000.000/0000-00"
                    value={manual.cnpj} onChange={e => setManual(m => ({ ...m, cnpj: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Inscrição Estadual</label>
                  <Input className="mt-1" placeholder="IE"
                    value={manual.stateRegistration} onChange={e => setManual(m => ({ ...m, stateRegistration: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Contato</label>
                  <Input className="mt-1" placeholder="Nome do contato"
                    value={manual.contactName} onChange={e => setManual(m => ({ ...m, contactName: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Telefone</label>
                  <Input className="mt-1" placeholder="Telefone"
                    value={manual.phone} onChange={e => setManual(m => ({ ...m, phone: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-700">E-mail</label>
                  <Input className="mt-1" placeholder="E-mail"
                    value={manual.email} onChange={e => setManual(m => ({ ...m, email: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-700">Endereço</label>
                  <Input className="mt-1" placeholder="Rua / Avenida"
                    value={manual.address} onChange={e => setManual(m => ({ ...m, address: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Número</label>
                  <Input className="mt-1" placeholder="Número"
                    value={manual.number} onChange={e => setManual(m => ({ ...m, number: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Complemento</label>
                  <Input className="mt-1" placeholder="Complemento"
                    value={manual.complement} onChange={e => setManual(m => ({ ...m, complement: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Bairro</label>
                  <Input className="mt-1" placeholder="Bairro"
                    value={manual.neighborhood} onChange={e => setManual(m => ({ ...m, neighborhood: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">CEP</label>
                  <Input className="mt-1" placeholder="CEP"
                    value={manual.zipCode} onChange={e => setManual(m => ({ ...m, zipCode: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Cidade</label>
                  <Input className="mt-1" placeholder="Cidade"
                    value={manual.city} onChange={e => setManual(m => ({ ...m, city: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Estado (UF)</label>
                  <Input className="mt-1" placeholder="UF" maxLength={2}
                    value={manual.state} onChange={e => setManual(m => ({ ...m, state: e.target.value.toUpperCase() }))} />
                </div>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-amber-600">{error}</p>}

          {/* Fornecedor selecionado (modo lista) */}
          {mode === "list" && selected && (
            <div className="border rounded-lg p-3 bg-green-50 border-green-200 space-y-0.5">
              <p className="font-semibold text-green-900 text-sm">{selected.name}</p>
              {selected.cnpj && (
                <p className="text-xs text-green-700">CNPJ: {selected.cnpj}</p>
              )}
              {selected.city && (
                <p className="text-xs text-green-700">
                  {selected.city}{selected.state ? ` — ${selected.state}` : ""}
                </p>
              )}
            </div>
          )}

          {/* Filial Interatell */}
          <div className="border rounded-lg p-3 bg-gray-50">
            <p className="text-xs font-semibold text-gray-700 mb-2">Filial Interatell *</p>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={branch === 'barueri'} onChange={() => setBranch('barueri')} className="accent-blue-600" />
                <span className="text-sm">Barueri (SP)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={branch === 'es'} onChange={() => setBranch('es')} className="accent-blue-600" />
                <span className="text-sm">Serra (ES)</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={handleConfirm} disabled={mode === "list" && !selected}>
              {isEdit ? "Salvar Alterações" : "Confirmar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const NATURES = ["HW", "SW", "LC", "ST", "SRV"]

// ── Diálogo: buscar produto (catálogo Bitrix24 ou manual) ─────────────────────
function ProductDialog({
  open,
  onClose,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  onAdd: (product: any) => void
}) {
  const [mode, setMode] = useState<"catalog" | "manual">("catalog")

  // ── aba catálogo ──
  const [query, setQuery]     = useState("")
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [catalogError, setCatalogError] = useState("")

  // ── aba manual ──
  const [manual, setManual] = useState({
    partnumber: "", description: "", nature: "HW", ncm: "", cfop: "",
  })
  const [manualError, setManualError] = useState("")
  const partnumberRef = useRef<HTMLInputElement>(null)

  // Foca o campo partnumber ao entrar no modo manual
  useEffect(() => {
    if (mode === "manual") {
      setTimeout(() => partnumberRef.current?.focus(), 50)
    }
  }, [mode])

  const handleSearch = async () => {
    if (!query.trim()) return
    setLoading(true); setCatalogError(""); setResults([])

    // Busca no banco local primeiro (tem NCM, cfop, nature)
    const localRes = await searchProductsAction(query).catch(() => [])
    const localList: any[] = Array.isArray(localRes) ? localRes : []

    // Busca no Bitrix24 em paralelo
    const bitrixRes = await searchBitrixProductsAction(query).catch(() => ({ success: false, products: [] }))
    const bitrixList: any[] = bitrixRes.success ? (bitrixRes.products ?? []) : []

    // Mescla: local tem prioridade; Bitrix adiciona produtos que não estão no local
    const localCodes = new Set(localList.map((p: any) => String(p.partnumber || "").toLowerCase()))
    const extraFromBitrix = bitrixList.filter((p: any) => {
      const code = String(p.code || p.partnumber || "").toLowerCase()
      return code && !localCodes.has(code)
    })

    const merged = [
      ...localList.map((p: any) => ({
        id: p.id,
        code: p.partnumber,
        name: p.description,
        ncm: p.ncm || "",
        cfop: p.cfop || "",
        nature: p.nature || "HW",
        family: p.family || "",
      })),
      ...extraFromBitrix,
    ]

    setLoading(false)
    if (!merged.length) setCatalogError("Nenhum produto encontrado")
    setResults(merged)
  }

  const handleAddFromCatalog = (p: any) => {
    onAdd(p)
    setQuery(""); setResults([]); setCatalogError("")
    onClose()
  }

  const handleAddManual = () => {
    if (!manual.partnumber.trim()) { setManualError("Código é obrigatório"); return }
    if (!manual.description.trim()) { setManualError("Descrição é obrigatória"); return }
    onAdd({
      id: Date.now(),
      code: manual.partnumber.trim(),
      name: manual.description.trim(),
      nature: manual.nature,
      ncm: manual.ncm.trim(),
      cfop: manual.cfop.trim(),
    })
    setManual({ partnumber: "", description: "", nature: "HW", ncm: "", cfop: "" })
    setManualError("")
    onClose()
  }

  const reset = () => {
    setQuery(""); setResults([]); setCatalogError("")
    setManual({ partnumber: "", description: "", nature: "HW", ncm: "", cfop: "" })
    setManualError("")
    setMode("catalog")
  }

  return (
    <Dialog open={open} onOpenChange={() => { reset(); onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-blue-600" />
            Adicionar Produto
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Seletor de modo */}
          <div className="flex gap-2">
            <button
              onClick={() => setMode("catalog")}
              className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                mode === "catalog"
                  ? "bg-blue-600 text-white border-blue-600"
                  : "text-gray-600 border-gray-300 hover:bg-gray-50"
              }`}
            >
              📦 Catálogo Bitrix24
            </button>
            <button
              onClick={() => setMode("manual")}
              className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                mode === "manual"
                  ? "bg-blue-600 text-white border-blue-600"
                  : "text-gray-600 border-gray-300 hover:bg-gray-50"
              }`}
            >
              ✏️ Entrada Manual
            </button>
          </div>

          {/* ── Catálogo ── */}
          {mode === "catalog" && (
            <>
              <div className="flex gap-2">
                <Input
                  placeholder="Código, partnumber ou nome do produto"
                  value={query}
                  onChange={e => { setQuery(e.target.value); setCatalogError("") }}
                  onKeyDown={e => e.key === "Enter" && handleSearch()}
                  autoFocus
                />
                <Button onClick={handleSearch} disabled={loading} className="shrink-0">
                  <Search className="w-4 h-4 mr-1" />
                  {loading ? "..." : "Buscar"}
                </Button>
              </div>
              {catalogError && <p className="text-sm text-amber-600">{catalogError}</p>}
              <div className="max-h-72 overflow-y-auto border rounded-lg divide-y">
                {results.length === 0 ? (
                  <p className="text-center text-gray-400 py-10 text-sm">
                    {loading ? "Buscando no catálogo..." : "Digite e clique em Buscar"}
                  </p>
                ) : (
                  results.map(p => (
                    <button
                      key={p.id}
                      className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors"
                      onClick={() => handleAddFromCatalog(p)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-sm">{p.code || p.partnumber || `ID: ${p.id}`}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{p.name || p.description}</p>
                          {p.ncm && <p className="text-xs text-blue-500 mt-0.5">NCM: {p.ncm}{p.cfop ? ` · CFOP: ${p.cfop}` : ""}</p>}
                        </div>
                        {p.nature && (
                          <Badge variant="outline" className="text-xs shrink-0">{p.nature}</Badge>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </>
          )}

          {/* ── Manual ── */}
          {mode === "manual" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-700">Código / Partnumber *</label>
                  <Input
                    ref={partnumberRef}
                    className="mt-1"
                    placeholder="ex: ABC-12345"
                    value={manual.partnumber}
                    onKeyDown={e => e.stopPropagation()}
                    onChange={e => { setManual(m => ({ ...m, partnumber: e.target.value })); setManualError("") }}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Natureza *</label>
                  <Select
                    value={manual.nature}
                    onValueChange={v => setManual(m => ({ ...m, nature: v }))}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NATURES.map(n => (
                        <SelectItem key={n} value={n}>{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700">Descrição *</label>
                <Input
                  className="mt-1"
                  placeholder="Descrição do produto"
                  value={manual.description}
                  onKeyDown={e => e.stopPropagation()}
                  onChange={e => { setManual(m => ({ ...m, description: e.target.value })); setManualError("") }}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-700">NCM</label>
                  <Input
                    className="mt-1"
                    placeholder="ex: 8471.30.19"
                    value={manual.ncm}
                    onKeyDown={e => e.stopPropagation()}
                    onChange={e => setManual(m => ({ ...m, ncm: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">CFOP</label>
                  <Input
                    className="mt-1"
                    placeholder="ex: 5102"
                    value={manual.cfop}
                    onKeyDown={e => e.stopPropagation()}
                    onChange={e => setManual(m => ({ ...m, cfop: e.target.value }))}
                  />
                </div>
              </div>

              {manualError && <p className="text-sm text-red-600">{manualError}</p>}

              <div className="flex justify-end pt-1">
                <Button onClick={handleAddManual}>
                  Adicionar Produto
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

type FamilyItem = { id: string; name: string; omieCode: string; location: string }

// Código fixo para serviços (Outros - Fami)
const SRV_FAMILY_CODE = '2164790403'

// ── Card de produto dentro de um grupo ───────────────────────────────────────
function ProductRow({
  groupIndex,
  productIndex,
  form,
  onRemove,
  families,
}: {
  groupIndex: number
  productIndex: number
  form: UseFormReturn<any>
  onRemove: () => void
  families: FamilyItem[]
}) {
  const basePath = `supplierGroups.${groupIndex}.products.${productIndex}`
  const product = form.watch(basePath)
  const [editing, setEditing] = useState(false)

  // Filtra famílias pelo estado do produto e auto-seleciona para serviços
  const productState   = product?.state || 'SP'
  const productNature  = product?.nature || 'HW'
  const isSRV = ['SRV', 'LC', 'SW', 'ST'].includes(productNature) // serviços/software → sem estoque físico

  // Auto-seleciona família "Outros" quando nature é serviço
  useEffect(() => {
    if (isSRV) {
      const current = form.getValues(`${basePath}.family`)
      if (current !== SRV_FAMILY_CODE) form.setValue(`${basePath}.family`, SRV_FAMILY_CODE)
    }
  }, [productNature, isSRV, basePath, form])

  // Filtra lista por estado: ES → Espírito Santo, demais → Barueri
  const filteredFamilies = families.length === 0 ? [] : (() => {
    const hasLocation = families.some(f => f.location)
    if (!hasLocation) return families
    const isES = productState === 'ES'
    return families.filter(f => {
      if (!f.location) return true
      return isES
        ? f.location.includes('es') || f.location.includes('espirito') || f.location.includes('espírito')
        : f.location.includes('barueri') || f.location.includes('sp')
    })
  })()

  const updateTotals = (value: number) => {
    const qty = form.getValues(`${basePath}.quantity`) || 1
    form.setValue(`${basePath}.unitCost`, value)
    form.setValue(`${basePath}.totalCost`, value * qty)
  }

  const updateQty = (qty: number) => {
    form.setValue(`${basePath}.quantity`, qty)
    form.setValue(`${basePath}.totalCost`, (form.getValues(`${basePath}.unitCost`) || 0) * qty)
  }

  return (
    <div className={`border rounded-lg bg-white text-sm ${editing ? 'p-3 space-y-3' : 'grid grid-cols-12 gap-2 items-center p-2'}`}>
      {editing ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-semibold text-gray-500 uppercase">Partnumber</label>
              <Input className="h-7 text-xs mt-0.5"
                value={product?.partnumber || ""}
                onChange={e => form.setValue(`${basePath}.partnumber`, e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-gray-500 uppercase">NCM</label>
              <Input className="h-7 text-xs mt-0.5"
                value={product?.ncm || ""}
                onChange={e => form.setValue(`${basePath}.ncm`, e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="text-[10px] font-semibold text-gray-500 uppercase">Descrição</label>
              <Input className="h-7 text-xs mt-0.5"
                value={product?.description || ""}
                onChange={e => form.setValue(`${basePath}.description`, e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-gray-500 uppercase">CFOP</label>
              <Input className="h-7 text-xs mt-0.5"
                value={product?.cfop || ""}
                onChange={e => form.setValue(`${basePath}.cfop`, e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-gray-500 uppercase">Natureza</label>
              <Select value={product?.nature || "HW"} onValueChange={v => form.setValue(`${basePath}.nature`, v)}>
                <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["HW","SW","LC","ST","SRV"].map(n => <SelectItem key={n} value={n} className="text-xs">{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing(false)}>
              Concluir
            </Button>
          </div>
        </>
      ) : (
      <><div className="col-span-4">
        <p className="font-medium truncate">{product?.partnumber}</p>
        <p className="text-xs text-gray-500 truncate">{product?.description}</p>
        {/* Seletor de família — codigo_familia do Omie */}
        <Select
          value={form.watch(`${basePath}.family`) || ""}
          onValueChange={v => form.setValue(`${basePath}.family`, v)}
          disabled={isSRV}
        >
          <SelectTrigger className={`h-6 text-[11px] mt-1 border-dashed ${isSRV ? 'opacity-60' : ''}`}>
            <SelectValue placeholder={isSRV ? "Outros (serviço)" : "Família Omie"} />
          </SelectTrigger>
          <SelectContent>
            {filteredFamilies.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-400">
                {families.length === 0 ? 'Configure BITRIX_LIST_FAMILY_ID=65 no .env' : 'Nenhuma família para este estado'}
              </div>
            ) : (
              filteredFamilies.map(f => (
                <SelectItem key={f.id} value={f.omieCode || f.id} className="text-xs">
                  {f.name}
                  {f.omieCode && <span className="text-gray-400 ml-1">· {f.omieCode}</span>}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>
      <div className="col-span-1">
        <Select
          value={form.watch(`${basePath}.state`) || "SP"}
          onValueChange={v => form.setValue(`${basePath}.state`, v)}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {states.map(s => (
              <SelectItem key={s.value} value={s.value} className="text-xs">{s.value}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="col-span-1">
        <Input
          type="number" min={1}
          className="h-8 text-xs text-center"
          value={product?.quantity || 1}
          onChange={e => updateQty(Number(e.target.value))}
        />
      </div>
      <div className="col-span-3">
        <CurrencyInput
          className="h-8 text-xs"
          placeholder="Custo unit."
          value={product?.unitCost || 0}
          resetKey={`${basePath}:${product?.unitCost ?? 0}`}
          onChange={updateTotals}
        />
      </div>
      <div className="col-span-2 text-right text-xs text-gray-600 font-medium">
        {formatCurrency(product?.totalCost || 0)}
      </div>
      <div className="col-span-1 flex justify-end gap-1">
        <Button
          type="button" variant="ghost" size="sm"
          className="h-7 w-7 p-0 text-blue-400 hover:text-blue-600"
          onClick={() => setEditing(true)}
          title="Editar produto"
        >
          <Pencil className="w-3.5 h-3.5" />
        </Button>
        <Button
          type="button" variant="ghost" size="sm"
          className="h-7 w-7 p-0 text-red-400 hover:text-red-600"
          onClick={onRemove}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
      </>)}
    </div>
  )
}

// ── Card de um grupo de fornecedor ────────────────────────────────────────────
function SupplierGroupCard({
  groupIndex,
  form,
  onRemoveGroup,
  onEditSupplier,
  families,
}: {
  groupIndex: number
  form: UseFormReturn<any>
  onRemoveGroup: () => void
  onEditSupplier: () => void
  families: FamilyItem[]
}) {
  const [expanded, setExpanded] = useState(true)
  const [productDialogOpen, setProductDialogOpen] = useState(false)

  const { fields: productFields, append: appendProduct, remove: removeProduct } = useFieldArray({
    control: form.control,
    name: `supplierGroups.${groupIndex}.products`,
  })

  const supplier = form.watch(`supplierGroups.${groupIndex}.supplier`)
  const groupBranch: string = form.watch(`supplierGroups.${groupIndex}.branch`) || 'barueri'
  const totalCusto = (form.watch(`supplierGroups.${groupIndex}.products`) || [])
    .reduce((s: number, p: any) => s + (p.totalCost || 0), 0)

  const handleAddProduct = (p: any) => {
    appendProduct({
      id:          p.id,
      // Bitrix24 catalog usa 'code' como partnumber e 'name' como descrição
      partnumber:  p.code || p.partnumber || "",
      description: p.name  || p.description || "",
      cfop:        p.cfop  || "",
      nature:      p.nature || "HW",
      ncm:         p.ncm   || "",
      family:      "",  // codigo_familia para o Omie
      state:       "SP",
      quantity:    1,
      unitCost:    0,
      totalCost:   0,
      unitSale:    0,
      totalSale:   0,
    })
    setProductDialogOpen(false)
  }

  return (
    <div className="border rounded-xl overflow-hidden shadow-sm">
      {/* Header do grupo */}
      <div className="flex items-center justify-between px-4 py-3 bg-blue-50 border-b border-blue-100">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">
            {groupIndex + 1}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-semibold text-blue-900">{supplier?.name || "Fornecedor"}</p>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                groupBranch === 'es'
                  ? 'bg-green-100 text-green-700 border-green-300'
                  : 'bg-blue-100 text-blue-700 border-blue-300'
              }`}>
                {groupBranch === 'es' ? 'Serra/ES' : 'Barueri/SP'}
              </span>
            </div>
            <p className="text-xs text-blue-600">{supplier?.cnpj} — {productFields.length} produto(s) · Custo total: {formatCurrency(totalCusto)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button" size="sm" variant="ghost"
            className="h-8 text-blue-600 hover:bg-blue-100"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
          <Button
            type="button" size="sm" variant="ghost"
            className="h-8 text-blue-500 hover:text-blue-700 hover:bg-blue-100"
            onClick={onEditSupplier}
            title="Editar fornecedor"
          >
            <Pencil className="w-4 h-4" />
          </Button>
          <Button
            type="button" size="sm" variant="ghost"
            className="h-8 text-red-400 hover:text-red-600 hover:bg-red-50"
            onClick={onRemoveGroup}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Produtos do grupo */}
      {expanded && (
        <div className="p-4 bg-gray-50 space-y-2">
          {productFields.length > 0 && (
            <>
              {/* Cabeçalho da lista */}
              <div className="grid grid-cols-12 gap-2 px-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <div className="col-span-4">Produto</div>
                <div className="col-span-1">UF</div>
                <div className="col-span-1 text-center">Qtd</div>
                <div className="col-span-3">Custo Unit. (R$)</div>
                <div className="col-span-2 text-right">Total Custo</div>
                <div className="col-span-1" />
              </div>
              {productFields.map((_, pIdx) => (
                <ProductRow
                  key={pIdx}
                  groupIndex={groupIndex}
                  productIndex={pIdx}
                  form={form}
                  onRemove={() => removeProduct(pIdx)}
                  families={families}
                />
              ))}
            </>
          )}

          {productFields.length === 0 && (
            <div className="text-center py-6 text-gray-400 text-sm border-2 border-dashed rounded-lg">
              Nenhum produto adicionado — clique em "Adicionar Produto"
            </div>
          )}

          <Button
            type="button" variant="outline" size="sm"
            className="w-full mt-2 border-dashed"
            onClick={() => setProductDialogOpen(true)}
          >
            <Plus className="w-4 h-4 mr-1" /> Adicionar Produto
          </Button>
        </div>
      )}

      <ProductDialog
        open={productDialogOpen}
        onClose={() => setProductDialogOpen(false)}
        onAdd={handleAddProduct}
      />
    </div>
  )
}

// ── Tab principal ─────────────────────────────────────────────────────────────
export function SupplierGroupsTab({ form }: SupplierGroupsTabProps) {
  const [supplierDialogOpen, setSupplierDialogOpen] = useState(false)
  const [editingSupplierIdx, setEditingSupplierIdx] = useState<number | null>(null)
  const [families, setFamilies] = useState<FamilyItem[]>([])

  // Carrega famílias da lista Bitrix24 #65 (BITRIX_LIST_FAMILY_ID no .env)
  useEffect(() => {
    getBitrixFamiliesFullAction().then(res => {
      if (res.success) setFamilies(res.families)
    })
  }, [])

  const { fields: groupFields, append: appendGroup, remove: removeGroup } = useFieldArray({
    control: form.control,
    name: "supplierGroups",
  })

  const handleEditSupplier = (company: any) => {
    if (editingSupplierIdx === null) return
    const current = form.getValues(`supplierGroups.${editingSupplierIdx}`)
    form.setValue(`supplierGroups.${editingSupplierIdx}`, {
      ...current,
      branch: company.branch || current.branch || 'barueri',
      supplier: {
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
      },
    })
    setEditingSupplierIdx(null)
  }

  const handleAddSupplier = (company: any) => {
    appendGroup({
      localId:  crypto.randomUUID(),
      branch:   company.branch || 'barueri',
      supplier: {
        cnpj:             company.cnpj,
        name:             company.name,
        stateRegistration: company.stateRegistration || "",
        zipCode:          company.zipCode || "",
        city:             company.city || "",
        state:            company.state || "",
        neighborhood:     company.neighborhood || "",
        address:          company.address || "",
        number:           company.number || "",
        complement:       company.complement || "",
        contactName:      company.contactName || "",
        phone:            company.phone || "",
        email:            company.email || "",
      },
      products: [],
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Grupos de Fornecedores</h2>
          <p className="text-sm text-gray-500">
            Cada fornecedor é um grupo. Adicione os produtos de cada fornecedor separadamente.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => setSupplierDialogOpen(true)}
          className="gap-2"
        >
          <Plus className="w-4 h-4" /> Adicionar Fornecedor
        </Button>
      </div>

      {groupFields.length === 0 && (
        <div className="border-2 border-dashed rounded-xl p-12 text-center text-gray-400">
          <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Nenhum fornecedor adicionado</p>
          <p className="text-sm mt-1">Clique em "Adicionar Fornecedor" para começar</p>
        </div>
      )}

      <div className="space-y-4">
        {groupFields.map((_, gIdx) => (
          <SupplierGroupCard
            key={gIdx}
            groupIndex={gIdx}
            form={form}
            onRemoveGroup={() => removeGroup(gIdx)}
            onEditSupplier={() => setEditingSupplierIdx(gIdx)}
            families={families}
          />
        ))}
      </div>

      <SupplierDialog
        open={supplierDialogOpen}
        onClose={() => setSupplierDialogOpen(false)}
        onConfirm={handleAddSupplier}
      />
      <SupplierDialog
        open={editingSupplierIdx !== null}
        onClose={() => setEditingSupplierIdx(null)}
        onConfirm={handleEditSupplier}
        isEdit
        initialData={editingSupplierIdx !== null ? {
          ...form.getValues(`supplierGroups.${editingSupplierIdx}.supplier`),
          branch: form.getValues(`supplierGroups.${editingSupplierIdx}.branch`) || 'barueri',
        } : undefined}
      />
    </div>
  )
}

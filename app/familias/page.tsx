'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  Loader2, Plus, Search, Pencil, Trash2, X,
  AlertTriangle, CheckCircle2, RefreshCw,
} from 'lucide-react'

// ─── BX24 helpers ────────────────────────────────────────────────────────────

declare const BX24: any
const LIST_ID = 65

function bx24Call(method: string, params: Record<string, any> = {}, timeoutMs = 10000): Promise<any> {
  return new Promise((resolve, reject) => {
    if (typeof BX24 === 'undefined') {
      reject(new Error('BX24 não disponível. Abra o app dentro do Bitrix24.'))
      return
    }
    const timer = setTimeout(() => reject(new Error(`Timeout: ${method}`)), timeoutMs)
    BX24.callMethod(method, params, (res: any) => {
      clearTimeout(timer)
      if (res.error()) {
        const e = res.error()
        reject(new Error(`[${e.error}] ${e.error_description || e.error}`))
      } else {
        resolve(res.data())
      }
    })
  })
}

type FieldMeta = { id: string; ptype: 'N' | 'S' | 'HTML' }
let _fieldCache: Record<string, FieldMeta> | null = null

async function fieldMap(): Promise<Record<string, FieldMeta>> {
  if (_fieldCache) return _fieldCache
  try {
    const data = await bx24Call('lists.field.get', {
      IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: LIST_ID,
    })
    const map: Record<string, FieldMeta> = {}
    for (const [key, info] of Object.entries(data as Record<string, any>)) {
      const m = key.match(/^PROPERTY_(\d+)$/)
      if (!m) continue
      const code = String((info as any).CODE || '').toUpperCase().trim()
      if (code) {
        const rawType = String((info as any).PROPERTY_TYPE || 'S')
        map[code] = { id: m[1], ptype: rawType === 'N' ? 'N' : 'S' }
      }
    }
    _fieldCache = map
    return map
  } catch {
    return {}
  }
}

function readProp(el: any, propId: string): string {
  const raw = el[`PROPERTY_${propId}`]
  if (!raw) return ''
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const first = Object.values(raw)[0] as any
    return String(first?.VALUE ?? first ?? '')
  }
  if (Array.isArray(raw)) return String(raw[0] ?? '')
  return String(raw)
}

// ─── Tipos ───────────────────────────────────────────────────────────────────

type Family = { id: string; name: string; location: string }

// ─── CRUD ────────────────────────────────────────────────────────────────────

async function bx24GetFamilies(onPage?: (partial: Family[]) => void): Promise<Family[]> {
  const fm = await fieldMap()
  const localId = fm['LOCAL']?.id || fm['LOCALIDADE']?.id || fm['REGIAO']?.id || fm['ESTADO']?.id || ''
  const select = ['ID', 'NAME', ...(localId ? [`PROPERTY_${localId}`] : [])]
  const all: Family[] = []
  let start = 0
  const seen = new Set<string>()

  while (true) {
    const data = await bx24Call('lists.element.get', {
      IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: LIST_ID,
      FILTER: { ACTIVE: 'Y' }, SELECT: select, start,
    })
    const items: any[] = Array.isArray(data) ? data : Object.values(data || {})
    for (const el of items) {
      if (!el.ID || seen.has(String(el.ID))) continue
      seen.add(String(el.ID))
      all.push({
        id: String(el.ID),
        name: String(el.NAME || ''),
        location: localId ? readProp(el, localId) : '',
      })
    }
    onPage?.([...all])
    if (items.length < 50) break
    start += 50
  }
  return all
}

async function bx24CreateFamily(name: string, location: string): Promise<string> {
  const fm = await fieldMap()
  const localId = fm['LOCAL']?.id || fm['LOCALIDADE']?.id || fm['REGIAO']?.id || fm['ESTADO']?.id || ''
  const fields: Record<string, any> = { NAME: name }
  if (localId && location) fields[`PROPERTY_${localId}`] = location
  const result = await bx24Call('lists.element.add', {
    IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: LIST_ID,
    ELEMENT_CODE: String(Date.now()), fields,
  })
  return String(result || '')
}

async function bx24UpdateFamily(id: string, name: string, location: string): Promise<void> {
  const fm = await fieldMap()
  const localId = fm['LOCAL']?.id || fm['LOCALIDADE']?.id || fm['REGIAO']?.id || fm['ESTADO']?.id || ''
  const fields: Record<string, any> = { NAME: name }
  if (localId) fields[`PROPERTY_${localId}`] = location
  await bx24Call('lists.element.update', {
    IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: LIST_ID, ELEMENT_ID: id, fields,
  })
}

async function bx24DeleteFamily(id: string): Promise<void> {
  await bx24Call('lists.element.delete', {
    IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: LIST_ID, ELEMENT_ID: id,
  })
}

// ─── Modal Exclusão ───────────────────────────────────────────────────────────

function DeleteModal({ item, onConfirm, onCancel, loading }: {
  item: Family | null; onConfirm: () => void; onCancel: () => void; loading: boolean
}) {
  if (!item) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">Excluir família</h3>
              <p className="text-sm text-gray-500 mt-1">Esta ação é <strong>permanente</strong> no Bitrix24.</p>
            </div>
          </div>
          <div className="mt-4 p-3 bg-gray-50 border rounded-lg">
            <p className="text-sm font-semibold text-gray-800">{item.name}</p>
            {item.location && <p className="text-xs text-gray-500 mt-0.5">{item.location}</p>}
          </div>
          <p className="text-sm text-red-600 font-medium mt-3">Tem certeza que deseja excluir?</p>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t bg-gray-50 rounded-b-xl">
          <Button variant="outline" onClick={onCancel} disabled={loading}>Cancelar</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading}>
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Excluindo...</> : <><Trash2 className="w-4 h-4 mr-2" />Excluir</>}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal Criar/Editar ───────────────────────────────────────────────────────

function FamilyModal({ open, onClose, initial, onSaved }: {
  open: boolean; onClose: () => void; initial: Family | null; onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(initial?.name || '')
    setLocation(initial?.location || '')
  }, [initial, open])

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Nome é obrigatório'); return }
    setSaving(true)
    try {
      if (initial) {
        await bx24UpdateFamily(initial.id, name.trim(), location)
        toast.success('Família atualizada!')
      } else {
        await bx24CreateFamily(name.trim(), location)
        toast.success('Família criada!')
      }
      onSaved(); onClose()
    } catch (e: any) {
      toast.error(e.message || 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold">{initial ? 'Editar Família' : 'Nova Família'}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-600">Nome *</label>
            <Input className="mt-1" placeholder="Ex: Aruba - Hardware - 2081927710"
              value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()} autoFocus />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Localidade</label>
            <select
              className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={location} onChange={e => setLocation(e.target.value)}
            >
              <option value="">Selecione...</option>
              <option value="Barueri">Barueri (SP)</option>
              <option value="Espirito Santo">Espírito Santo (ES)</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t bg-gray-50 rounded-b-xl">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Salvando...</> : <><CheckCircle2 className="w-4 h-4 mr-2" />Salvar</>}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function FamiliasPage() {
  const [families, setFamilies] = useState<Family[]>([])
  const [loading, setLoading] = useState(true)
  const [bx24Ready, setBx24Ready] = useState(false)
  const [bx24Error, setBx24Error] = useState('')
  const [search, setSearch] = useState('')
  const [filterLoc, setFilterLoc] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Family | null>(null)
  const [confirmDel, setConfirmDel] = useState<Family | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let mounted = true
    const markReady = () => { if (mounted) setBx24Ready(true) }

    if (typeof BX24 !== 'undefined') {
      try { BX24.init(markReady) } catch (_) {}
      const t = setTimeout(markReady, 1000)
      return () => { mounted = false; clearTimeout(t) }
    }

    const existing = document.querySelector<HTMLScriptElement>('script[src="https://api.bitrix24.com/api/v1/"]')
    const onLoad = () => {
      if (!mounted) return
      try { (window as any).BX24.init(markReady) } catch (_) {}
      setTimeout(markReady, 1000)
    }
    if (existing) { existing.addEventListener('load', onLoad, { once: true }); return () => { mounted = false; existing.removeEventListener('load', onLoad) } }
    const s = document.createElement('script')
    s.src = 'https://api.bitrix24.com/api/v1/'; s.async = true; s.onload = onLoad
    s.onerror = () => { if (mounted) setBx24Error('BX24 não disponível. Abra dentro do Bitrix24.') }
    document.head.appendChild(s)
    return () => { mounted = false }
  }, [])

  const load = useCallback(async () => {
    if (!bx24Ready) return
    setLoading(true)
    try {
      await bx24GetFamilies(partial => { setFamilies(partial); setLoading(false) })
    } catch (e: any) { toast.error(e.message || 'Erro ao carregar') } finally { setLoading(false) }
  }, [bx24Ready])

  useEffect(() => { if (bx24Ready) load() }, [bx24Ready, load])

  const handleDelete = async () => {
    if (!confirmDel) return
    setDeleting(true)
    try {
      await bx24DeleteFamily(confirmDel.id)
      toast.success(`"${confirmDel.name}" excluída.`)
      setConfirmDel(null); load()
    } catch (e: any) { toast.error(e.message || 'Erro ao excluir') } finally { setDeleting(false) }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return families.filter(f =>
      (!q || f.name.toLowerCase().includes(q)) &&
      (!filterLoc || f.location.toLowerCase().includes(filterLoc.toLowerCase()))
    )
  }, [families, search, filterLoc])

  const locBadge = (loc: string) => {
    if (!loc) return null
    const isES = loc.toLowerCase().includes('espirito') || loc.toLowerCase().includes('espírito') || loc.toLowerCase() === 'es'
    return <Badge variant="outline" className={`text-xs ${isES ? 'border-green-400 text-green-700' : 'border-blue-400 text-blue-700'}`}>{isES ? 'ES' : 'SP'}</Badge>
  }

  if (bx24Error) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <p className="text-gray-600 text-center font-medium">{bx24Error}</p>
    </div>
  )

  return (
    <div className="container mx-auto p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Famílias</h1>
          <p className="text-sm text-gray-500 mt-0.5">Lista Bitrix24 #{LIST_ID} — {families.length} cadastrada(s)</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading || !bx24Ready}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />Atualizar
          </Button>
          <Button size="sm" onClick={() => { setEditing(null); setModalOpen(true) }} disabled={!bx24Ready}>
            <Plus className="w-4 h-4 mr-1" />Nova Família
          </Button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <Input className="pl-9 h-9 text-sm" placeholder="Buscar por nome…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={filterLoc} onChange={e => setFilterLoc(e.target.value)}
        >
          <option value="">Todas as localidades</option>
          <option value="Barueri">Barueri (SP)</option>
          <option value="Espirito">Espírito Santo (ES)</option>
        </select>
      </div>

      <div className="border rounded-xl overflow-hidden shadow-sm bg-white">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600 mr-2" />
            <span className="text-gray-500">Carregando famílias…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="font-medium">{search || filterLoc ? 'Nenhum resultado' : 'Nenhuma família cadastrada'}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Nome</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Localidade</th>
                <th className="px-4 py-2 w-20" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(f => (
                <tr key={f.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{f.name}</td>
                  <td className="px-4 py-3">{locBadge(f.location) ?? <span className="text-gray-400 text-xs">—</span>}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => { setEditing(f); setModalOpen(true) }}
                        className="p-1.5 rounded hover:bg-blue-50 text-blue-600" title="Editar">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setConfirmDel(f)}
                        className="p-1.5 rounded hover:bg-red-50 text-red-500" title="Excluir">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && filtered.length > 0 && (
          <div className="px-4 py-2 bg-gray-50 border-t text-xs text-gray-400">
            Mostrando {filtered.length} de {families.length} famílias
          </div>
        )}
      </div>

      <FamilyModal open={modalOpen} onClose={() => setModalOpen(false)}
        initial={editing} onSaved={load} />
      <DeleteModal item={confirmDel} onConfirm={handleDelete}
        onCancel={() => setConfirmDel(null)} loading={deleting} />
    </div>
  )
}

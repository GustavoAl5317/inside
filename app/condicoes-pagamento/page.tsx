'use client'

import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  Loader2, Plus, Search, Pencil, Trash2, X,
  AlertTriangle, CheckCircle2, RefreshCw, Download,
} from 'lucide-react'

// ─── BX24 ─────────────────────────────────────────────────────────────────────

import { bx24GetPaymentConditions } from '@/lib/bx24-lists'

declare const BX24: any
const LIST_ID = 67

function bx24Call(method: string, params: Record<string, any> = {}, timeoutMs = 5000): Promise<any> {
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
        const code = e?.error || e?.status || 'ERROR'
        const desc = e?.error_description || e?.ex?.message || e?.message || String(e)
        reject(new Error(`${code}: ${desc}`))
      } else {
        resolve(res.data())
      }
    })
  })
}

// ─── Campos da lista (para CRUD) ──────────────────────────────────────────────

type FieldMeta = { id: string; isHtml: boolean }
type FieldMap  = { tipo?: FieldMeta; idProp?: FieldMeta }
let _fieldMap: FieldMap | null = null

async function getFieldMap(): Promise<FieldMap> {
  if (_fieldMap) return _fieldMap
  const fm: FieldMap = {}
  try {
    const data = await bx24Call('lists.field.get', { IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: LIST_ID })
    for (const [key, info] of Object.entries(data as Record<string, any>)) {
      const m = key.match(/^PROPERTY_(\d+)$/)
      if (!m) continue
      const i        = info as any
      const code     = String(i.CODE || '').toUpperCase().trim()
      const name     = String(i.NAME || '').toUpperCase().trim()
      const propType = String(i.PROPERTY_TYPE || 'S').toUpperCase()
      const userType = String(i.USER_TYPE || '').toUpperCase()
      const isHtml   = propType.includes('HTML') || userType.includes('HTML')
      if (['ID', 'CODIGO', 'CÓDIGO', 'COD', 'CODE'].includes(code) || name === 'ID')
        fm.idProp = { id: m[1], isHtml }
      if (code.includes('TIPO') || code.includes('TYPE') || name.includes('TIPO') || name.includes('TYPE'))
        fm.tipo = { id: m[1], isHtml }
    }
  } catch (_) {}
  _fieldMap = fm
  return fm
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

async function bx24GetAll(): Promise<Condition[]> {
  const all = await bx24GetPaymentConditions()
  return all.map(c => ({ id: c.id, displayName: c.name, tipo: c.tipo }))
}

async function bx24CreateOne(entry: string, tipo: string, fm: FieldMap): Promise<void> {
  const { code, desc } = splitEntry(entry)
  const safeCode = `${tipo[0].toLowerCase()}${(code || desc).replace(/[^a-zA-Z0-9]/g, '')}${Date.now()}`

  const newId: any = await bx24Call('lists.element.add', {
    IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: LIST_ID,
    ELEMENT_CODE: safeCode,
    fields: { NAME: desc || entry },
  })

  if (newId && (fm.tipo || fm.idProp)) {
    const props: Record<string, any> = { NAME: desc || entry }
    if (fm.idProp && code) props[`PROPERTY_${fm.idProp.id}`] = code
    if (fm.tipo  && tipo) props[`PROPERTY_${fm.tipo.id}`]   = tipo
    try {
      await bx24Call('lists.element.update', {
        IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: LIST_ID,
        ELEMENT_ID: String(newId), fields: props,
      })
    } catch (_) {}
  }
}

async function bx24Update(id: string, entry: string, tipo: string): Promise<void> {
  const { tipo: tipoMeta, idProp: idMeta } = await getFieldMap()
  const { code, desc } = splitEntry(entry)

  const fields: Record<string, any> = { NAME: desc || entry }
  if (idMeta)   fields[`PROPERTY_${idMeta.id}`]   = code
  if (tipoMeta) fields[`PROPERTY_${tipoMeta.id}`] = tipo

  await bx24Call('lists.element.update', {
    IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: LIST_ID,
    ELEMENT_ID: id, fields,
  })
}

async function bx24Create(entry: string, tipo: string): Promise<void> {
  const fm = await getFieldMap()
  return bx24CreateOne(entry, tipo, fm)
}

async function bx24Delete(id: string): Promise<void> {
  await bx24Call('lists.element.delete', {
    IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: LIST_ID,
    ELEMENT_ID: id,
  })
}

async function bx24Seed(
  onProgress: (done: number, total: number, msg: string) => void
): Promise<{ created: number }> {
  const fm = await getFieldMap()
  const pairs: { entry: string; tipo: string }[] = []
  for (let i = 0; i < COMPRA.length; i++) {
    pairs.push({ entry: COMPRA[i], tipo: 'Compra' })
    if (i < VENDA.length) pairs.push({ entry: VENDA[i], tipo: 'Venda' })
  }
  let created = 0
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i]
    onProgress(i + 1, pairs.length, `${i + 1}/${pairs.length} — ${p.tipo}: ${p.entry}`)
    await bx24CreateOne(p.entry, p.tipo, fm)
    created++
  }
  return { created }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function splitEntry(entry: string): { code: string; desc: string } {
  const m = entry.match(/^([^\s]+)\s*-\s*(.+)$/)
  if (m) return { code: m[1].trim(), desc: m[2].trim() }
  return { code: '', desc: entry.trim() }
}

function joinEntry(code: string, desc: string): string {
  return code ? `${code} - ${desc}` : desc
}

// ─── Dados padrão ─────────────────────────────────────────────────────────────

const COMPRA: string[] = [
  'A28 - Para 28 Dias', 'A30 - Para 30 Dias', 'A45 - Para 45 Dias',
  'A60 - Para 60 Dias', 'A74 - Para 75 Dias', 'A90 - Para 90 Dias',
  'B20 - Para 120 Dias', 'B50 - Para 150 Dias', 'S07 - 30/45/60 Dias',
  'S30 - 30/60/90 Dias', 'S53 - Para 30/60/90/120', 'S75 - Para 1/30/60/90',
  '000 - Para A Vista', '001 - Para 1 parcelas', '002 - Para 2 parcelas',
  '003 - Para 3 parcelas', '004 - Para 4 parcelas', '005 - Para 5 parcelas',
  '006 - Para 6 parcelas', '007 - Para 7 parcelas', '008 - Para 8 parcelas',
  '009 - Para 9 parcelas', '010 - Para 10 parcelas', '012 - Para 12 parcelas',
  '024 - Para 24 parcelas', '036 - Para 36 parcelas', '048 - Para 48 parcelas',
]

const VENDA: string[] = [
  'A28 - Para 28 Dias', 'T54 - Para 30 Dias', 'A45 - Para 45 Dias',
  'A60 - Para 60 Dias', 'A74 - Para 75 Dias', 'A90 - Para 90 Dias',
  'B20 - Para 120 Dias', 'B50 - Para 150 Dias', 'S23 - 30/45/60 Dias',
  'S18 - 30/60/90 Dias', 'S25 - Para 30/60/90/120', 'P66 - Para 1/30/60/90',
  '000 - Para A Vista', '001 - Para 1 parcelas', '002 - Para 2 parcelas',
  '003 - Para 3 parcelas', '004 - Para 4 parcelas', '005 - Para 5 parcelas',
  '006 - Para 6 parcelas', '007 - Para 7 parcelas', '008 - Para 8 parcelas',
  '009 - Para 9 parcelas', '010 - Para 10 parcelas', '012 - Para 12 parcelas',
  '024 - Para 24 parcelas', '036 - Para 36 parcelas', '048 - Para 48 parcelas',
]

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Condition = { id: string; displayName: string; tipo: string }
type TabType   = 'Todos' | 'Compra' | 'Venda'

// ─── Modal Exclusão ───────────────────────────────────────────────────────────

function DeleteModal({ item, onConfirm, onCancel, loading }: {
  item: Condition | null; onConfirm: () => void; onCancel: () => void; loading: boolean
}) {
  if (!item) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-5 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <h3 className="text-base font-bold">Excluir condição</h3>
              <p className="text-sm text-gray-500 mt-1">Ação <strong>permanente</strong> no Bitrix24.</p>
            </div>
          </div>
          <div className="p-3 bg-gray-50 border rounded-lg">
            <p className="text-sm font-semibold">{item.displayName}</p>
            <p className="text-xs text-gray-500">{item.tipo || '—'}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t bg-gray-50 rounded-b-xl">
          <Button variant="outline" onClick={onCancel} disabled={loading}>Cancelar</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading}>
            {loading
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Excluindo...</>
              : <><Trash2 className="w-4 h-4 mr-2" />Excluir</>}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal Criar/Editar ───────────────────────────────────────────────────────

function ConditionModal({ open, onClose, initial, onSaved }: {
  open: boolean; onClose: () => void; initial: Condition | null; onSaved: () => void
}) {
  const [entry, setEntry]   = useState('')
  const [tipo, setTipo]     = useState<'Compra' | 'Venda'>('Compra')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setEntry(initial?.displayName || '')
    setTipo((initial?.tipo as 'Compra' | 'Venda') || 'Compra')
  }, [initial, open])

  const { code, desc } = splitEntry(entry)

  const handleSave = async () => {
    if (!entry.trim()) { toast.error('Nome é obrigatório'); return }
    setSaving(true)
    try {
      if (initial) {
        await bx24Update(initial.id, entry.trim(), tipo)
        toast.success('Condição atualizada!')
      } else {
        await bx24Create(entry.trim(), tipo)
        toast.success('Condição criada!')
      }
      onSaved(); onClose()
    } catch (e: any) {
      toast.error(e.message || 'Erro ao salvar')
    } finally { setSaving(false) }
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold">{initial ? 'Editar Condição' : 'Nova Condição'}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-600">Tipo *</label>
            <div className="flex gap-2 mt-1">
              {(['Compra', 'Venda'] as const).map(t => (
                <button key={t} type="button" onClick={() => setTipo(t)}
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    tipo === t
                      ? t === 'Compra' ? 'bg-blue-600 text-white border-blue-600' : 'bg-green-600 text-white border-green-600'
                      : 'text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Código - Descrição *</label>
            <Input className="mt-1" placeholder="Ex: A28 - Para 28 Dias"
              value={entry} onChange={e => setEntry(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()} autoFocus />
            {entry && (
              <div className="mt-1.5 flex gap-3 text-xs text-gray-400">
                <span>Id: <strong className="text-gray-600">{code || '—'}</strong></span>
                <span>Nome: <strong className="text-gray-600">{desc || entry}</strong></span>
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t bg-gray-50 rounded-b-xl">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Salvando...</>
              : <><CheckCircle2 className="w-4 h-4 mr-2" />Salvar</>}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function PaymentConditionsPage() {
  const [conditions, setConditions] = useState<Condition[]>([])
  const [loading, setLoading]       = useState(false)
  const [bx24Ready, setBx24Ready]   = useState(false)
  const [bx24Error, setBx24Error]   = useState('')
  const [search, setSearch]         = useState('')
  const [activeTab, setActiveTab]   = useState<TabType>('Todos')
  const [modalOpen, setModalOpen]   = useState(false)
  const [editing, setEditing]       = useState<Condition | null>(null)
  const [confirmDel, setConfirmDel] = useState<Condition | null>(null)
  const [deleting, setDeleting]     = useState(false)
  const [seeding, setSeeding]       = useState(false)
  const [seedMsg, setSeedMsg]       = useState('')

  // Inicializa BX24 SDK
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
    if (existing) {
      existing.addEventListener('load', onLoad, { once: true })
      return () => { mounted = false; existing.removeEventListener('load', onLoad) }
    }

    const s = document.createElement('script')
    s.src = 'https://api.bitrix24.com/api/v1/'
    s.async = true
    s.onload = onLoad
    s.onerror = () => { if (mounted) setBx24Error('BX24 não disponível. Abra dentro do Bitrix24.') }
    document.head.appendChild(s)
    return () => { mounted = false }
  }, [])

  const load = async () => {
    setLoading(true)
    try {
      const all = await bx24GetAll()
      setConditions(all)
    } catch (e: any) {
      toast.error(e.message || 'Erro ao carregar')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (bx24Ready) load() }, [bx24Ready]) // eslint-disable-line

  const handleSeed = async () => {
    const total = COMPRA.length + VENDA.length
    if (!confirm(`Criar ${total} condições na lista ${LIST_ID}?\n• ${COMPRA.length} Compra  • ${VENDA.length} Venda`)) return
    setSeeding(true)
    try {
      const { created } = await bx24Seed((done, total, msg) => setSeedMsg(msg))
      toast.success(`${created} condições criadas!`)
      load()
    } catch (e: any) {
      toast.error(e.message || 'Erro ao importar')
    } finally { setSeeding(false); setSeedMsg('') }
  }

  const handleDelete = async () => {
    if (!confirmDel) return
    setDeleting(true)
    try {
      await bx24Delete(confirmDel.id)
      toast.success('Excluída.')
      setConditions(prev => prev.filter(c => c.id !== confirmDel.id))
      setConfirmDel(null)
    } catch (e: any) { toast.error(e.message || 'Erro') }
    finally { setDeleting(false) }
  }

  const compraCount = conditions.filter(c => c.tipo === 'Compra').length
  const vendaCount  = conditions.filter(c => c.tipo === 'Venda').length

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return conditions.filter(c => {
      const matchSearch = !q || c.displayName.toLowerCase().includes(q)
      const matchTab    = activeTab === 'Todos' || c.tipo === activeTab
      return matchSearch && matchTab
    })
  }, [conditions, search, activeTab])

  const tipoBadge = (tipo: string) => {
    if (tipo === 'Compra') return <Badge className="text-xs bg-blue-100 text-blue-700 border-blue-300 hover:bg-blue-100">Compra</Badge>
    if (tipo === 'Venda')  return <Badge className="text-xs bg-green-100 text-green-700 border-green-300 hover:bg-green-100">Venda</Badge>
    return <Badge variant="outline" className="text-xs text-gray-400">—</Badge>
  }

  if (bx24Error) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <p className="text-gray-600 font-medium">{bx24Error}</p>
    </div>
  )

  return (
    <div className="container mx-auto p-6 space-y-5">
      {seeding && (
        <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <Loader2 className="w-5 h-5 animate-spin text-blue-600 shrink-0" />
          <p className="text-sm text-blue-700 font-medium truncate">{seedMsg || 'Importando...'}</p>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Condições de Pagamento</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Lista #{LIST_ID} — <span className="text-blue-600">{compraCount} compra</span> / <span className="text-green-600">{vendaCount} venda</span>
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={load} disabled={loading || seeding}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />Atualizar
          </Button>
          <Button variant="outline" size="sm" onClick={handleSeed} disabled={seeding || loading}>
            {seeding
              ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Importando...</>
              : <><Download className="w-4 h-4 mr-1" />Importar Padrão</>}
          </Button>
          <Button size="sm" onClick={() => { setEditing(null); setModalOpen(true) }} disabled={seeding}>
            <Plus className="w-4 h-4 mr-1" />Nova Condição
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {(['Todos', 'Compra', 'Venda'] as TabType[]).map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === t ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
              {t}
              {t === 'Compra' && <span className="ml-1 text-xs text-blue-600">({compraCount})</span>}
              {t === 'Venda'  && <span className="ml-1 text-xs text-green-600">({vendaCount})</span>}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <Input className="pl-9 h-9 text-sm" placeholder="Buscar…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="border rounded-xl overflow-hidden shadow-sm bg-white">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600 mr-2" />
            <span className="text-gray-500">Carregando…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="font-medium">{search || activeTab !== 'Todos' ? 'Nenhum resultado' : 'Nenhuma condição cadastrada'}</p>
            {!search && activeTab === 'Todos' && !bx24Error && (
              <button onClick={handleSeed} className="text-sm text-blue-600 hover:underline mt-1">Importar padrão</button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Nome</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Tipo</th>
                <th className="px-4 py-2 w-20" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(c => (
                <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{c.displayName}</td>
                  <td className="px-4 py-3">{tipoBadge(c.tipo)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => { setEditing(c); setModalOpen(true) }} className="p-1.5 rounded hover:bg-blue-50 text-blue-600"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => setConfirmDel(c)} className="p-1.5 rounded hover:bg-red-50 text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && filtered.length > 0 && (
          <div className="px-4 py-2 bg-gray-50 border-t text-xs text-gray-400">
            {filtered.length} de {conditions.length} condições
          </div>
        )}
      </div>

      <ConditionModal open={modalOpen} onClose={() => setModalOpen(false)} initial={editing} onSaved={load} />
      <DeleteModal item={confirmDel} onConfirm={handleDelete} onCancel={() => setConfirmDel(null)} loading={deleting} />
    </div>
  )
}

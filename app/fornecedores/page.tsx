'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import type { BitrixSupplier } from '@/lib/bitrix-service'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  Loader2, Plus, Search, Upload, Pencil, Trash2, X,
  ChevronUp, ChevronDown, RefreshCw, Building2,
  AlertTriangle, CheckCircle2, Info, AlertCircle,
} from 'lucide-react'

// ─── BX24 helpers (client-side) ───────────────────────────────────────────────

declare const BX24: any

const LIST_ID = 61

/** Promisifica BX24.callMethod */
function bx24Call(method: string, params: Record<string, any> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    if (typeof BX24 === 'undefined') {
      reject(new Error('BX24 não disponível. Abra o app dentro do Bitrix24.'))
      return
    }
    BX24.callMethod(method, params, (res: any) => {
      if (res.error()) {
        const e = res.error()
        console.error(`[BX24] ${method} ERRO:`, e)
        reject(new Error(`[${e.error}] ${e.error_description || e.error || 'Erro BX24'}`))
      } else {
        resolve(res.data())
      }
    })
  })
}

type FieldMeta = { id: string; ptype: 'N' | 'HTML' | 'S' }

/**
 * Mapeia CODE → { id, ptype } via lists.field.get.
 * ptype: 'N' = Número, 'HTML' = S:HTML, 'S' = String genérico
 */
async function getFieldMap(listId: number): Promise<Record<string, FieldMeta>> {
  try {
    const data = await bx24Call('lists.field.get', {
      IBLOCK_TYPE_ID: 'lists',
      IBLOCK_ID: listId,
    })
    console.log('[BX24] lists.field.get raw:', JSON.stringify(data))
    const map: Record<string, FieldMeta> = {}
    for (const [key, info] of Object.entries(data as Record<string, any>)) {
      const i = info as any
      const isHtml = i.PROPERTY_USER_TYPE?.USER_TYPE === 'HTML' || String(i.TYPE || '').includes('HTML')
      const rawType = String(i.PROPERTY_TYPE || i.TYPE || 'S')
      const ptype: FieldMeta['ptype'] = isHtml ? 'HTML' : rawType === 'N' ? 'N' : 'S'
      const propMatch = key.match(/^PROPERTY_(\d+)$/)
      if (propMatch) {
        const code = String(i.CODE || i.code || '').toUpperCase().trim()
        if (code) map[code] = { id: propMatch[1], ptype }
      } else {
        const fid = String(i.FIELD_ID || i.field_id || i.ID || i.id || '').replace('PROPERTY_', '')
        if (fid && /^\d+$/.test(fid)) map[key.toUpperCase().trim()] = { id: fid, ptype }
      }
    }
    console.log('[BX24] field map:', JSON.stringify(map))
    return map
  } catch (e) {
    console.warn('[BX24] lists.field.get falhou:', e)
    return {}
  }
}

/**
 * Formata valor conforme o tipo do campo Bitrix24.
 * Para lists.element.add/update com propriedades de valor único (MULTIPLE: N),
 * o Bitrix24 espera o VALOR DIRETO (string) — sem wrapper { VALUE: ... }.
 * O wrapper quebra o form-encoding do BX24 SDK e gera 400/ajaxError.
 */
function makeVal(meta: FieldMeta | undefined, v: string | undefined): any {
  if (!v?.trim()) return undefined
  const val = v.trim()
  if (meta?.ptype === 'N') {
    // Número: apenas dígitos (ex: CNPJ "09.121.909/0001-72" → "09121909000172")
    const digits = val.replace(/\D/g, '')
    return digits || undefined
  }
  // HTML e String: texto plano direto
  return val
}

// Cache do mapa de campos
let _fieldMapCache: Record<string, FieldMeta> | null = null

async function fieldMap(): Promise<Record<string, FieldMeta>> {
  if (_fieldMapCache) return _fieldMapCache
  _fieldMapCache = await getFieldMap(LIST_ID)
  return _fieldMapCache
}

/** Extrai valor de PROPERTY_N lido do Bitrix24 (leitura) */
function readProp(el: any, key: string): string {
  const raw = el[key]
  if (!raw) return ''
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const first = Object.values(raw)[0] as any
    const val = first?.VALUE ?? first
    // HTML: { TYPE: "html", TEXT: "..." }
    if (val && typeof val === 'object' && val.TEXT !== undefined) return String(val.TEXT ?? '')
    return String(val ?? '')
  }
  if (Array.isArray(raw)) return String(raw[0] ?? '')
  return String(raw)
}

/** Converte elemento bruto em BitrixSupplier usando IDs numéricos reais */
function parseElement(el: any, fm: Record<string, FieldMeta>): BitrixSupplier {
  const g = (code: string) => {
    const byCode = readProp(el, `PROPERTY_${code}`)
    if (byCode) return byCode
    const meta = fm[code]
    return meta ? readProp(el, `PROPERTY_${meta.id}`) : ''
  }
  return {
    id: String(el.ID || ''),
    name: String(el.NAME || ''),
    cnpj: g('CNPJ'), ie: g('IE'), email: g('EMAIL'),
    contato: g('CONTATO'), telefone1: g('TELEFONE1'), telefone2: g('TELEFONE2'),
    endereco: g('ENDERECO'), numero: g('NUMERO'), complemento: g('COMPLEMENTO'),
    bairro: g('BAIRRO'), cidade: g('CIDADE'), estado: g('ESTADO'),
    cep: g('CEP'), enderecoCompleto: g('ENDERECO_COMPLETO'),
  }
}

// ─── CRUD via BX24 ────────────────────────────────────────────────────────────

async function bx24GetSuppliers(
  onPage?: (partial: BitrixSupplier[]) => void
): Promise<BitrixSupplier[]> {
  const fm = await fieldMap()
  const all: BitrixSupplier[] = []
  let start = 0

  // SELECT enxuto: só os IDs reais (PROPERTY_329, etc.) — sem os codes inexistentes
  const select = ['ID', 'NAME', ...Object.values(fm).map(m => `PROPERTY_${m.id}`)]

  const seen = new Set<string>()
  while (true) {
    const data = await bx24Call('lists.element.get', {
      IBLOCK_TYPE_ID: 'lists',
      IBLOCK_ID: LIST_ID,
      FILTER: { ACTIVE: 'Y' },
      SELECT: select,
      start,
    })

    const items: any[] = Array.isArray(data) ? data : Object.values(data || {})
    for (const el of items) {
      const sup = parseElement(el, fm)
      if (sup.id && !seen.has(sup.id)) {
        seen.add(sup.id)
        all.push(sup)
      }
    }

    // Render progressivo: entrega o que já carregou
    onPage?.([...all])

    if (items.length < 50) break
    start += 50
  }

  return all
}

async function bx24CreateSupplier(data: Omit<BitrixSupplier, 'id'>): Promise<string> {
  const fm = await fieldMap()
  const pk  = (code: string) => fm[code] ? `PROPERTY_${fm[code].id}` : `PROPERTY_${code}`
  const mv  = (code: string, v: string | undefined) => makeVal(fm[code], v)

  const fields: Record<string, any> = { NAME: data.name }
  const s = (code: string, v: string | undefined) => { const x = mv(code, v); if (x) fields[pk(code)] = x }
  s('CNPJ',              data.cnpj)
  s('IE',                data.ie)
  s('EMAIL',             data.email)
  s('CONTATO',           data.contato)
  s('TELEFONE1',         data.telefone1)
  s('TELEFONE2',         data.telefone2)
  s('ENDERECO',          data.endereco)
  s('NUMERO',            data.numero)
  s('COMPLEMENTO',       data.complemento)
  s('BAIRRO',            data.bairro)
  s('CIDADE',            data.cidade)
  s('ESTADO',            data.estado)
  s('CEP',               data.cep)
  s('ENDERECO_COMPLETO', data.enderecoCompleto)

  const elementCode = data.cnpj.replace(/\D/g, '') || String(Date.now())
  console.log('[BX24] create fields:', JSON.stringify(fields))

  const result = await bx24Call('lists.element.add', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_ID: LIST_ID,
    ELEMENT_CODE: elementCode,
    fields,
  })

  return String(result || '')
}

async function bx24UpdateSupplier(
  elementId: string,
  data: Partial<Omit<BitrixSupplier, 'id'>>
): Promise<void> {
  const fm = await fieldMap()
  const pk  = (code: string) => fm[code] ? `PROPERTY_${fm[code].id}` : `PROPERTY_${code}`
  const mv  = (code: string, v: string | undefined) => makeVal(fm[code], v) ?? ''

  const fields: Record<string, any> = {}
  if (data.name             !== undefined) fields.NAME              = data.name
  if (data.cnpj             !== undefined) fields[pk('CNPJ')]              = mv('CNPJ',             data.cnpj)
  if (data.ie               !== undefined) fields[pk('IE')]                = mv('IE',               data.ie)
  if (data.email            !== undefined) fields[pk('EMAIL')]             = mv('EMAIL',            data.email)
  if (data.contato          !== undefined) fields[pk('CONTATO')]           = mv('CONTATO',          data.contato)
  if (data.telefone1        !== undefined) fields[pk('TELEFONE1')]         = mv('TELEFONE1',        data.telefone1)
  if (data.telefone2        !== undefined) fields[pk('TELEFONE2')]         = mv('TELEFONE2',        data.telefone2)
  if (data.endereco         !== undefined) fields[pk('ENDERECO')]          = mv('ENDERECO',         data.endereco)
  if (data.numero           !== undefined) fields[pk('NUMERO')]            = mv('NUMERO',           data.numero)
  if (data.complemento      !== undefined) fields[pk('COMPLEMENTO')]       = mv('COMPLEMENTO',      data.complemento)
  if (data.bairro           !== undefined) fields[pk('BAIRRO')]            = mv('BAIRRO',           data.bairro)
  if (data.cidade           !== undefined) fields[pk('CIDADE')]            = mv('CIDADE',           data.cidade)
  if (data.estado           !== undefined) fields[pk('ESTADO')]            = mv('ESTADO',           data.estado)
  if (data.cep              !== undefined) fields[pk('CEP')]               = mv('CEP',              data.cep)
  if (data.enderecoCompleto !== undefined) fields[pk('ENDERECO_COMPLETO')] = mv('ENDERECO_COMPLETO',data.enderecoCompleto)

  await bx24Call('lists.element.update', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_ID: LIST_ID,
    ELEMENT_ID: elementId,
    fields,
  })
}

async function bx24DeleteSupplier(elementId: string): Promise<void> {
  await bx24Call('lists.element.delete', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_ID: LIST_ID,
    ELEMENT_ID: elementId,
  })
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

type SupplierForm = Omit<BitrixSupplier, 'id'>
const normCnpj = (s: string) => s.replace(/\D/g, '')

const EMPTY: SupplierForm = {
  name:'', cnpj:'', ie:'', email:'', contato:'',
  telefone1:'', telefone2:'', endereco:'', numero:'',
  complemento:'', bairro:'', cidade:'', estado:'', cep:'',
  enderecoCompleto:'',
}

// ─── Modal Confirmar Exclusão ─────────────────────────────────────────────────

function DeleteModal({ s, onConfirm, onCancel, loading }: {
  s: BitrixSupplier | null; onConfirm: () => void; onCancel: () => void; loading: boolean
}) {
  if (!s) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">Excluir fornecedor</h3>
              <p className="text-sm text-gray-500 mt-1">Esta ação é <strong>permanente</strong> no Bitrix24.</p>
            </div>
          </div>
          <div className="mt-4 p-3 bg-gray-50 border rounded-lg">
            <p className="text-sm font-semibold text-gray-800">{s.name}</p>
            {s.cnpj && <p className="text-xs text-gray-500 font-mono mt-0.5">CNPJ: {s.cnpj}</p>}
            {s.cidade && <p className="text-xs text-gray-500 mt-0.5">{[s.cidade, s.estado].filter(Boolean).join(' / ')}</p>}
          </div>
          <p className="text-sm text-red-600 font-medium mt-3">Tem certeza que deseja excluir?</p>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t bg-gray-50 rounded-b-xl">
          <Button variant="outline" onClick={onCancel} disabled={loading}>Cancelar</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading}>
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin"/>Excluindo...</> : <><Trash2 className="w-4 h-4 mr-2"/>Excluir</>}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal Confirmar Edição (diff) ────────────────────────────────────────────

const LABELS: Partial<Record<keyof BitrixSupplier, string>> = {
  name:'Fornecedor', cnpj:'CNPJ', ie:'I.E', email:'Email',
  contato:'Contato', telefone1:'Telefone 1', telefone2:'Telefone 2',
  endereco:'Logradouro', numero:'Número', complemento:'Complemento',
  bairro:'Bairro', cidade:'Cidade', estado:'UF', cep:'CEP',
  enderecoCompleto:'Endereço Completo',
}

type Diff = { field: keyof BitrixSupplier; label: string; from: string; to: string }

function buildDiff(orig: BitrixSupplier, upd: SupplierForm): Diff[] {
  return (Object.keys(LABELS) as (keyof BitrixSupplier)[]).flatMap(k => {
    const from = String((orig as any)[k] ?? '').trim()
    const to   = String((upd  as any)[k] ?? '').trim()
    return from !== to ? [{ field: k, label: LABELS[k]!, from, to }] : []
  })
}

function EditConfirmModal({ diffs, name, onConfirm, onCancel, loading }: {
  diffs: Diff[]; name: string; onConfirm: () => void; onCancel: () => void; loading: boolean
}) {
  if (!diffs.length) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
        <div className="px-6 py-4 border-b">
          <div className="flex items-center gap-2">
            <Info className="w-5 h-5 text-blue-600" />
            <h3 className="text-base font-bold text-gray-900">Confirmar alterações</h3>
          </div>
          <p className="text-sm text-gray-500 mt-1">Revise antes de salvar em <strong>{name}</strong>:</p>
        </div>
        <div className="px-6 py-4 space-y-2">
          {diffs.map(d => (
            <div key={d.field} className="border rounded-lg overflow-hidden text-sm">
              <div className="px-3 py-1.5 bg-gray-50 border-b font-semibold text-gray-700">{d.label}</div>
              <div className="grid grid-cols-2 divide-x text-xs">
                <div className="px-3 py-2 bg-red-50">
                  <p className="text-red-500 font-medium mb-0.5 uppercase tracking-wide text-[10px]">Antes</p>
                  <p className="text-gray-700 break-all">{d.from || <span className="italic text-gray-400">vazio</span>}</p>
                </div>
                <div className="px-3 py-2 bg-green-50">
                  <p className="text-green-600 font-medium mb-0.5 uppercase tracking-wide text-[10px]">Depois</p>
                  <p className="text-gray-700 break-all">{d.to || <span className="italic text-gray-400">vazio</span>}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t bg-gray-50 rounded-b-xl">
          <Button variant="outline" onClick={onCancel} disabled={loading}>Voltar e editar</Button>
          <Button onClick={onConfirm} disabled={loading}>
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin"/>Salvando...</> : <><CheckCircle2 className="w-4 h-4 mr-2"/>Confirmar</>}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Formulário Add/Edit ──────────────────────────────────────────────────────

function SupplierDialog({ open, onClose, initial, existing, onSaved }: {
  open: boolean; onClose: () => void
  initial: BitrixSupplier | null
  existing: BitrixSupplier[]
  onSaved: () => void
}) {
  const [form, setForm]           = useState<SupplierForm>(EMPTY)
  const [saving, setSaving]       = useState(false)
  const [duplicate, setDuplicate] = useState<BitrixSupplier | null>(null)
  const [diffs, setDiffs]         = useState<Diff[]>([])
  const [showDiff, setShowDiff]   = useState(false)

  useEffect(() => {
    setForm(initial ? { ...initial } : { ...EMPTY })
    setDuplicate(null); setDiffs([]); setShowDiff(false)
  }, [initial, open])

  const set = (k: keyof SupplierForm, v: string) => {
    setForm(f => ({ ...f, [k]: v }))
    if (k === 'cnpj' && !initial) {
      const norm = normCnpj(v)
      if (norm.length >= 14)
        setDuplicate(existing.find(s => normCnpj(s.cnpj) === norm) ?? null)
      else
        setDuplicate(null)
    }
  }

  const buildAddr = () => {
    const parts = [
      form.endereco && form.numero ? `${form.endereco}, ${form.numero}` : form.endereco,
      form.cep ? `CEP: ${form.cep}` : '',
      form.complemento, form.bairro,
      form.cidade && form.estado ? `${form.cidade}/${form.estado}` : form.cidade,
    ].filter(Boolean)
    set('enderecoCompleto', parts.join(' - '))
  }

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Nome é obrigatório'); return }

    if (initial) {
      const d = buildDiff(initial, form)
      if (!d.length) { toast.info('Nenhuma alteração detectada.'); onClose(); return }
      setDiffs(d); setShowDiff(true); return
    }

    if (duplicate) { toast.error(`CNPJ já cadastrado para "${duplicate.name}"`); return }
    await doCreate()
  }

  const doCreate = async () => {
    setSaving(true)
    try {
      await bx24CreateSupplier(form)
      toast.success('Fornecedor criado!'); onSaved(); onClose()
    } catch (e: any) { toast.error(e.message || 'Erro ao criar') }
    finally { setSaving(false) }
  }

  const doUpdate = async (targetId: string) => {
    setSaving(true)
    try {
      await bx24UpdateSupplier(targetId, form)
      toast.success('Fornecedor atualizado!')
      setShowDiff(false); onSaved(); onClose()
    } catch (e: any) { toast.error(e.message || 'Erro ao atualizar'); setShowDiff(false) }
    finally { setSaving(false) }
  }

  if (!open) return null

  const F = ({ label, field, placeholder, type = 'text' }: {
    label: string; field: keyof SupplierForm; placeholder?: string; type?: string
  }) => (
    <div>
      <label className="text-xs font-medium text-gray-600">{label}</label>
      <Input className="mt-1 h-8 text-sm" type={type}
        placeholder={placeholder || label} value={form[field]}
        onChange={e => set(field, e.target.value)} />
    </div>
  )

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between px-6 py-4 border-b">
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-blue-600" />
              <h2 className="text-lg font-bold">{initial ? 'Editar Fornecedor' : 'Novo Fornecedor'}</h2>
            </div>
            <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
          </div>

          <div className="px-6 py-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <label className="text-xs font-medium text-gray-600">Distribuidor / Fornecedor *</label>
                <Input className="mt-1 h-9 text-sm font-medium" placeholder="Nome"
                  value={form.name} onChange={e => set('name', e.target.value)} />
              </div>

              {/* CNPJ com check de duplicidade */}
              <div>
                <label className="text-xs font-medium text-gray-600">CNPJ</label>
                <Input
                  className={`mt-1 h-8 text-sm ${!initial && duplicate ? 'border-amber-400' : ''}`}
                  placeholder="00.000.000/0000-00"
                  value={form.cnpj} onChange={e => set('cnpj', e.target.value)}
                />
                {!initial && duplicate && (
                  <div className="mt-1.5 p-2.5 bg-amber-50 border border-amber-300 rounded-lg text-xs space-y-1.5">
                    <p className="text-amber-700 font-semibold flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />CNPJ já cadastrado
                    </p>
                    <p className="text-amber-700">{duplicate.name}</p>
                    <div className="flex gap-1.5 pt-0.5">
                      <button type="button"
                        onClick={() => { const d = buildDiff(duplicate, form); if(d.length){setDiffs(d);setShowDiff(true)} else toast.info('Sem alterações') }}
                        className="px-2 py-1 bg-amber-600 text-white rounded text-[11px] font-medium hover:bg-amber-700">
                        Atualizar existente
                      </button>
                      <button type="button" onClick={() => setDuplicate(null)}
                        className="px-2 py-1 border border-amber-400 text-amber-700 rounded text-[11px] font-medium">
                        Criar mesmo assim
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <F label="Inscrição Estadual (I.E)" field="ie" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <F label="Contato" field="contato" />
              <F label="Telefone 1" field="telefone1" type="tel" />
              <F label="Telefone 2" field="telefone2" type="tel" />
            </div>
            <F label="Email" field="email" type="email" />

            <div className="border-t pt-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Endereço</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2"><F label="Logradouro" field="endereco" /></div>
                <F label="Número" field="numero" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                <F label="Complemento" field="complemento" />
                <F label="Bairro" field="bairro" />
                <F label="CEP" field="cep" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <F label="Cidade" field="cidade" />
                <F label="Estado (UF)" field="estado" />
              </div>
              <div className="mt-3 flex items-end gap-2">
                <div className="flex-1">
                  <label className="text-xs font-medium text-gray-600">Endereço Completo</label>
                  <Input className="mt-1 h-8 text-sm text-gray-500"
                    value={form.enderecoCompleto}
                    onChange={e => set('enderecoCompleto', e.target.value)}
                    placeholder="Gerado automaticamente ou edite" />
                </div>
                <Button type="button" variant="outline" size="sm" onClick={buildAddr} className="h-8 shrink-0">Gerar</Button>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 px-6 py-4 border-t bg-gray-50 rounded-b-xl">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving || (!initial && !!duplicate && !showDiff)}>
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin"/>Salvando...</> : initial ? 'Salvar alterações' : 'Criar fornecedor'}
            </Button>
          </div>
        </div>
      </div>

      {showDiff && (
        <EditConfirmModal
          diffs={diffs}
          name={initial?.name ?? duplicate?.name ?? form.name}
          onConfirm={() => doUpdate(initial?.id ?? duplicate!.id)}
          onCancel={() => setShowDiff(false)}
          loading={saving}
        />
      )}
    </>
  )
}

// ─── Modal Importação CSV ─────────────────────────────────────────────────────

type DupPolicy = 'skip' | 'update' | 'create'
type Row = { data: SupplierForm; dup: BitrixSupplier | null }

function parseCsvText(text: string): string[][] {
  const rows: string[][] = []
  let cur = '', inQ = false
  let row: string[] = []
  let i = 0
  const pushRow = () => {
    row.push(cur); cur = ''
    if (row.some(c => c.trim())) rows.push(row)
    row = []
  }
  while (i < text.length) {
    const c = text[i]
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i += 2; continue }
        inQ = false
      } else { cur += c }
    } else {
      if      (c === '"')  { inQ = true }
      else if (c === ',')  { row.push(cur); cur = '' }
      else if (c === '\r') { if (text[i + 1] === '\n') i++; pushRow() }
      else if (c === '\n') { pushRow() }
      else { cur += c }
    }
    i++
  }
  if (row.length > 0 || cur) { row.push(cur); if (row.some(c => c.trim())) rows.push(row) }
  return rows
}

function ImportModal({ open, onClose, existing, onImported }: {
  open: boolean; onClose: () => void; existing: BitrixSupplier[]; onImported: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows]         = useState<Row[]>([])
  const [policy, setPolicy]     = useState<DupPolicy>('skip')
  const [importing, setImporting] = useState(false)
  const [result, setResult]     = useState<{created:number;updated:number;skipped:number;errors:any[]}|null>(null)
  const [parseErr, setParseErr] = useState('')

  const reset = () => { setRows([]); setResult(null); setParseErr(''); setPolicy('skip'); if(fileRef.current) fileRef.current.value='' }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setParseErr(''); setRows([]); setResult(null)
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const buffer = ev.target?.result as ArrayBuffer
        // Auto-detect encoding: try UTF-8 (strict), fall back to Latin-1 (padrão do Excel/Windows)
        let text: string
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
          if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1) // remove BOM
        } catch {
          text = new TextDecoder('iso-8859-1').decode(buffer)
        }
        const allRows = parseCsvText(text)
        if (allRows.length < 2) { setParseErr('Arquivo vazio'); return }
        const parsed: Row[] = []
        for (let i = 1; i < allRows.length; i++) {
          const c = allRows[i]
          if (!c[0]?.trim()) continue
          const cl = (j: number) => (c[j] || '').replace(/[\r\n\t]+/g, ' ').trim()
          const data: SupplierForm = {
            name:cl(0), cnpj:cl(1), ie:cl(2), email:cl(3), contato:cl(4),
            telefone1:cl(5), telefone2:cl(6), endereco:cl(7), numero:cl(8),
            complemento:cl(9), bairro:cl(10), cidade:cl(11), estado:cl(12),
            cep:cl(13), enderecoCompleto:cl(14),
          }
          if (!data.name) continue
          const norm = normCnpj(data.cnpj)
          const dup  = norm ? (existing.find(s => normCnpj(s.cnpj) === norm) ?? null) : null
          parsed.push({ data, dup })
        }
        setRows(parsed)
      } catch (err: any) { setParseErr('Erro: ' + err.message) }
    }
    reader.readAsArrayBuffer(file)
  }

  const dupCount = rows.filter(r => r.dup).length
  const newCount = rows.filter(r => !r.dup).length

  const handleImport = async () => {
    setImporting(true)
    let created=0, updated=0, skipped=0
    const errors: any[] = []
    for (let i = 0; i < rows.length; i++) {
      const { data, dup } = rows[i]
      try {
        if (dup) {
          if (policy === 'skip')   { skipped++; continue }
          if (policy === 'update') { await bx24UpdateSupplier(dup.id, data); updated++ }
          else                     { await bx24CreateSupplier(data); created++ }
        } else {
          await bx24CreateSupplier(data); created++
        }
      } catch (err: any) { errors.push({ row: i+1, name: data.name, error: err.message }) }
    }
    setResult({ created, updated, skipped, errors })
    if (created > 0 || updated > 0) onImported()
    setImporting(false)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-bold">Importar Fornecedores via CSV</h2>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400"/></button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
            <p className="font-medium mb-1">Formato esperado:</p>
            <p className="font-mono text-xs">FORNECEDOR, CNPJ, I.E, Email, Contato, Tel1, Tel2, Endereço, Nº, Compl, Bairro, Cidade, Estado, CEP, Endereço Completo</p>
          </div>

          {!result && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Arquivo CSV</label>
              <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile}
                className="block w-full text-sm file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer border rounded-md p-1" />
              {parseErr && <p className="mt-1 text-xs text-red-600 flex items-center gap-1"><AlertCircle className="w-3 h-3"/>{parseErr}</p>}
            </div>
          )}

          {rows.length > 0 && !result && dupCount > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg space-y-2">
              <p className="text-amber-700 font-semibold text-sm flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4"/>{dupCount} duplicado(s) · {newCount} novo(s)
              </p>
              <div className="space-y-1.5">
                {([['skip','Ignorar duplicados'],['update','Atualizar cadastros existentes'],['create','Criar mesmo assim']] as [DupPolicy,string][])
                  .map(([v,l]) => (
                    <label key={v} className="flex items-center gap-2 cursor-pointer text-sm text-amber-800">
                      <input type="radio" name="dp" value={v} checked={policy===v} onChange={()=>setPolicy(v)} className="accent-amber-600"/>
                      {l}
                    </label>
                  ))}
              </div>
            </div>
          )}

          {rows.length > 0 && !result && (
            <div>
              <div className="flex justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">{rows.length} registro(s)</p>
                <button onClick={reset} className="text-xs text-red-500 hover:underline">Limpar</button>
              </div>
              <div className="border rounded-lg overflow-hidden max-h-56 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>{['#','Status','Fornecedor','CNPJ','Cidade/UF'].map(h=>(
                      <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((r,i) => (
                      <tr key={i} className={r.dup ? 'bg-amber-50/60' : 'hover:bg-gray-50'}>
                        <td className="px-3 py-1.5 text-gray-400">{i+1}</td>
                        <td className="px-3 py-1.5">
                          {r.dup
                            ? <Badge className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-700 border-amber-300">Duplicado</Badge>
                            : <Badge className="text-[10px] px-1.5 py-0 bg-green-100 text-green-700 border-green-300">Novo</Badge>}
                        </td>
                        <td className="px-3 py-1.5 font-medium max-w-[160px] truncate" title={r.data.name}>
                          {r.data.name}
                          {r.dup && <p className="text-[10px] text-amber-600">Existe: {r.dup.name}</p>}
                        </td>
                        <td className="px-3 py-1.5 font-mono">{r.data.cnpj}</td>
                        <td className="px-3 py-1.5">{[r.data.cidade, r.data.estado].filter(Boolean).join('/')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result && (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2">
                {[['Criados',result.created,'bg-green-50 border-green-200 text-green-700'],
                  ['Atualizados',result.updated,'bg-blue-50 border-blue-200 text-blue-700'],
                  ['Ignorados',result.skipped,'bg-gray-50 border-gray-200 text-gray-600'],
                  ['Erros',result.errors.length,'bg-red-50 border-red-200 text-red-600'],
                ].map(([l,v,cls]) => (
                  <div key={l as string} className={`p-3 rounded-lg border text-center ${cls}`}>
                    <p className="text-2xl font-bold">{v}</p>
                    <p className="text-xs font-medium mt-0.5">{l}</p>
                  </div>
                ))}
              </div>
              {(result.errors.length > 0) && (
                <div className="border rounded-lg overflow-hidden max-h-36 overflow-y-auto text-xs">
                  <table className="w-full">
                    <thead className="bg-red-50 sticky top-0">
                      <tr>{['Linha','Fornecedor','Erro'].map(h=><th key={h} className="px-3 py-2 text-left text-red-700">{h}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y">
                      {result.errors.map((e,i) => (
                        <tr key={i} className="bg-red-50/40">
                          <td className="px-3 py-1.5">{e.row}</td>
                          <td className="px-3 py-1.5">{e.name}</td>
                          <td className="px-3 py-1.5 text-red-600">{e.error}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t bg-gray-50 rounded-b-xl">
          {!result ? (
            <>
              <Button variant="outline" onClick={onClose} disabled={importing}>Cancelar</Button>
              <Button onClick={handleImport} disabled={!rows.length || importing}>
                {importing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin"/>Importando...</> : <><Upload className="w-4 h-4 mr-2"/>Importar {rows.length>0?`(${rows.length})`:''}</>}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={()=>{reset();onClose()}}>Fechar</Button>
              <Button variant="outline" onClick={reset}>Nova Importação</Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function FornecedoresPage() {
  const [suppliers, setSuppliers] = useState<BitrixSupplier[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [sortKey, setSortKey]     = useState<keyof BitrixSupplier>('name')
  const [sortAsc, setSortAsc]     = useState(true)
  const [bx24Ready, setBx24Ready] = useState(false)
  const [bx24Error, setBx24Error] = useState('')

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing]       = useState<BitrixSupplier | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [confirmDel, setConfirmDel] = useState<BitrixSupplier | null>(null)
  const [deleting, setDeleting]     = useState(false)

  // Carrega o SDK do Bitrix24 e inicializa BX24
  useEffect(() => {
    let mounted = true

    const initBX24 = () => {
      if (!mounted) return
      if (typeof BX24 === 'undefined' || !BX24) {
        setBx24Error('BX24 não disponível. Abra o app dentro do Bitrix24.')
        setLoading(false)
        return
      }
      BX24.init(() => { if (mounted) setBx24Ready(true) })
    }

    // SDK já disponível (carregado por outra página/frame)
    if (typeof BX24 !== 'undefined' && BX24) {
      initBX24()
      return () => { mounted = false }
    }

    // Script já existe no DOM mas pode não ter terminado de carregar
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://api.bitrix24.com/api/v1/"]'
    )
    if (existing) {
      existing.addEventListener('load', initBX24, { once: true })
      return () => { mounted = false; existing.removeEventListener('load', initBX24) }
    }

    // Injeta o SDK do Bitrix24
    const script = document.createElement('script')
    script.src = 'https://api.bitrix24.com/api/v1/'
    script.async = true
    script.onload = initBX24
    script.onerror = () => {
      if (mounted) {
        setBx24Error('Falha ao carregar o SDK do Bitrix24. Verifique a conexão.')
        setLoading(false)
      }
    }
    document.head.appendChild(script)

    return () => { mounted = false }
  }, [])

  const load = useCallback(async () => {
    if (!bx24Ready) return
    setLoading(true)
    try {
      // Render progressivo: mostra cada página assim que chega
      const list = await bx24GetSuppliers(partial => {
        setSuppliers(partial)
        setLoading(false) // primeiros resultados já visíveis
      })
      setSuppliers(list)
    } catch (e: any) {
      toast.error(e.message || 'Erro ao carregar fornecedores')
    } finally {
      setLoading(false)
    }
  }, [bx24Ready])

  useEffect(() => { if (bx24Ready) load() }, [bx24Ready, load])

  const handleDeleteConfirmed = async () => {
    if (!confirmDel) return
    setDeleting(true)
    try {
      await bx24DeleteSupplier(confirmDel.id)
      toast.success(`"${confirmDel.name}" excluído.`)
      setConfirmDel(null)
      await load()
    } catch (e: any) { toast.error(e.message || 'Erro ao excluir') }
    finally { setDeleting(false) }
  }

  const handleSort = (k: keyof BitrixSupplier) => {
    if (sortKey === k) setSortAsc(a => !a); else { setSortKey(k); setSortAsc(true) }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return suppliers
      .filter(s => !q || s.name.toLowerCase().includes(q) || s.cnpj.includes(q) || s.cidade.toLowerCase().includes(q) || s.email.toLowerCase().includes(q))
      .sort((a,b) => {
        const va = String(a[sortKey]??'').toLowerCase()
        const vb = String(b[sortKey]??'').toLowerCase()
        return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va)
      })
  }, [suppliers, search, sortKey, sortAsc])

  const Si = ({ k }: { k: keyof BitrixSupplier }) =>
    sortKey!==k ? null : sortAsc ? <ChevronUp className="w-3 h-3 ml-1 inline"/> : <ChevronDown className="w-3 h-3 ml-1 inline"/>

  const Th = ({ k, children }: { k: keyof BitrixSupplier; children: React.ReactNode }) => (
    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-700 select-none"
      onClick={() => handleSort(k)}>{children}<Si k={k}/></th>
  )

  if (bx24Error) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center p-6">
        <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3"/>
        <p className="font-semibold text-gray-700">{bx24Error}</p>
      </div>
    </div>
  )

  return (
    <div className="container mx-auto p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Fornecedores</h1>
          <p className="text-sm text-gray-500 mt-0.5">Lista Bitrix24 #{LIST_ID} — {suppliers.length} cadastrado(s)</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading || !bx24Ready}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading?'animate-spin':''}`}/>Atualizar
          </Button>
          <Button variant="outline" size="sm" onClick={()=>setImportOpen(true)} disabled={!bx24Ready}>
            <Upload className="w-4 h-4 mr-1"/>Importar CSV
          </Button>
          <Button size="sm" onClick={()=>{setEditing(null);setDialogOpen(true)}} disabled={!bx24Ready}>
            <Plus className="w-4 h-4 mr-1"/>Novo Fornecedor
          </Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"/>
        <Input className="pl-9 h-9 text-sm" placeholder="Buscar por nome, CNPJ, cidade…"
          value={search} onChange={e=>setSearch(e.target.value)}/>
      </div>

      <div className="border rounded-xl overflow-hidden shadow-sm bg-white">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600 mr-2"/>
            <span className="text-gray-500">Carregando fornecedores…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30"/>
            <p className="font-medium">{search ? 'Nenhum resultado' : 'Nenhum fornecedor cadastrado'}</p>
            {!search && (
              <p className="text-sm mt-1">
                <button onClick={()=>setImportOpen(true)} className="text-blue-600 hover:underline">Importar CSV</button>
                {' '}ou{' '}
                <button onClick={()=>{setEditing(null);setDialogOpen(true)}} className="text-blue-600 hover:underline">Novo Fornecedor</button>
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <Th k="name">Fornecedor</Th>
                  <Th k="cnpj">CNPJ</Th>
                  <Th k="contato">Contato</Th>
                  <Th k="telefone1">Telefone</Th>
                  <Th k="email">Email</Th>
                  <Th k="cidade">Cidade</Th>
                  <Th k="estado">UF</Th>
                  <th className="px-4 py-2 w-20"/>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{s.name}</p>
                      {s.ie && <p className="text-xs text-gray-400 mt-0.5">IE: {s.ie}</p>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{s.cnpj||'—'}</td>
                    <td className="px-4 py-3 text-gray-700">{s.contato||'—'}</td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {s.telefone1||'—'}
                      {s.telefone2 && <p className="text-xs text-gray-400">{s.telefone2}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-700 max-w-[160px] truncate" title={s.email}>{s.email||'—'}</td>
                    <td className="px-4 py-3 text-gray-700">{s.cidade||'—'}</td>
                    <td className="px-4 py-3">{s.estado ? <Badge variant="outline" className="text-xs">{s.estado}</Badge> : '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 justify-end">
                        <button onClick={()=>{setEditing(s);setDialogOpen(true)}}
                          className="p-1.5 rounded hover:bg-blue-50 text-blue-600" title="Editar">
                          <Pencil className="w-3.5 h-3.5"/>
                        </button>
                        <button onClick={()=>setConfirmDel(s)}
                          className="p-1.5 rounded hover:bg-red-50 text-red-500" title="Excluir">
                          <Trash2 className="w-3.5 h-3.5"/>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-2 bg-gray-50 border-t text-xs text-gray-400">
              Mostrando {filtered.length} de {suppliers.length} fornecedores
            </div>
          </div>
        )}
      </div>

      <SupplierDialog open={dialogOpen} onClose={()=>setDialogOpen(false)}
        initial={editing} existing={suppliers} onSaved={load} />

      <ImportModal open={importOpen} onClose={()=>setImportOpen(false)}
        existing={suppliers} onImported={load} />

      <DeleteModal s={confirmDel} onConfirm={handleDeleteConfirmed}
        onCancel={()=>setConfirmDel(null)} loading={deleting} />
    </div>
  )
}

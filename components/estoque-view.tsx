'use client'

import { useState } from 'react'
import { getStockComparisonAction } from '@/lib/actions'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Loader2, RefreshCw, Search, PackageSearch } from 'lucide-react'

type Filtro = 'todos' | 'casados' | 'soCatalogo' | 'soOmie' | 'comSaldo' | 'excedeOmie'

const FILTROS: { id: Filtro; label: string }[] = [
  { id: 'todos',      label: 'Todos' },
  { id: 'casados',    label: 'Nos dois' },
  { id: 'soCatalogo', label: 'Só no catálogo' },
  { id: 'soOmie',     label: 'Só no Omie' },
  { id: 'comSaldo',   label: 'Com saldo' },
  { id: 'excedeOmie', label: 'Descrição > 120' },
]

const MATCH_BADGE: Record<string, { label: string; cls: string }> = {
  integracao: { label: 'exato',      cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  descricao:  { label: 'heurístico', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  nenhum:     { label: '—',          cls: 'bg-gray-50 text-gray-500 ring-gray-200' },
}

const num = (n: number) => new Intl.NumberFormat('pt-BR').format(n)
const moeda = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n || 0)

export function EstoqueView() {
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')
  const [rows, setRows] = useState<any[]>([])
  const [resumo, setResumo] = useState<any>(null)
  const [branch, setBranch] = useState<'barueri' | 'es'>('barueri')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [busca, setBusca] = useState('')

  const carregar = async () => {
    setLoading(true); setErro(''); setRows([]); setResumo(null)
    const r = await getStockComparisonAction(branch)
    setLoading(false)
    if (!r.success) { setErro(r.error || 'Falha ao consultar o Omie'); return }
    setRows(r.rows)
    setResumo(r.resumo)
  }

  const q = busca.trim().toLowerCase()
  const visiveis = rows.filter(r => {
    if (filtro === 'casados'    && r.match === 'nenhum') return false
    if (filtro === 'soCatalogo' && !(r.partnumber && r.match === 'nenhum')) return false
    if (filtro === 'soOmie'     && r.partnumber) return false
    if (filtro === 'comSaldo'   && !(r.omie?.saldo > 0)) return false
    if (filtro === 'excedeOmie' && !r.excedeOmie) return false
    if (!q) return true
    return [r.partnumber, r.descricaoCatalogo, r.omie?.codigo, r.omie?.descricao]
      .some((v: any) => String(v ?? '').toLowerCase().includes(q))
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <PackageSearch className="w-6 h-6 text-indigo-600" /> Estoque
        </h1>
        <div className="flex items-center gap-1 ml-auto">
          {(['barueri', 'es'] as const).map(b => (
            <button
              key={b}
              onClick={() => setBranch(b)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                branch === b ? 'bg-indigo-600 text-white border-indigo-600' : 'text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {b === 'barueri' ? 'Barueri (SP)' : 'Filial ES'}
            </button>
          ))}
          <Button onClick={carregar} disabled={loading} size="sm" className="ml-2 gap-1.5">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {loading ? 'Consultando o Omie…' : 'Carregar'}
          </Button>
        </div>
      </div>

      {loading && (
        <p className="text-sm text-gray-500">
          O Omie devolve 50 itens por página e são ~55 páginas, com pausa entre elas para não
          bater no rate-limit. Isso leva cerca de um minuto.
        </p>
      )}

      {erro && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{erro}</div>
      )}

      {resumo && (
        <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
          {[
            { label: 'No Omie',        v: num(resumo.omieCarregados) },
            { label: 'Catálogo Bitrix', v: num(resumo.catalogoBitrix) },
            { label: 'Catálogo local',  v: num(resumo.catalogoLocal) },
            { label: 'Nos dois',        v: num(resumo.casados) },
            { label: 'Só no catálogo',  v: num(resumo.soNoCatalogo) },
            { label: 'Só no Omie',      v: num(resumo.soNoOmie) },
            { label: 'Descrição > 120', v: num(resumo.excedemOmie) },
          ].map(c => (
            <div key={c.label} className="rounded-xl border bg-white px-3 py-2">
              <p className="text-[11px] uppercase text-gray-500 font-semibold">{c.label}</p>
              <p className="text-lg font-bold text-gray-800">{c.v}</p>
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {FILTROS.map(f => (
              <button
                key={f.id}
                onClick={() => setFiltro(f.id)}
                className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                  filtro === f.id ? 'bg-gray-800 text-white border-gray-800' : 'text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {f.label}
              </button>
            ))}
            <div className="relative ml-auto w-full sm:w-72">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input
                className="pl-8 h-9 text-sm"
                placeholder="Part number, código ou descrição"
                value={busca}
                onChange={e => setBusca(e.target.value)}
              />
            </div>
          </div>

          <p className="text-xs text-gray-500">{num(visiveis.length)} de {num(rows.length)} linhas</p>

          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left p-2">Part number</th>
                  <th className="text-left p-2">Partnumber / Descrição (catálogo)</th>
                  <th className="text-left p-2">Código Omie</th>
                  <th className="text-left p-2">Descrição (Omie)</th>
                  <th className="text-center p-2">Casamento</th>
                  <th className="text-center p-2">Descrição Omie</th>
                  <th className="text-right p-2">Saldo</th>
                  <th className="text-right p-2">Reservado</th>
                  <th className="text-right p-2">Custo médio</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visiveis.slice(0, 500).map((r, i) => {
                  const badge = MATCH_BADGE[r.match] ?? MATCH_BADGE.nenhum
                  return (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="p-2 font-medium max-w-[200px] truncate" title={r.partnumber}>
                        {r.partnumber || <span className="text-gray-400">—</span>}
                        {r.origemCatalogo && (
                          <span className="ml-1.5 text-[10px] text-gray-400">{r.origemCatalogo}</span>
                        )}
                      </td>
                      <td
                        className={`p-2 max-w-[220px] truncate ${r.excedeOmie ? 'text-red-600' : 'text-gray-600'}`}
                        title={r.descricaoCatalogo}
                      >
                        {r.descricaoCatalogo || '—'}
                      </td>
                      <td className="p-2">{r.omie?.codigo || <span className="text-gray-400">—</span>}</td>
                      <td className="p-2 text-gray-600 max-w-[260px] truncate">{r.omie?.descricao || '—'}</td>
                      <td className="p-2 text-center">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="p-2 text-center whitespace-nowrap">
                        {!r.partnumber ? (
                          <span className="text-gray-300">—</span>
                        ) : r.excedeOmie ? (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 bg-red-50 text-red-700 ring-red-200">
                            {r.descricaoLen} — excede 120
                          </span>
                        ) : (
                          <span className="text-[10px] text-gray-400">{r.descricaoLen}</span>
                        )}
                      </td>
                      <td className={`p-2 text-right font-medium ${r.omie?.saldo > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>
                        {r.omie ? num(r.omie.saldo) : '—'}
                      </td>
                      <td className="p-2 text-right text-gray-500">{r.omie ? num(r.omie.reservado) : '—'}</td>
                      <td className="p-2 text-right text-gray-500">{r.omie ? moeda(r.omie.custoMedio) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {visiveis.length > 500 && (
            <p className="text-xs text-gray-400">Mostrando as primeiras 500 linhas — refine a busca.</p>
          )}
        </>
      )}

      {!loading && !rows.length && !erro && (
        <p className="text-sm text-gray-400 py-10 text-center">
          Clique em "Carregar" para consultar a posição de estoque no Omie.
        </p>
      )}
    </div>
  )
}

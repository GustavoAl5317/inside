"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Loader2, Search, FileSpreadsheet, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatCurrency } from "@/lib/utils"

interface Linha {
  filial: string; cliente: string; proposta: string; pedido: string; oc: string
  account: string; partNumber: string; descricao: string; qtde: number
  custoUnitario: number; custoTotal: number; vendaUnitario: number; vendaTotal: number
  natureza: string; nfDistribuidor: string; dataFatFornecedor: string
  nfInteratell: string; dataFatInteratell: string; fornecedor: string
  faturamentoDireto: string; envioPedido: string; statusDistribuidor: string
}

const hoje = new Date()
const ddmmaaaa = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
const dataBR = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '—')
}

/**
 * Status das Ordens de Compra: o mesmo conteúdo da planilha que o time mantinha
 * à mão, montado na hora a partir do Omie e do Bitrix.
 */
export function StatusOcView() {
  const [de, setDe] = useState(ddmmaaaa(new Date(hoje.getFullYear(), hoje.getMonth(), 1)))
  const [ate, setAte] = useState(ddmmaaaa(hoje))
  const [linhas, setLinhas] = useState<Linha[] | null>(null)
  const [avisos, setAvisos] = useState<string[]>([])
  const [carregando, setCarregando] = useState(false)
  const [baixando, setBaixando] = useState(false)
  const [fornecedor, setFornecedor] = useState("__todos__")
  const [status, setStatus] = useState("__todos__")
  const [busca, setBusca] = useState("")

  // Com o app servido em uma subrota (NEXT_PUBLIC_BASE_PATH), uma URL começando
  // em "/" cai na raiz do domínio, que é outro app. O prefixo tem de ir junto.
  const api = (busca: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/api/status-oc?${busca}`
  const periodo = () => `de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`

  const consultar = async () => {
    setCarregando(true)
    try {
      const r = await fetch(api(periodo()), { cache: 'no-store' })
      const j = await r.json()
      if (!j.success) { toast.error(j.error || 'Erro ao consultar.'); return }
      setLinhas(j.linhas)
      setAvisos(j.avisos ?? [])
      toast.success(`${j.linhas.length} item(ns) · ${j.chamadasOmie} consultas ao Omie.`)
    } catch (err: any) {
      toast.error(`Erro ao consultar: ${err?.message || err}`)
    } finally {
      setCarregando(false)
    }
  }

  const baixar = async () => {
    setBaixando(true)
    try {
      const r = await fetch(api(`${periodo()}&formato=xlsx`), { cache: 'no-store' })
      if (!r.ok) {
        const j = await r.json().catch(() => null)
        toast.error(j?.error || `Falha ao gerar a planilha (HTTP ${r.status})`)
        return
      }
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `STATUS OC - ${de.replace(/\//g, '-')} a ${ate.replace(/\//g, '-')}.xlsx`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      toast.error(`Erro ao baixar: ${err?.message || err}`)
    } finally {
      setBaixando(false)
    }
  }

  const fornecedores = useMemo(
    () => [...new Set((linhas ?? []).map(l => l.fornecedor).filter(Boolean))].sort(),
    [linhas],
  )

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return (linhas ?? []).filter(l => {
      if (fornecedor !== "__todos__" && l.fornecedor !== fornecedor) return false
      if (status === "faturado" && !l.nfDistribuidor) return false
      if (status === "pendente" && l.nfDistribuidor) return false
      if (!termo) return true
      return [l.cliente, l.proposta, l.pedido, l.oc, l.partNumber, l.descricao, l.account]
        .some(v => String(v ?? '').toLowerCase().includes(termo))
    })
  }, [linhas, fornecedor, status, busca])

  const totais = useMemo(() => ({
    custo: filtradas.reduce((s, l) => s + (l.custoTotal || 0), 0),
    venda: filtradas.reduce((s, l) => s + (l.vendaTotal || 0), 0),
  }), [filtradas])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Status das Ordens de Compra</h1>
        <p className="text-sm text-gray-500 mt-1">
          Montado na hora a partir do Omie e do Bitrix. Período longo demora: o Omie
          limita a quantidade de consultas seguidas.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-3">
        <div>
          <label className="block text-[11px] font-semibold uppercase text-gray-500 mb-1">De</label>
          <Input className="h-9 w-32" value={de} onChange={e => setDe(e.target.value)} placeholder="dd/mm/aaaa" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold uppercase text-gray-500 mb-1">Até</label>
          <Input className="h-9 w-32" value={ate} onChange={e => setAte(e.target.value)} placeholder="dd/mm/aaaa" />
        </div>
        <Button onClick={consultar} disabled={carregando} className="h-9">
          {carregando ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Search className="w-4 h-4 mr-1.5" />}
          Consultar
        </Button>
        <Button onClick={baixar} disabled={baixando || carregando} variant="outline" className="h-9">
          {baixando ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 mr-1.5" />}
          Baixar Excel
        </Button>
      </div>

      {avisos.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
          {avisos.map((a, i) => (
            <p key={i} className="flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {a}
            </p>
          ))}
        </div>
      )}

      {linhas && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <Input
              className="h-9 max-w-xs"
              placeholder="Buscar cliente, proposta, pedido, produto..."
              value={busca}
              onChange={e => setBusca(e.target.value)}
            />
            <Select value={fornecedor} onValueChange={setFornecedor}>
              <SelectTrigger className="h-9 w-48"><SelectValue placeholder="Fornecedor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__todos__">Todos os fornecedores</SelectItem>
                {fornecedores.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__todos__">Todos</SelectItem>
                <SelectItem value="faturado">Faturado pelo distribuidor</SelectItem>
                <SelectItem value="pendente">Sem NF do distribuidor</SelectItem>
              </SelectContent>
            </Select>
            <div className="ml-auto flex items-center gap-3 text-xs text-gray-600">
              <span>{filtradas.length} item(ns)</span>
              <Badge variant="outline">Custo {formatCurrency(totais.custo)}</Badge>
              <Badge variant="outline">Venda {formatCurrency(totais.venda)}</Badge>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600 sticky top-0">
                <tr>
                  {['CLIENTE','PROPOSTA','PEDIDO','OC','ACCOUNT','PART. NUMBER','DESCRIÇÃO','QTDE',
                    'CUSTO TOTAL','VENDA TOTAL','NAT.','NF DISTR.','DATA FAT. FORN.','NF INTERATELL',
                    'DATA FAT. INTERATELL','FORNECEDOR','ENVIO','STATUS'].map(t => (
                    <th key={t} className="text-left p-2 whitespace-nowrap font-semibold">{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtradas.length === 0 ? (
                  <tr><td colSpan={18} className="p-6 text-center text-gray-400">Nenhum item no período.</td></tr>
                ) : filtradas.map((l, i) => (
                  <tr key={i} className="border-t hover:bg-gray-50">
                    <td className="p-2 max-w-[200px] truncate" title={l.cliente}>{l.cliente || '—'}</td>
                    <td className="p-2 whitespace-nowrap">{l.proposta || '—'}</td>
                    <td className="p-2 font-mono whitespace-nowrap">{l.pedido}</td>
                    <td className="p-2 font-mono whitespace-nowrap">{l.oc || '—'}</td>
                    <td className="p-2 whitespace-nowrap">{l.account || '—'}</td>
                    <td className="p-2 font-mono whitespace-nowrap">{l.partNumber}</td>
                    <td className="p-2 max-w-[260px] truncate" title={l.descricao}>{l.descricao}</td>
                    <td className="p-2 text-center">{l.qtde}</td>
                    <td className="p-2 text-right whitespace-nowrap">{formatCurrency(l.custoTotal)}</td>
                    <td className="p-2 text-right whitespace-nowrap">
                      {l.vendaTotal ? formatCurrency(l.vendaTotal) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="p-2">{l.natureza || '—'}</td>
                    <td className="p-2 font-mono">{l.nfDistribuidor || '—'}</td>
                    <td className="p-2 whitespace-nowrap">{dataBR(l.dataFatFornecedor)}</td>
                    <td className="p-2 font-mono">{l.nfInteratell || '—'}</td>
                    <td className="p-2 whitespace-nowrap">{dataBR(l.dataFatInteratell)}</td>
                    <td className="p-2 whitespace-nowrap">{l.fornecedor}</td>
                    <td className="p-2 whitespace-nowrap">{dataBR(l.envioPedido)}</td>
                    <td className="p-2">
                      {l.statusDistribuidor
                        ? <Badge className="bg-green-100 text-green-700 hover:bg-green-100">{l.statusDistribuidor}</Badge>
                        : <span className="text-gray-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

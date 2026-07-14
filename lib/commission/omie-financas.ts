import 'server-only'

// Integração financeira do Omie (leitura) para o comissionamento.
// - financas/mf/ListarMovimentos: recebimentos efetivos (data + valor pagos)
// - geral/vendedores/ListarVendedores: cadastro de vendedores (para o de-para)

const MF_URL = 'https://app.omie.com.br/api/v1/financas/mf/'
const VENDEDORES_URL = 'https://app.omie.com.br/api/v1/geral/vendedores/'

export type Branch = 'barueri' | 'es'

const BRANCHES: Branch[] = ['barueri', 'es']

function creds(branch: Branch) {
  return branch === 'es'
    ? { app_key: process.env.OMIE_APP_KEY_2!, app_secret: process.env.OMIE_APP_SECRET_2! }
    : { app_key: process.env.OMIE_APP_KEY_1!, app_secret: process.env.OMIE_APP_SECRET_1! }
}

async function omie<T = any>(branch: Branch, url: string, call: string, param: object): Promise<T> {
  const { app_key, app_secret } = creds(branch)
  if (!app_key || !app_secret) throw new Error(`Credenciais Omie ausentes para a filial ${branch}.`)
  const body = JSON.stringify({ call, app_key, app_secret, param: [param] })
  await new Promise(r => setTimeout(r, Number(process.env.OMIE_SLEEP_MS ?? 260)))

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body,
    cache: 'no-store',
  })
  const text = await resp.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = null }
  if (data?.faultstring) throw new Error(`Omie ${call} (${branch}): ${data.faultstring}`)
  if (!resp.ok) throw new Error(`Omie ${call} (${branch}) HTTP ${resp.status}`)
  return data as T
}

export interface OmieReceipt {
  branch: Branch
  omieKey: string          // nCodTitulo:parcela:branch
  vendorCode: string | null
  vendorName: string | null
  clientName: string | null
  clientCnpj: string | null
  nf: string | null
  pedido: string | null    // nCodOS/nCodPedido do Omie (liga ao negócio local)
  numCtr: string | null    // "ano.ID" do negócio Bitrix (gravado pelo bp-49) — fonte da margem
  parcela: string | null
  paidAt: string | null    // ISO yyyy-mm-dd
  paidValue: number
}

function ddmmyyyy(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function isoFromBr(s: string | undefined | null): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s ?? '').trim())
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

function num(v: any): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Recebimentos (natureza R) pagos dentro do mês, das duas filiais.
 * Pagina até o fim. Considera apenas movimentos efetivamente pagos/liquidados.
 */
export async function fetchMonthReceipts(year: number, month: number): Promise<OmieReceipt[]> {
  const first = new Date(year, month - 1, 1)
  const last = new Date(year, month, 0)
  const de = ddmmyyyy(first)
  const ate = ddmmyyyy(last)

  const out: OmieReceipt[] = []
  for (const branch of BRANCHES) {
    let page = 1
    let totalPages = 1
    do {
      const res = await omie(branch, MF_URL, 'ListarMovimentos', {
        nPagina: page,
        nRegPorPagina: 200,
        cNatureza: 'R',
        dDtPagtoDe: de,
        dDtPagtoAte: ate,
      })
      totalPages = num(res?.nTotPaginas) || 1
      const movs: any[] = res?.movimentos ?? []
      for (const m of movs) {
        const d = m?.detalhes ?? {}
        const r = m?.resumo ?? {}
        // só o que realmente entrou de caixa
        const liquidado = String(r?.cLiquidado ?? '').toUpperCase() === 'S'
        const paidValue = num(r?.nValPago) || (liquidado ? num(d?.nValorTitulo) : 0)
        if (!liquidado || paidValue <= 0) continue

        const titulo = String(d?.nCodTitulo ?? d?.nCodMovCC ?? '')
        const parcela = d?.cNumParcela ? String(d.cNumParcela) : null
        out.push({
          branch,
          omieKey: `${titulo}:${parcela ?? '-'}:${branch}`,
          vendorCode: d?.nCodVendedor ? String(d.nCodVendedor) : (d?.cCodVendedor ? String(d.cCodVendedor) : null),
          vendorName: d?.cNomeVendedor ? String(d.cNomeVendedor) : null,
          clientName: d?.cNomeCliente ? String(d.cNomeCliente) : null,
          clientCnpj: d?.cCPFCNPJCliente ? String(d.cCPFCNPJCliente) : null,
          nf: d?.cNumDocFiscal ? String(d.cNumDocFiscal) : null,
          pedido: d?.cNumOS ? String(d.cNumOS) : (d?.cNumTitulo ? String(d.cNumTitulo) : null),
          numCtr: d?.cNumCtr ? String(d.cNumCtr).trim() : null,
          parcela,
          paidAt: isoFromBr(d?.dDtPagamento) ?? isoFromBr(d?.dDtBaixa),
          paidValue,
        })
      }
      page++
    } while (page <= totalPages)
  }
  return out
}

export interface OmieVendor {
  code: string
  name: string
  email: string | null
  inactive: boolean
  branch: Branch
}

/** Cadastro de vendedores das duas filiais (para montar/atualizar o de-para). */
export async function fetchOmieVendors(): Promise<OmieVendor[]> {
  const out: OmieVendor[] = []
  for (const branch of BRANCHES) {
    let page = 1
    let totalPages = 1
    do {
      const res = await omie(branch, VENDEDORES_URL, 'ListarVendedores', {
        pagina: page,
        registros_por_pagina: 50,
      })
      totalPages = num(res?.total_de_paginas) || 1
      const arr: any[] = res?.cadastro ?? res?.vendedor_cadastro ?? []
      for (const v of arr) {
        const code = String(v?.nCodigo ?? v?.codigo ?? '').trim()
        if (!code) continue
        out.push({
          code,
          name: String(v?.cNome ?? v?.nome ?? '').trim() || `Vendedor ${code}`,
          email: (v?.cEmail ?? v?.email) ? String(v.cEmail ?? v.email).trim() : null,
          inactive: String(v?.cInativo ?? v?.inativo ?? '').toUpperCase() === 'S',
          branch,
        })
      }
      page++
    } while (page <= totalPages)
  }
  return out
}

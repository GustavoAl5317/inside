import 'server-only'

/**
 * Posição de estoque do Omie (ListarPosEstoque) e o de-para com o catálogo.
 *
 * O Omie devolve 50 itens por página; a conta de Barueri tem ~2.700 produtos,
 * ou seja ~55 páginas. Cada página respeita o OMIE_SLEEP_MS para não bater no
 * rate-limit, que já derrubou integrações deste projeto antes.
 */

const OMIE_ESTOQUE_URL = 'https://app.omie.com.br/api/v1/estoque/consulta/'

export type Branch = 'barueri' | 'es'

export interface OmieStockItem {
  codigo: string          // cCodigo — código do produto no Omie
  descricao: string       // cDescricao
  codigoIntegracao: string // cCodInt — preenchido quando o produto veio deste app
  codProduto: number      // nCodProd
  saldo: number           // nSaldo
  fisico: number
  reservado: number
  pendente: number
  estoqueMinimo: number
  custoMedio: number      // nCMC
  precoUnitario: number   // nPrecoUnitario
}

function credentials(branch: Branch) {
  return branch === 'es'
    ? { app_key: process.env.OMIE_APP_KEY_2, app_secret: process.env.OMIE_APP_SECRET_2 }
    : { app_key: process.env.OMIE_APP_KEY_1, app_secret: process.env.OMIE_APP_SECRET_1 }
}

/** dd/mm/aaaa — formato que o Omie exige em dDataPosicao. */
function hojeOmie(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
}

async function omieEstoque(branch: Branch, param: object): Promise<any> {
  const { app_key, app_secret } = credentials(branch)
  if (!app_key || !app_secret) {
    throw new Error(`Credenciais Omie da filial ${branch} não configuradas no .env`)
  }
  await new Promise(r => setTimeout(r, Number(process.env.OMIE_SLEEP_MS ?? 260)))

  const resp = await fetch(OMIE_ESTOQUE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call: 'ListarPosEstoque', app_key, app_secret, param: [param] }),
    cache: 'no-store',
  })
  const json = await resp.json().catch(() => null)
  if (!json) throw new Error(`Omie respondeu ${resp.status} sem corpo JSON`)
  if (json.faultstring) throw new Error(String(json.faultstring))
  return json
}

/**
 * Lê a posição de estoque inteira, paginando.
 *
 * `maxPaginas` existe como freio: sem ele um erro de paginação do Omie viraria
 * um laço longo contra a API de produção.
 */
export async function listOmieStock(
  branch: Branch = 'barueri',
  maxPaginas = 80,
): Promise<{ items: OmieStockItem[]; total: number; paginas: number }> {
  const dDataPosicao = hojeOmie()
  const items: OmieStockItem[] = []
  let pagina = 1
  let totPaginas = 1
  let total = 0

  while (pagina <= totPaginas && pagina <= maxPaginas) {
    const j = await omieEstoque(branch, {
      nPagina: pagina,
      nRegPorPagina: 50,
      dDataPosicao,
      cExibeTodos: 'S',
    })
    totPaginas = Number(j.nTotPaginas ?? 1)
    total = Number(j.nTotRegistros ?? 0)

    for (const p of (Array.isArray(j.produtos) ? j.produtos : [])) {
      items.push({
        codigo:           String(p.cCodigo ?? '').trim(),
        descricao:        String(p.cDescricao ?? '').trim(),
        codigoIntegracao: String(p.cCodInt ?? '').trim(),
        codProduto:       Number(p.nCodProd ?? 0),
        saldo:            Number(p.nSaldo ?? 0),
        fisico:           Number(p.fisico ?? 0),
        reservado:        Number(p.reservado ?? 0),
        pendente:         Number(p.nPendente ?? 0),
        estoqueMinimo:    Number(p.estoque_minimo ?? 0),
        custoMedio:       Number(p.nCMC ?? 0),
        precoUnitario:    Number(p.nPrecoUnitario ?? 0),
      })
    }
    pagina++
  }

  return { items, total, paginas: totPaginas }
}

// ─── De-para com o catálogo ───────────────────────────────────────────────────

export type MatchKind = 'integracao' | 'descricao' | 'nenhum'

export interface CatalogEntry {
  partnumber: string
  description: string
  origem: 'bitrix' | 'local'
  ncm?: string
  sku?: string
}

export interface StockComparisonRow {
  partnumber: string          // vazio quando o item só existe no Omie
  descricaoCatalogo: string
  origemCatalogo?: 'bitrix' | 'local'
  omie: OmieStockItem | null
  match: MatchKind
}

/** Normaliza para comparar: caixa alta, sem acento e sem separadores. */
function norm(s: string): string {
  return s
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '')
}

/**
 * Cruza catálogo e estoque.
 *
 * A chave é escolhida por confiança decrescente:
 *   1. cCodInt — o código de integração que este app grava ao criar o produto
 *      no Omie. Casamento exato, mas só cobre o que passou por aqui.
 *   2. part number contido na descrição do Omie — o Omie usa código numérico
 *      próprio e guarda o part number no texto ("SWITCH CISCO WS-C2960G-48TC-L").
 *      É heurística: pode casar errado com part numbers muito curtos, por isso
 *      só vale a partir de 5 caracteres normalizados.
 */
export function compareStockWithCatalog(
  stock: OmieStockItem[],
  catalog: CatalogEntry[],
): StockComparisonRow[] {
  const porIntegracao = new Map<string, OmieStockItem>()
  const porCodigo = new Map<string, OmieStockItem>()
  for (const s of stock) {
    if (s.codigoIntegracao) porIntegracao.set(norm(s.codigoIntegracao), s)
    if (s.codigo) porCodigo.set(norm(s.codigo), s)
  }

  const usados = new Set<number>()
  const rows: StockComparisonRow[] = []

  for (const c of catalog) {
    const chave = norm(c.partnumber)
    let achado: OmieStockItem | null = null
    let match: MatchKind = 'nenhum'

    if (chave) {
      const exato = porIntegracao.get(chave) ?? porCodigo.get(chave)
      if (exato) { achado = exato; match = 'integracao' }
    }
    if (!achado && chave.length >= 5) {
      const porDescricao = stock.find(s => norm(s.descricao).includes(chave))
      if (porDescricao) { achado = porDescricao; match = 'descricao' }
    }
    if (achado) usados.add(achado.codProduto)

    rows.push({
      partnumber: c.partnumber,
      descricaoCatalogo: c.description,
      origemCatalogo: c.origem,
      omie: achado,
      match,
    })
  }

  // Sobras do Omie: existem no estoque e não estão no catálogo.
  for (const s of stock) {
    if (usados.has(s.codProduto)) continue
    rows.push({
      partnumber: '',
      descricaoCatalogo: '',
      omie: s,
      match: 'nenhum',
    })
  }

  return rows
}

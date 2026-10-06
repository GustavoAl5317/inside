import 'server-only'

/**
 * Famílias de produto lidas direto do Omie.
 *
 * Antes vinham da lista #65 do Bitrix, cadastrada à mão, com o código do Omie
 * digitado no fim do nome ("Aruba - Hardware - 2081927710"). Esse cadastro
 * paralelo saía do ar: faltavam 13 famílias que já existiam no Omie e 14 tinham
 * rótulo trocado — "Cisco - Licença" na tela apontava para "Cisco - Serviços" no
 * Omie. Lendo do Omie, nome e código vêm do mesmo registro e não divergem.
 *
 * As duas filiais são contas Omie separadas, então a separação por filial sai de
 * graça: cada conta devolve as suas famílias. `location` mantém o formato que a
 * tela já filtra (familyMatchesBranch em lib/utils).
 */

const URL_FAMILIAS = 'https://app.omie.com.br/api/v1/geral/familias/'

export type FamiliaOmie = {
  /** Único na lista combinada; é o próprio código do Omie. */
  id: string
  name: string
  /** codigo_familia enviado no IncluirProduto. */
  omieCode: string
  /** 'barueri' | 'espirito santo' — o que familyMatchesBranch entende. */
  location: string
}

type Filial = 'barueri' | 'es'

function credenciais(filial: Filial) {
  return filial === 'es'
    ? { app_key: process.env.OMIE_APP_KEY_2, app_secret: process.env.OMIE_APP_SECRET_2 }
    : { app_key: process.env.OMIE_APP_KEY_1, app_secret: process.env.OMIE_APP_SECRET_1 }
}

/**
 * Cache em memória: a lista muda raramente e a tela de produtos a pede toda vez
 * que abre. Mesmo padrão das condições de pagamento.
 */
let cache: { em: number; familias: FamiliaOmie[] } | null = null
const CACHE_MS = 10 * 60 * 1000

async function daFilial(filial: Filial): Promise<FamiliaOmie[]> {
  const { app_key, app_secret } = credenciais(filial)
  if (!app_key || !app_secret) return []

  const location = filial === 'es' ? 'espirito santo' : 'barueri'
  const out: FamiliaOmie[] = []
  let pagina = 1
  while (true) {
    const resp = await fetch(URL_FAMILIAS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        call: 'PesquisarFamilias', app_key, app_secret,
        param: [{ pagina, registros_por_pagina: 100 }],
      }),
      cache: 'no-store',
    })
    const data: any = await resp.json().catch(() => null)
    if (!data || data.faultstring) {
      console.error(`Erro ao listar famílias do Omie (${filial}):`, data?.faultstring ?? `HTTP ${resp.status}`)
      break
    }
    for (const f of (data.famCadastro ?? [])) {
      // Família inativa no Omie não pode ser escolhida num produto novo.
      if (String(f?.inativo ?? 'N').toUpperCase() === 'S') continue
      const omieCode = String(f?.codigo ?? '').trim()
      if (!omieCode) continue
      out.push({ id: omieCode, omieCode, name: String(f?.nomeFamilia ?? '').trim(), location })
    }
    const totalPaginas = Number(data.total_de_paginas ?? 1)
    if (!Number.isFinite(totalPaginas) || pagina >= totalPaginas) break
    pagina++
  }
  return out
}

/** Famílias ativas das duas filiais, já marcadas com a localidade. */
export async function listarFamiliasOmie(): Promise<FamiliaOmie[]> {
  if (cache && Date.now() - cache.em < CACHE_MS) return cache.familias

  const [barueri, es] = await Promise.all([daFilial('barueri'), daFilial('es')])
  const familias = [...barueri, ...es].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  // Só guarda no cache quando veio alguma coisa: falha de rede não pode
  // congelar a lista vazia por dez minutos.
  if (familias.length) cache = { em: Date.now(), familias }
  return familias
}

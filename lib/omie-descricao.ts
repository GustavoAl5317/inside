/**
 * Descrição de produto enviada ao Omie: Part Number + " / " + Descrição.
 *
 * Regra fechada com o comercial: o Part Number sai sempre inteiro e o limite de
 * 120 caracteres é aplicado sobre a concatenação — quem perde caracteres é só a
 * descrição. Sobra para a descrição = 120 - tamanho do PN - 3 (o separador).
 *
 * Ex.: "CS-BRD55P-K9_US" (15) + " / " (3) + "Cisco Board Pro 55 G2 (Exemplo)"
 *      → 102 caracteres disponíveis para a descrição.
 */
export const OMIE_DESCRICAO_MAX = 120

const SEPARADOR = ' / '

const limpa = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()

/**
 * Parte da descrição que ainda não repete o part number.
 *
 * Produtos antigos do catálogo guardam "PN / Descrição" num campo só, e o
 * partnumber acaba vindo com esse texto inteiro. Sem isto a concatenação
 * devolveria o part number duas vezes.
 */
function semPrefixoDoPN(desc: string, pn: string): string {
  if (!desc.toUpperCase().startsWith(pn.toUpperCase())) return desc
  return desc.slice(pn.length).replace(/^[\s/|-]+/, '').trim()
}

export function descricaoOmie(
  partnumber: unknown,
  description: unknown,
  limite: number = OMIE_DESCRICAO_MAX,
): string {
  const pn = limpa(partnumber)
  const descBruta = limpa(description)

  // Sem part number não há o que concatenar — resta cortar a descrição no limite.
  if (!pn) return descBruta.slice(0, limite)

  const desc = semPrefixoDoPN(descBruta, pn)
  if (!desc) return pn.slice(0, limite)

  // Part number tão longo que não sobra espaço para descrição alguma.
  const disponivel = limite - pn.length - SEPARADOR.length
  if (disponivel <= 0) return pn.slice(0, limite)

  return `${pn}${SEPARADOR}${desc.slice(0, disponivel).trim()}`
}

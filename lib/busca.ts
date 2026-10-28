/**
 * Busca por texto que aceita o jeito como as pessoas digitam: sem acento, em
 * minúsculas e com as palavras em qualquer ordem. "vernova eletricas" acha
 * "GE VERNOVA E&S ELÉTRICAS LTDA".
 */

/** Minúsculas e sem acento: "ELÉTRICAS" vira "eletricas". */
export function semAcento(texto: unknown): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** Palavras da busca, já sem acento. Pontuação separa: "2026.12921" vira duas. */
export function termosDaBusca(busca: string): string[] {
  return semAcento(busca).split(/[^a-z0-9]+/).filter(Boolean)
}

/** Verdadeiro quando todas as palavras da busca aparecem em algum dos campos. */
export function casaBusca(busca: string, ...campos: unknown[]): boolean {
  const termos = termosDaBusca(busca)
  if (!termos.length) return true
  const alvo = semAcento(campos.map(c => String(c ?? '')).join(' '))
  return termos.every(t => alvo.includes(t))
}

/**
 * A palavra que melhor estreita uma busca feita no servidor: a mais longa.
 * O Bitrix só acha o texto em sequência, então a busca vai com uma palavra e o
 * resto é conferido aqui com `casaBusca`.
 */
export function termoPrincipal(busca: string): string {
  return termosDaBusca(busca).reduce((maior, t) => (t.length > maior.length ? t : maior), '')
}

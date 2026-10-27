/**
 * Apelido do fornecedor usado na planilha de status ("LHD", "INGRAM"), a partir
 * da razão social que vem do Omie.
 *
 * Os apelidos saíram da própria planilha: são os valores da coluna FORNECEDOR
 * nas abas 2025 e 2026. Sem de-para a planilha sairia com a razão social inteira
 * e deixaria de bater com o que o time já usa.
 */

/** Trecho da razão social → apelido. O primeiro que casar vence, então o mais específico vem antes. */
const DE_PARA: Array<[RegExp, string]> = [
  [/ingram/i,                 'INGRAM'],
  [/scansource/i,             'SCANSOURCE'],
  [/\bl\.?h\.?d\b|lhd comercio/i, 'LHD'],
  [/td\s*synnex|synnex/i,     'TD SYNNEX'],
  [/colaborar/i,              'COLABORAR'],
  [/a\.?\s?c\.?\s?p\.?\s?m\b/i, 'ACPM'],
  [/\bagis\b/i,               'AGIS'],
  [/intelbras/i,              'INTELBRAS'],
  [/albak/i,                  'ALBAK'],
  [/unentel/i,                'UNENTEL'],
  [/interatell/i,             'INTERATELL'],
  [/\bf\.?c\.?\s*peralta|peralta/i, 'PERALTA'],
  [/tribotek/i,               'TRIBOTEK'],
  [/oder[çc]o/i,              'ODERÇO'],
  [/c3\s*tech/i,              'C3TECH'],
  [/\baea\b/i,                'AEA'],
  [/gpc\s*it/i,               'GPC IT'],
  [/nextra/i,                 'NEXTRA'],
  [/cogra/i,                  'COGRA'],
  [/\begs\b/i,                'EGS'],
  [/ativa\s*1|ativa um/i,     'ATIVA 1'],
  [/central\s*cabos/i,        'CENTRAL CABOS'],
  [/\bsis\b|sis comercio/i,   'SIS'],
  [/oracle/i,                 'ORACLE'],
  [/general\s*it/i,           'GENERAL IT'],
  [/uc2b/i,                   'UC2B'],
]

/**
 * Razão social → apelido. Sem correspondência, devolve as duas primeiras
 * palavras em caixa alta: é o formato dos apelidos da planilha e deixa claro
 * qual fornecedor ainda falta no de-para.
 */
export function apelidoFornecedor(razaoSocial: unknown): string {
  const nome = String(razaoSocial ?? '').trim()
  if (!nome) return ''
  for (const [padrao, apelido] of DE_PARA) {
    if (padrao.test(nome)) return apelido
  }
  return nome
    .toUpperCase()
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter(p => !['LTDA', 'S/A', 'SA', 'ME', 'EPP', 'EIRELI', 'COMERCIO', 'DE', 'E', 'DO', 'DA'].includes(p))
    .slice(0, 2)
    .join(' ')
}

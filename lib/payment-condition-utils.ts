/** Condições padrão Omie — mesma base da tela Condições de Pagamento (lista Bitrix #67). */
export const DEFAULT_COMPRA_CONDITIONS = [
  'A28 - Para 28 Dias', 'A30 - Para 30 Dias', 'A45 - Para 45 Dias',
  'A60 - Para 60 Dias', 'A74 - Para 75 Dias', 'A90 - Para 90 Dias',
  'B20 - Para 120 Dias', 'B50 - Para 150 Dias', 'S07 - 30/45/60 Dias',
  'S30 - 30/60/90 Dias', 'S53 - Para 30/60/90/120', 'S75 - Para 1/30/60/90',
  '000 - Para A Vista', '001 - Para 1 parcelas', '002 - Para 2 parcelas',
  '003 - Para 3 parcelas', '004 - Para 4 parcelas', '005 - Para 5 parcelas',
  '006 - Para 6 parcelas', '007 - Para 7 parcelas', '008 - Para 8 parcelas',
  '009 - Para 9 parcelas', '010 - Para 10 parcelas', '012 - Para 12 parcelas',
  '024 - Para 24 parcelas', '036 - Para 36 parcelas', '048 - Para 48 parcelas',
] as const

export const DEFAULT_VENDA_CONDITIONS = [
  'A28 - Para 28 Dias', 'T54 - Para 30 Dias', 'A45 - Para 45 Dias',
  'A60 - Para 60 Dias', 'A74 - Para 75 Dias', 'A90 - Para 90 Dias',
  'B20 - Para 120 Dias', 'B50 - Para 150 Dias', 'S23 - 30/45/60 Dias',
  'S18 - 30/60/90 Dias', 'S25 - Para 30/60/90/120', 'P66 - Para 1/30/60/90',
  '000 - Para A Vista', '001 - Para 1 parcelas', '002 - Para 2 parcelas',
  '003 - Para 3 parcelas', '004 - Para 4 parcelas', '005 - Para 5 parcelas',
  '006 - Para 6 parcelas', '007 - Para 7 parcelas', '008 - Para 8 parcelas',
  '009 - Para 9 parcelas', '010 - Para 10 parcelas', '012 - Para 12 parcelas',
  '024 - Para 24 parcelas', '036 - Para 36 parcelas', '048 - Para 48 parcelas',
] as const

export type PaymentConditionKind = 'purchase' | 'sale'

function splitEntry(entry: string): { code: string; desc: string } {
  const m = entry.match(/^([^\s]+)\s*-\s*(.+)$/)
  if (m) return { code: m[1].trim(), desc: m[2].trim() }
  return { code: '', desc: entry.trim() }
}

function normalizeDesc(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function buildDescMap(entries: readonly string[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const entry of entries) {
    const { code, desc } = splitEntry(entry)
    if (code) map.set(normalizeDesc(desc), code.toUpperCase())
  }
  return map
}

const COMPRA_BY_DESC = buildDescMap(DEFAULT_COMPRA_CONDITIONS)
const VENDA_BY_DESC = buildDescMap(DEFAULT_VENDA_CONDITIONS)

/** Tenta extrair código Omie (≤3 chars) de valor já formatado. */
export function tryParseOmiePaymentCode(value: string): string | null {
  const s = String(value ?? '').trim()
  if (!s) return null
  if (s.length <= 3 && /^[A-Za-z0-9]+$/.test(s)) return s.toUpperCase()

  const sep = s.indexOf(' - ')
  if (sep > 0) {
    const code = s.slice(0, sep).trim()
    if (code.length <= 3 && /^[A-Za-z0-9]+$/.test(code)) return code.toUpperCase()
  }

  const dash = s.match(/^([A-Za-z0-9]{1,3})-/)
  if (dash) return dash[1].toUpperCase()

  return null
}

/** Resolve código pela descrição usando tabela padrão Compra/Venda. */
export function resolveDefaultOmiePaymentCode(
  value: string,
  kind: PaymentConditionKind,
): string | null {
  const map = kind === 'purchase' ? COMPRA_BY_DESC : VENDA_BY_DESC
  const norm = normalizeDesc(value)
  if (map.has(norm)) return map.get(norm)!

  const { desc } = splitEntry(value)
  const fromDesc = normalizeDesc(desc)
  if (map.has(fromDesc)) return map.get(fromDesc)!

  return null
}

export function resolveOmiePaymentCode(value: string, kind: PaymentConditionKind): string {
  const direct = tryParseOmiePaymentCode(value)
  if (direct) return direct

  const fromDefault = resolveDefaultOmiePaymentCode(value, kind)
  if (fromDefault) return fromDefault

  throw new Error(
    `Condição de pagamento inválida "${value}": não foi possível obter o código Omie (até 3 caracteres). ` +
    `Use o formato "A28 - Para 28 Dias" ou cadastre o código na lista de Condições de Pagamento do Bitrix.`,
  )
}

/** Match flexível entre valor salvo no deal e item da lista Bitrix. */
/** Exibe "A28 - Para 28 Dias" a partir do código ou valor salvo. */
export function formatPaymentConditionLabel(value: string, kind: PaymentConditionKind): string {
  const s = String(value ?? '').trim()
  if (!s) return '—'
  const code = tryParseOmiePaymentCode(s) || s.toUpperCase()
  const entries = kind === 'purchase' ? DEFAULT_COMPRA_CONDITIONS : DEFAULT_VENDA_CONDITIONS
  const exact = entries.find(e => e.toUpperCase() === s.toUpperCase())
  if (exact) return exact
  const byCode = entries.find(e => e.toUpperCase().startsWith(`${code} -`))
  if (byCode) return byCode
  if (s.includes(' - ')) return s
  return code
}

/** Retorna só o código Omie (ex.: A28) para envio à API. */
export function paymentConditionCodeOnly(value: string): string {
  return tryParseOmiePaymentCode(value) || String(value ?? '').trim().toUpperCase().slice(0, 3)
}

export function paymentConditionMatches(stored: string, itemName: string, itemCode: string): boolean {
  const s = stored.trim().toLowerCase()
  const name = itemName.trim().toLowerCase()
  const code = itemCode.trim().toLowerCase()
  if (!s) return false
  if (s === name || s === code) return true
  if (code && name.endsWith(s)) return true
  if (name.includes(s) || s.includes(name)) return true
  const { desc: storedDesc } = splitEntry(stored)
  const { desc: itemDesc } = splitEntry(itemName)
  return normalizeDesc(storedDesc) === normalizeDesc(itemDesc)
}

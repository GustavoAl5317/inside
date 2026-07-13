// Utilitário client-side para chamar a API de Listas do Bitrix24 via BX24 SDK.
// Só funciona quando o app está embarcado como iframe dentro do Bitrix24.

declare const BX24: any

const PAYMENT_LIST_ID = 67

// Garante que o script BX24 está carregado e retorna quando estiver pronto.
// Falha imediatamente se a página não estiver embutida como iframe (fora do Bitrix24).
function ensureBx24(): Promise<void> {
  // Detecta se está fora de um iframe — BX24 só funciona dentro do Bitrix24
  if (typeof window !== 'undefined' && window.self === window.top) {
    return Promise.reject(new Error('BX24 só funciona dentro do Bitrix24'))
  }

  return new Promise((resolve, reject) => {
    if (typeof BX24 !== 'undefined') {
      try { BX24.init(() => resolve()) } catch { resolve() }
      setTimeout(resolve, 800)
      return
    }

    const existing = document.querySelector<HTMLScriptElement>('script[src="https://api.bitrix24.com/api/v1/"]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      return
    }

    const s = document.createElement('script')
    s.src = 'https://api.bitrix24.com/api/v1/'
    s.async = true
    s.onload = () => {
      try { (window as any).BX24.init(() => resolve()) } catch { resolve() }
      setTimeout(resolve, 800)
    }
    s.onerror = () => reject(new Error('BX24 SDK não disponível'))
    document.head.appendChild(s)
  })
}

function bx24Call(method: string, params: Record<string, any> = {}, timeoutMs = 8000): Promise<any> {
  return new Promise((resolve, reject) => {
    if (typeof BX24 === 'undefined') {
      reject(new Error('BX24 não disponível'))
      return
    }
    const timer = setTimeout(() => reject(new Error(`Timeout: ${method}`)), timeoutMs)
    BX24.callMethod(method, params, (res: any) => {
      clearTimeout(timer)
      if (res.error()) {
        const e = res.error()
        reject(new Error(e?.error_description || e?.error || String(e)))
      } else {
        resolve(res.data())
      }
    })
  })
}

function readProp(el: any, propId: string): string {
  const raw = el[`PROPERTY_${propId}`]
  if (!raw) return ''
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const first = Object.values(raw)[0] as any
    if (first && typeof first === 'object') {
      if (first.TEXT  !== undefined) return String(first.TEXT  ?? '')
      if (first.VALUE !== undefined) return String(first.VALUE ?? '')
    }
    return String(first ?? '')
  }
  if (Array.isArray(raw)) return String(raw[0] ?? '')
  return String(raw)
}

export type PaymentCondition = { id: string; name: string; tipo: 'Compra' | 'Venda' | '' }

// Busca todas as condições de pagamento da lista 67 via BX24 SDK.
export async function bx24GetPaymentConditions(): Promise<PaymentCondition[]> {
  await ensureBx24()

  const all: PaymentCondition[] = []
  let start = 0
  const seen = new Set<string>()

  while (true) {
    const data = await bx24Call('lists.element.get', {
      IBLOCK_TYPE_ID: 'lists',
      IBLOCK_ID: PAYMENT_LIST_ID,
      FILTER: { ACTIVE: 'Y' },
      start,
    })

    const items: any[] = Array.isArray(data) ? data : Object.values(data || {})

    const sizeBefore = seen.size

    for (const el of items) {
      if (!el.ID || seen.has(String(el.ID))) continue
      seen.add(String(el.ID))

      let code = '', tipo = ''
      for (const key of Object.keys(el)) {
        if (!key.startsWith('PROPERTY_')) continue
        const val = readProp(el, key.replace('PROPERTY_', ''))
        if (!val) continue
        if (val === 'Compra' || val === 'Venda') { tipo = val; continue }
        if (/^[A-Z0-9]{2,6}$/.test(val.trim())) { code = val.trim(); continue }
      }

      const name = code
        ? `${code} - ${String(el.NAME || '')}`
        : String(el.NAME || '')

      all.push({ id: String(el.ID), name, tipo: tipo as 'Compra' | 'Venda' | '' })
    }

    if (items.length < 50 || seen.size === sizeBefore) break
    start += 50
  }

  return all
}

// Abre páginas do Bitrix24 sem tirar o usuário do app.

declare const BX24: any

const PORTAL = 'https://interatell.bitrix24.com.br'

/** Dentro do Bitrix o app roda em iframe; fora dele o BX24 não existe. */
function dentroDoBitrix(): boolean {
  return typeof window !== 'undefined'
    && window.self !== window.top
    && typeof BX24 !== 'undefined'
}

/**
 * Abre a ficha de uma empresa do CRM.
 *
 * Dentro do Bitrix usa BX24.openPath, que abre a página num slider por cima do
 * app — o formulário continua aberto atrás e nada é perdido. O callback dispara
 * quando o slider fecha, para quem chamou poder recarregar o cadastro.
 *
 * Fora do Bitrix (app aberto direto, desenvolvimento) não há slider: abre numa
 * aba nova, que é o mais próximo de não sair do app.
 */
export function abrirEmpresaBitrix(companyId: number | string, aoFechar?: () => void): void {
  const id = String(companyId ?? '').trim()
  if (!id) return
  const path = `/crm/company/details/${id}/`

  if (!dentroDoBitrix()) {
    window.open(`${PORTAL}${path}`, '_blank', 'noopener,noreferrer')
    return
  }

  try {
    BX24.init(() => {
      BX24.openPath(path, () => { aoFechar?.() })
    })
  } catch {
    window.open(`${PORTAL}${path}`, '_blank', 'noopener,noreferrer')
  }
}

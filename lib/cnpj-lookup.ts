/**
 * Consulta de CNPJ na BrasilAPI (dados da Receita). Fica fora de actions.ts
 * para o BitrixService também poder usar: o endereço dos requisitos do Bitrix
 * costuma ser texto livre, e a Receita é a fonte estruturada de reserva.
 */
export interface CnpjLookupResult {
  success: boolean
  name?: string
  tradeName?: string
  address?: string
  number?: string
  complement?: string
  neighborhood?: string
  city?: string
  state?: string
  zipCode?: string
  email?: string
  phone?: string
  error?: string
}

export async function consultarCnpj(cnpj: string): Promise<CnpjLookupResult> {
  const digits = cnpj.replace(/\D/g, '')
  if (digits.length !== 14) return { success: false, error: 'CNPJ deve ter 14 dígitos' }
  try {
    console.log(`[lookupCnpj] Consultando: ${digits}`)
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, {
      cache: 'no-store',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; InsideSales/1.0)',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) {
      let errBody = ''
      try { errBody = await res.text() } catch {}
      console.error(`[lookupCnpj] HTTP ${res.status} para ${digits}: ${errBody}`)
      const msg = `HTTP ${res.status} — ${errBody || 'CNPJ não encontrado'}`
      return { success: false, error: msg }
    }
    const d = await res.json()
    if (d.message) {
      console.error(`[lookupCnpj] API retornou mensagem de erro para ${digits}: ${d.message}`)
      return { success: false, error: d.message }
    }
    console.log(`[lookupCnpj] OK: ${d.razao_social}`)
    // A Receita separa o tipo ("RUA", "AVENIDA") do nome do logradouro.
    const tipo = String(d.descricao_tipo_de_logradouro || '').trim()
    const logradouro = String(d.logradouro || '').trim()
    const address = tipo && logradouro && !logradouro.toUpperCase().startsWith(tipo.toUpperCase())
      ? `${tipo} ${logradouro}`
      : logradouro
    return {
      success:      true,
      name:         d.razao_social     || '',
      tradeName:    d.nome_fantasia    || '',
      address,
      number:       d.numero           || '',
      complement:   d.complemento      || '',
      neighborhood: d.bairro           || '',
      city:         d.municipio        || '',
      state:        d.uf               || '',
      zipCode:      (d.cep || '').replace(/\D/g, ''),
      email:        d.email            || '',
      phone:        (d.ddd_telefone_1 ? d.ddd_telefone_1.replace(/\D/g, '') : ''),
    }
  } catch (err: any) {
    console.error(`[lookupCnpj] Exceção ao consultar ${digits}:`, err)
    return { success: false, error: err?.message || 'Erro ao consultar CNPJ' }
  }
}

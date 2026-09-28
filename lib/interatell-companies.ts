export type InteratellBranch = 'barueri' | 'es'

export type InteratellCompany = {
  cnpj: string; name: string; label: string; stateRegistration: string
  zipCode: string; city: string; state: string
  neighborhood: string; address: string; number: string; complement: string
  contactName: string; phone: string; phone2: string; email: string
}

/**
 * Empresas emissoras da Interatell. Um negócio pode faturar por uma ou por ambas.
 *
 * Os valores são os da tabela INTERATELL da planilha de Ordem de Compra, que é
 * de onde o modelo puxava por VLOOKUP antes de o app passar a escrever direto.
 * `label` é a razão social como ela aparece naquela tabela, com o sufixo da
 * filial — é o que vai na célula do bloco Interatell; `name` é a razão social
 * limpa, usada no PDF e em qualquer lugar que não seja o cabeçalho da planilha.
 */
export const INTERATELL_COMPANIES: Record<'matriz' | 'filial', InteratellCompany> = {
  matriz: {
    cnpj: "03969530000130",
    name: "INTERATELL INTEGRAÇÕES E TELECOMUNICAÇÕES LTDA",
    label: "INTERATELL INTEGRAÇÕES E TELECOMUNICAÇÕES LTDA – BARUERI",
    stateRegistration: "206.122.484.113",
    zipCode: "06472001", city: "Barueri", state: "SP",
    neighborhood: "Empresarial 18 Do Forte", address: "Avenida Copacabana",
    number: "190", complement: "Andar 2 Conj. 201",
    contactName: "Gabriella Amaro",
    phone: "(11) 3303-3324", phone2: "(11) 3303-3324",
    email: "financeiro@interatell.com.br",
  },
  filial: {
    cnpj: "03969530000211",
    name: "INTERATELL INTEGRACOES E TELECOMUNICACOES LTDA",
    label: "INTERATELL INTEGRACOES E TELECOMUNICACOES LTDA- ES",
    stateRegistration: "084.000.44-9",
    zipCode: "29175706", city: "Serra", state: "ES",
    neighborhood: "Nova Zelândia", address: "Rua Porto Alegre",
    number: "307", complement: "G.02 MOD02B",
    contactName: "Gabriella Amaro",
    phone: "(11) 3303-3324", phone2: "(11) 3303-3324",
    email: "financeiro@interatell.com.br",
  },
}

export const companyForBranch = (b: InteratellBranch): InteratellCompany =>
  INTERATELL_COMPANIES[b === 'es' ? 'filial' : 'matriz']

/**
 * Empresas emissoras de um payload de deal.
 * Payloads antigos guardavam um único objeto `interatell`; os novos guardam
 * `interatellBranches` (uma ou ambas as filiais).
 */
export function issuersFromPayload(values: any): InteratellCompany[] {
  const branches: InteratellBranch[] = values?.interatellBranches ?? []
  if (branches.length) return branches.map(companyForBranch)
  if (values?.interatell?.name || values?.interatell?.cnpj) return [values.interatell]
  return []
}

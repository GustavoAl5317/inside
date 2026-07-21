export type InteratellBranch = 'barueri' | 'es'

export type InteratellCompany = {
  cnpj: string; name: string; stateRegistration: string
  zipCode: string; city: string; state: string
  neighborhood: string; address: string; number: string; complement: string
}

/** Empresas emissoras da Interatell. Um negócio pode faturar por uma ou por ambas. */
export const INTERATELL_COMPANIES: Record<'matriz' | 'filial', InteratellCompany> = {
  matriz: {
    cnpj: "03969530000130",
    name: "Interatell Integrações e Telecomunicações Ltda",
    stateRegistration: "206.122.484.113",
    zipCode: "06472001", city: "Barueri", state: "SP",
    neighborhood: "", address: "Avenida Copacabana",
    number: "190", complement: "Empresarial Dezoito do Forte",
  },
  filial: {
    cnpj: "03969530000211",
    name: "Interatell Integrações e Telecomunicações Ltda – FILIAL",
    stateRegistration: "",
    zipCode: "29175706", city: "Serra", state: "ES",
    neighborhood: "Nova Zelândia", address: "Rua Porto Alegre",
    number: "307", complement: "Galpão 02 Módulo 02B",
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

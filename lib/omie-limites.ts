/**
 * Limites de tamanho dos campos de cadastro de cliente/fornecedor no Omie.
 *
 * Os valores são os tipos declarados em app.omie.com.br/api/v1/geral/clientes
 * para IncluirCliente, que é a chamada que cadastra tanto cliente quanto
 * fornecedor (fornecedor entra como cliente nesta conta). Campo acima do limite
 * faz o Omie recusar o cadastro, e o envio para no meio.
 *
 * O cadastro vem do Bitrix, então quem estoura só se resolve lá — daí o alerta
 * apontar o campo e o tamanho em vez de cortar o texto por conta própria.
 */

export type LimiteCampo = {
  /** Campo do formulário (companySchema). */
  campo: 'name' | 'address' | 'number' | 'complement' | 'neighborhood'
       | 'city' | 'state' | 'zipCode' | 'email' | 'contactName'
       | 'stateRegistration' | 'cnpj'
  /** Rótulo como aparece na tela. */
  label: string
  /** Campo correspondente na API do Omie. */
  campoOmie: string
  limite: number
  /** Campos que o app envia só com dígitos: o tamanho é medido sobre eles. */
  soDigitos?: boolean
}

export const OMIE_LIMITES_EMPRESA: LimiteCampo[] = [
  { campo: 'name',              label: 'Razão Social',        campoOmie: 'razao_social',        limite: 60 },
  { campo: 'address',           label: 'Endereço',            campoOmie: 'endereco',            limite: 60 },
  { campo: 'number',            label: 'Número',              campoOmie: 'endereco_numero',     limite: 60 },
  { campo: 'complement',        label: 'Complemento',         campoOmie: 'complemento',         limite: 60 },
  { campo: 'neighborhood',      label: 'Bairro',              campoOmie: 'bairro',              limite: 60 },
  { campo: 'city',              label: 'Cidade',              campoOmie: 'cidade',              limite: 40 },
  { campo: 'state',             label: 'UF',                  campoOmie: 'estado',              limite: 2 },
  { campo: 'contactName',       label: 'Contato',             campoOmie: 'contato',             limite: 100 },
  { campo: 'email',             label: 'E-mail',              campoOmie: 'email',               limite: 500 },
  { campo: 'stateRegistration', label: 'Inscrição Estadual',  campoOmie: 'inscricao_estadual',  limite: 20 },
  { campo: 'cnpj',              label: 'CNPJ',                campoOmie: 'cnpj_cpf',            limite: 20, soDigitos: true },
  { campo: 'zipCode',           label: 'CEP',                 campoOmie: 'cep',                 limite: 10, soDigitos: true },
]

export interface CampoExcedido extends LimiteCampo {
  tamanho: number
  valor: string
}

/** Campos da empresa acima do limite do Omie. Lista vazia = cadastro passa. */
export function camposExcedidos(company: any): CampoExcedido[] {
  const fora: CampoExcedido[] = []
  for (const l of OMIE_LIMITES_EMPRESA) {
    const bruto = String(company?.[l.campo] ?? '').trim()
    const valor = l.soDigitos ? bruto.replace(/\D/g, '') : bruto
    if (valor.length > l.limite) fora.push({ ...l, tamanho: valor.length, valor })
  }
  return fora
}

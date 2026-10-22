/**
 * Dados que o Omie exige de um cliente e que o Bitrix nem sempre traz.
 *
 * Faltando qualquer um deles o envio falha no meio, depois de já ter criado
 * pedidos: sem UF o Omie recusa a OS com "Cidade não cadastrada para o Código
 * [SAO PAULO]", e sem CNPJ não dá para cadastrar o cliente. Por isso a conferência
 * acontece no formulário, antes de prosseguir.
 */

const digitos = (v: unknown) => String(v ?? '').replace(/\D/g, '')

/** Lista o que falta num cliente, em português, para mostrar na tela. */
export function faltaNoCliente(customer: any): string[] {
  const faltando: string[] = []
  if (digitos(customer?.cnpj).length !== 14) faltando.push('CNPJ')
  if (!String(customer?.name ?? '').trim()) faltando.push('razão social')
  if (!String(customer?.city ?? '').trim()) faltando.push('cidade')
  if (!String(customer?.state ?? '').trim()) faltando.push('UF')
  if (!String(customer?.contactName ?? '').trim()) faltando.push('contato')
  return faltando
}

/**
 * Mensagem única para o toast: "Cliente X: falta UF, contato · Cliente Y: falta CNPJ".
 * Devolve string vazia quando não falta nada.
 */
export function resumoPendencias(entradas: Array<{ nome: string; faltando: string[] }>): string {
  return entradas
    .filter(e => e.faltando.length)
    .map(e => `${e.nome || 'Cliente sem nome'}: falta ${e.faltando.join(', ')}`)
    .join(' · ')
}

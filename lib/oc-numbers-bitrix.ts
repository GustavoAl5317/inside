import { BitrixService } from './bitrix-service'
import { clientesDoGrupo, observacaoOc, OBSERVACAO_OS_SERVICO } from './oc-numbers'

/**
 * Garante um Número de Ordem de Compra (lista #35 do Bitrix) em cada OC e em cada
 * OS de serviço Interatell do negócio. Os já gerados na aba "Nº Ordem de Compra"
 * — ou digitados — ficam como estão. Muta `values`.
 *
 * Um erro não interrompe os demais: o que já foi criado na lista precisa voltar
 * para o negócio, senão fica órfão e o próximo envio cria outro número.
 *
 * Usado pela aba (botão "Gerar números que faltam") e pelo próprio envio ao
 * Omie, que roda em segundo plano e também é disparado direto pelos reenvios.
 */
export async function garanteNumerosOc(values: any): Promise<{ criados: number; erros: string[] }> {
  const proposta = String(values?.business?.commercialProposal ?? '').trim()
  let criados = 0
  const erros: string[] = []
  const cria = async (alvo: any, dados: { cliente: string; observacao: string }) => {
    try {
      const r = await BitrixService.createOcNumber({ ...dados, proposta })
      alvo.ocNumber = r.number
      alvo.ocElementId = r.elementId
      criados++
    } catch (err) {
      erros.push(err instanceof Error ? err.message : String(err))
    }
  }
  for (const g of values?.supplierGroups ?? []) {
    if (String(g?.ocNumber ?? '').trim() || !(g?.products ?? []).length) continue
    await cria(g, { cliente: clientesDoGrupo(values, g), observacao: observacaoOc(g) })
  }
  for (const sc of values?.serviceCustomers ?? []) {
    if (String(sc?.ocNumber ?? '').trim() || !(sc?.items ?? []).length) continue
    await cria(sc, { cliente: String(sc?.customer?.name ?? '').trim(), observacao: OBSERVACAO_OS_SERVICO })
  }
  return { criados, erros }
}

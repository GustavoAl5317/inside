import { BitrixService } from './bitrix-service'
import { camposDaParte, clientesDoGrupo, grupoMisto, observacaoOc, OBSERVACAO_OS_SERVICO, partesDoGrupo } from './oc-numbers'

/**
 * Garante um Número de Ordem de Compra (lista #35 do Bitrix) em cada OC e em cada
 * OS de serviço Interatell do negócio. Os já gerados na aba "Nº Ordem de Compra"
 * — ou digitados — ficam como estão. Muta `values`.
 *
 * Fornecedor com mais de uma natureza vira uma OC por natureza, e cada uma tem o
 * seu número: `ocNumber` na primeira e `ocNumber{parte}` nas outras (camposDaParte).
 * `semSeparar` lista os fornecedores (localId) que já foram ao Omie numa OC só,
 * antes da separação: esses continuam com um número.
 *
 * Um erro não interrompe os demais: o que já foi criado na lista precisa voltar
 * para o negócio, senão fica órfão e o próximo envio cria outro número.
 *
 * Usado pela aba (botão "Gerar números que faltam") e pelo próprio envio ao
 * Omie, que roda em segundo plano e também é disparado direto pelos reenvios.
 */
export async function garanteNumerosOc(
  values: any,
  opts: { semSeparar?: Set<string> } = {},
): Promise<{ criados: number; erros: string[] }> {
  const proposta = String(values?.business?.commercialProposal ?? '').trim()
  let criados = 0
  const erros: string[] = []
  const cria = async (
    alvo: any, campos: { numero: string; elemento: string },
    dados: { cliente: string; observacao: string },
  ) => {
    if (String(alvo?.[campos.numero] ?? '').trim()) return
    try {
      const r = await BitrixService.createOcNumber({ ...dados, proposta })
      alvo[campos.numero] = r.number
      alvo[campos.elemento] = r.elementId
      criados++
    } catch (err) {
      erros.push(err instanceof Error ? err.message : String(err))
    }
  }
  const PRINCIPAL = { numero: 'ocNumber', elemento: 'ocElementId' }

  for (const g of values?.supplierGroups ?? []) {
    if (!(g?.products ?? []).length) continue
    const cliente = clientesDoGrupo(values, g)
    if (grupoMisto(g) && !opts.semSeparar?.has(String(g?.localId ?? ''))) {
      for (const parte of partesDoGrupo(g)) {
        await cria(g, camposDaParte(g, parte), { cliente, observacao: observacaoOc(g, parte) })
      }
    } else {
      await cria(g, PRINCIPAL, { cliente, observacao: observacaoOc(g) })
    }
  }
  for (const sc of values?.serviceCustomers ?? []) {
    if (!(sc?.items ?? []).length) continue
    await cria(sc, PRINCIPAL, { cliente: String(sc?.customer?.name ?? '').trim(), observacao: OBSERVACAO_OS_SERVICO })
  }
  return { criados, erros }
}

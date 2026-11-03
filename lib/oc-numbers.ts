/**
 * Número de Ordem de Compra e campos "Sistema Financeiro (Omie)" do card de
 * Inside Sales no Bitrix.
 *
 * O número ("9178/26") é a numeração interna das OCs da Interatell, mantida na
 * lista #35 do Bitrix: um item por Ordem de Compra (um por fornecedor) e um por
 * OS de serviço Interatell. Até aqui era criado à mão na lista e copiado para o
 * card no formato "OC 9174/26 - 2602010345 - HW" depois do envio ao Omie.
 *
 * Módulo sem dependência de servidor: a aba do formulário usa as mesmas regras
 * para mostrar a observação que vai para a lista.
 */

export type NaturezaInterna = 'HW' | 'SW' | 'LC' | 'ST' | 'SRV'

/**
 * Natureza usada no envio ao Omie. O catálogo guarda HDW/SFW/LIC/SVI/SVT; os
 * códigos antigos continuam aceitos porque negócios e rascunhos já gravados usam
 * HW/SW/LC/ST/SRV.
 */
export function naturezaInterna(raw: unknown): NaturezaInterna {
  const s = String(raw ?? '').toUpperCase().trim()
  if (['HW', 'HDW', 'HARDWARE'].includes(s)) return 'HW'
  if (['SW', 'SFW', 'SOFTWARE'].includes(s)) return 'SW'
  if (['LC', 'LIC', 'LICENSE', 'LICENCA'].includes(s)) return 'LC'
  if (['ST', 'SVT', 'SERV_TER', 'TERCEIRO'].includes(s)) return 'ST'
  if (['SRV', 'SVI', 'SERV', 'SERVICO'].includes(s)) return 'SRV'
  return 'HW'
}

/** Código de três letras do "Tipo de Part Number" do catálogo Bitrix. */
const CODIGO_CATALOGO: Record<NaturezaInterna, string> = { HW: 'HDW', SW: 'SFW', LC: 'LIC', ST: 'SVT', SRV: 'SVI' }

/**
 * Natureza no formato do catálogo Bitrix (HDW/SFW/LIC/SVI/SVT), que é o que o
 * formulário mostra. Converte os códigos antigos de rascunhos e do banco local
 * (HW, LC, ...). Vazio continua vazio: produto sem natureza no catálogo não pode
 * virar hardware em silêncio.
 */
export function naturezaCatalogo(raw: unknown): string {
  return String(raw ?? '').trim() ? CODIGO_CATALOGO[naturezaInterna(raw)] : ''
}

/** Rótulos do card seguem o que o time já escrevia à mão ("HW", "SVT + LIC"). */
const ROTULO: Record<NaturezaInterna, string> = { HW: 'HW', SW: 'SFW', LC: 'LIC', ST: 'SVT', SRV: 'SVI' }

/** Naturezas distintas, na ordem em que aparecem: ["ST", "LC"] → "SVT + LIC". */
export function rotuloNaturezas(naturezas: unknown[]): string {
  const vistas: string[] = []
  for (const n of naturezas) {
    const r = ROTULO[naturezaInterna(n)]
    if (!vistas.includes(r)) vistas.push(r)
  }
  return vistas.join(' + ')
}

const filialNome = (branch: unknown) => (branch === 'es' ? 'ESPIRITO SANTO' : 'BARUERI')

/**
 * Parte da compra: uma OC por natureza do fornecedor (hardware, software,
 * licença, serviço de terceiro), como as OS da venda, que já saem uma por
 * natureza. É a regra que o time segue à mão na lista #35 ("OC LIC", "OC SVT").
 * Serviço Interatell (SRV) não é comprado: vai direto em OS, então não tem parte.
 */
export type ParteOc = 'HW' | 'SW' | 'LC' | 'ST'

/** Ordem das OCs de um fornecedor: hardware primeiro, que leva o frete. */
const PARTES: ParteOc[] = ['HW', 'SW', 'LC', 'ST']

export function parteDaNatureza(raw: unknown): ParteOc | null {
  const n = naturezaInterna(raw)
  return n === 'SRV' ? null : n
}

/** Partes que o fornecedor tem, na ordem de PARTES. */
export function partesDoGrupo(group: any): ParteOc[] {
  const tem = new Set((group?.products ?? []).map((p: any) => parteDaNatureza(p?.nature)).filter(Boolean))
  return PARTES.filter(p => tem.has(p))
}

/** Fornecedor com mais de uma natureza: vira uma OC por natureza. */
export function grupoMisto(group: any): boolean {
  return partesDoGrupo(group).length > 1
}

/** Produtos do fornecedor que entram numa parte. */
export function produtosDaParte(group: any, parte: ParteOc): any[] {
  return (group?.products ?? []).filter((p: any) => parteDaNatureza(p?.nature) === parte)
}

/**
 * Sufixo do código de integração da OC. A primeira parte do fornecedor fica com
 * o código de sempre (OC-12-G0), para os negócios já enviados continuarem
 * casando com a OC que existe; as outras levam a natureza (OC-12-G0-LC).
 */
export function sufixoDaParte(group: any, parte: ParteOc): string {
  return parte === partesDoGrupo(group)[0] ? '' : `-${parte}`
}

/**
 * Campos do grupo que guardam o número da lista #35 de uma parte. A primeira
 * parte usa `ocNumber`, como os negócios de antes da separação; as outras,
 * `ocNumber{parte}` (ocNumberLC, ocNumberST, ...).
 */
export function camposDaParte(group: any, parte: ParteOc): { numero: string; elemento: string } {
  return parte === partesDoGrupo(group)[0]
    ? { numero: 'ocNumber', elemento: 'ocElementId' }
    : { numero: `ocNumber${parte}`, elemento: `ocElementId${parte}` }
}

/** Todos os campos de número de OC que um grupo pode ter. Hardware é sempre a primeira parte. */
export const CAMPOS_NUMERO_OC: { numero: string; elemento: string }[] = [
  { numero: 'ocNumber', elemento: 'ocElementId' },
  ...PARTES.filter(p => p !== 'HW').map(p => ({ numero: `ocNumber${p}`, elemento: `ocElementId${p}` })),
]

/**
 * Número da lista #35 de uma parte. Sem ele (negócio de antes da separação, com
 * o fornecedor inteiro numa OC), vale o `ocNumber`.
 */
export function numeroDaParte(group: any, parte: ParteOc | null): string {
  const principal = String(group?.ocNumber ?? '').trim()
  if (!parte || !group) return principal
  return String(group[camposDaParte(group, parte).numero] ?? '').trim() || principal
}

/** Observação do item da lista, no padrão que o time já cadastrava: "OC HW - ESPIRITO SANTO". */
export function observacaoOc(group: any, parte?: ParteOc): string {
  const produtos = parte ? produtosDaParte(group, parte) : (group?.products ?? [])
  const nats = produtos.map((p: any) => p?.nature)
  const soServicoProprio = nats.length > 0 && nats.every((n: unknown) => naturezaInterna(n) === 'SRV')
  return [soServicoProprio ? 'OS' : 'OC', rotuloNaturezas(nats), '-', filialNome(group?.branch)]
    .filter(Boolean).join(' ')
}

/** Serviço Interatell é sempre faturado por Barueri. */
export const OBSERVACAO_OS_SERVICO = 'OS SVI - BARUERI'

/**
 * Mantém os Números de Ordem de Compra já gravados quando o formulário
 * sobrescreve o payload sem eles. Muta `novo`.
 *
 * O envio ao Omie cria o número no servidor e grava no negócio, mas o formulário
 * aberto no navegador não fica sabendo. Num reenvio na mesma sessão ele mandaria
 * o payload sem número, e o envio criaria outro item na lista — a mesma OC com
 * dois números. O casamento é pelo localId do fornecedor e do cliente de serviço.
 */
export function preservaNumerosOc(novo: any, antigo: any): void {
  for (const chave of ['supplierGroups', 'serviceCustomers'] as const) {
    const anteriores = new Map<string, any>()
    for (const x of antigo?.[chave] ?? []) {
      if (x?.localId && CAMPOS_NUMERO_OC.some(c => String(x?.[c.numero] ?? '').trim())) anteriores.set(x.localId, x)
    }
    for (const x of novo?.[chave] ?? []) {
      const a = anteriores.get(x?.localId)
      if (!a) continue
      // Um número por OC do fornecedor: a primeira em ocNumber, as outras em ocNumber{parte}.
      for (const c of CAMPOS_NUMERO_OC) {
        if (String(x?.[c.numero] ?? '').trim() || !String(a?.[c.numero] ?? '').trim()) continue
        x[c.numero] = a[c.numero]
        if (a[c.elemento] != null) x[c.elemento] = a[c.elemento]
      }
    }
  }
}

/** Clientes que recebem produto deste fornecedor — vão no campo "Cliente" da lista. */
export function clientesDoGrupo(values: any, group: any): string {
  const nomes: string[] = []
  for (const entry of values?.customers ?? []) {
    const recebe = (entry?.productAllocations ?? []).some(
      (a: any) => a?.groupLocalId === group?.localId && Number(a?.quantity) > 0,
    )
    const nome = String(entry?.customer?.name ?? '').trim()
    if (recebe && nome && !nomes.includes(nome)) nomes.push(nome)
  }
  if (!nomes.length) {
    const primeiro = String(values?.customers?.[0]?.customer?.name ?? '').trim()
    if (primeiro) nomes.push(primeiro)
  }
  return nomes.join(' / ')
}

/**
 * Próximo número a partir dos itens mais recentes da lista: maior número + 1,
 * com o sufixo do ano corrente.
 *
 * Premissa não confirmada: a sequência continua na virada do ano, só o sufixo
 * muda. Se ela reiniciar a cada ano, é aqui que se ajusta.
 */
export function proximoNumeroOc(nomes: string[], ano: number): string {
  let maior = 0
  for (const nome of nomes) {
    const m = /^\s*(\d+)\s*\/\s*\d{2}\s*$/.exec(String(nome ?? ''))
    if (m) maior = Math.max(maior, Number(m[1]))
  }
  return `${maior + 1}/${String(ano).slice(-2)}`
}

export type CamposFinanceiros = {
  compra: string
  compraServico: string
  venda: string
  ordemServico: string
}

const semZeros = (v: unknown) => String(v ?? '').trim().replace(/^0+(?=\d)/, '')

/**
 * Os quatro campos do card, a partir do payload do negócio e do resumo do envio
 * ao Omie, no formato "OC {nº da lista} - {nº do pedido no Omie} - {naturezas}":
 *
 * - Pedido de Compra: OC que tem hardware.
 * - Pedido de Compra Serviço: OC só de software, licença ou serviço de terceiros.
 * - Pedido de Venda: OV de hardware e as OS de software, licença e terceiros.
 * - Ordem de Serviço: OS de serviço Interatell.
 *
 * Venda e OS levam o número da OC de onde saíram os itens. Quando mais de uma OC
 * alimenta o mesmo pedido (dois fornecedores na mesma filial), os números vão
 * juntos: "OC 9174/26 + 9180/26 - ...". Sem número, a linha sai sem o prefixo.
 */
export function camposFinanceirosCard(values: any, resumo: any): CamposFinanceiros {
  const grupos: any[] = values?.supplierGroups ?? []
  const clientes: any[] = values?.customers ?? []
  const servicos: any[] = values?.serviceCustomers ?? []

  const linha = (numeros: unknown[], numeroOmie: unknown, rotulo: string) => {
    const nums = [...new Set(numeros.map(n => String(n ?? '').trim()).filter(Boolean))]
    return [nums.length ? `OC ${nums.join(' + ')}` : '', semZeros(numeroOmie), rotulo]
      .filter(Boolean).join(' - ')
  }

  // Números das OCs que alimentam um pedido do cliente: fornecedores com item
  // alocado para ele, na filial do pedido, com a natureza pedida.
  const numerosDaOrigem = (clienteIdx: unknown, filial: unknown, aceita: (n: NaturezaInterna) => boolean) => {
    const out: string[] = []
    for (const a of clientes[Number(clienteIdx)]?.productAllocations ?? []) {
      if (!(Number(a?.quantity) > 0)) continue
      const g = grupos.find(x => x?.localId === a?.groupLocalId)
      const p = g?.products?.[a?.productIndex]
      if (!g || !p) continue
      if (filial && (g.branch === 'es' ? 'es' : 'barueri') !== filial) continue
      if (!aceita(naturezaInterna(p.nature))) continue
      const numero = numeroDaParte(g, parteDaNatureza(p.nature))
      if (numero) out.push(numero)
    }
    return out
  }

  const compra: string[] = []
  const compraServico: string[] = []
  const venda: string[] = []
  const ordemServico: string[] = []

  for (const oc of resumo?.oc ?? []) {
    const cod = /-G(\d+)(?:-(HW|SW|LC|ST))?/.exec(String(oc?.codigoIntegracao ?? ''))
    const idx = oc?.grupoIdx ?? cod?.[1]
    const g = grupos[Number(idx)]
    if (!g) continue
    // Parte da OC: a natureza dela. OC sem parte é de antes da separação e leva
    // o fornecedor inteiro. Serviço Interatell nunca entra: vai direto em OS.
    const parte: ParteOc | undefined = oc?.parte ?? (cod?.[2] as ParteOc | undefined)
    const produtos = parte ? produtosDaParte(g, parte) : (g.products ?? [])
    const nats = produtos.map((p: any) => p?.nature)
      .filter((n: unknown) => naturezaInterna(n) !== 'SRV')
    const temHardware = nats.some((n: unknown) => naturezaInterna(n) === 'HW')
    const numero = parte ? numeroDaParte(g, parte) : g.ocNumber
    ;(temHardware ? compra : compraServico).push(linha([numero], oc?.numero, rotuloNaturezas(nats)))
  }

  for (const ov of resumo?.ov ?? []) {
    // Resumos gravados antes deste campo existir: cliente e filial saem do
    // código de integração ("OV-97-C0-ES").
    const cod = /-C(\d+)(?:-(ES|BAR))?/.exec(String(ov?.codigoIntegracao ?? ''))
    const clienteIdx = ov?.clienteIdx ?? cod?.[1]
    const filial = ov?.filial ?? (cod?.[2] === 'ES' ? 'es' : cod?.[2] === 'BAR' ? 'barueri' : undefined)
    venda.push(linha(numerosDaOrigem(clienteIdx, filial, n => n === 'HW'), ov?.numeroCurto ?? ov?.numero, 'HW'))
  }

  for (const os of resumo?.os ?? []) {
    if (os?.interatellService) {
      ordemServico.push(linha([servicos[Number(os?.servicoIdx)]?.ocNumber], os?.numero, ROTULO.SRV))
      continue
    }
    const nat = naturezaInterna(os?.nat)
    if (nat === 'SRV') {
      // Serviço Interatell vendido junto com produto: sempre faturado por
      // Barueri, venha de onde vier a compra — a filial não filtra a origem.
      ordemServico.push(linha(numerosDaOrigem(os?.clienteIdx, undefined, n => n === 'SRV'), os?.numero, ROTULO.SRV))
    } else {
      venda.push(linha(numerosDaOrigem(os?.clienteIdx, os?.filial, n => n === nat), os?.numero, ROTULO[nat]))
    }
  }

  const junta = (l: string[]) => l.join('\n')
  return {
    compra: junta(compra),
    compraServico: junta(compraServico),
    venda: junta(venda),
    ordemServico: junta(ordemServico),
  }
}

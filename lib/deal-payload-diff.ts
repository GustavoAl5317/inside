export type PayloadChange = {
  label: string
  before: string
  after: string
  kind: 'changed' | 'added' | 'removed'
}

const fmt = (v: unknown) => {
  if (v === null || v === undefined || v === '') return '—'
  return String(v).trim()
}

const fmtDate = (v: unknown) => {
  const s = fmt(v)
  if (s === '—') return s
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split('-')
    return `${d}/${m}/${y}`
  }
  return s
}

const fmtMoney = (v: unknown) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fmt(v)
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function pushDiff(
  out: PayloadChange[],
  label: string,
  before: unknown,
  after: unknown,
  formatter: (v: unknown) => string = fmt,
) {
  const b = formatter(before)
  const a = formatter(after)
  if (b === a) return
  out.push({ label, before: b, after: a, kind: 'changed' })
}

/** Compara dois payloads de deal e retorna lista legível do que mudou. */
export function computeDealPayloadChanges(before: any, after: any): PayloadChange[] {
  const changes: PayloadChange[] = []
  if (!before || !after) return changes

  const bBiz = before.business ?? {}
  const aBiz = after.business ?? {}

  pushDiff(changes, 'Negócio', bBiz.name, aBiz.name)
  pushDiff(changes, 'Proposta comercial', bBiz.commercialProposal, aBiz.commercialProposal)
  pushDiff(changes, 'Data da OC', bBiz.purchaseOrderDate, aBiz.purchaseOrderDate, fmtDate)
  pushDiff(changes, 'Prazo de entrega', bBiz.deliveryDeadline, aBiz.deliveryDeadline, fmtDate)
  pushDiff(changes, 'Previsão de faturamento', bBiz.expectedBillingDate, aBiz.expectedBillingDate, fmtDate)
  pushDiff(changes, 'Cond. pagamento compra', bBiz.purchasePaymentCondition, aBiz.purchasePaymentCondition)
  pushDiff(changes, 'Cond. pagamento venda', bBiz.salePaymentCondition, aBiz.salePaymentCondition)

  const bNotes = before.notes ?? {}
  const aNotes = after.notes ?? {}
  pushDiff(changes, 'Obs. interna', bNotes.internalNotes, aNotes.internalNotes)
  pushDiff(changes, 'Obs. externa', bNotes.externalNotes, aNotes.externalNotes)

  const bBranches = [...(before.interatellBranches ?? [])].sort().join(', ')
  const aBranches = [...(after.interatellBranches ?? [])].sort().join(', ')
  pushDiff(changes, 'Filiais Interatell', bBranches, aBranches)

  const bGroups = before.supplierGroups ?? []
  const aGroups = after.supplierGroups ?? []
  const maxGroups = Math.max(bGroups.length, aGroups.length)

  for (let g = 0; g < maxGroups; g++) {
    const bg = bGroups[g]
    const ag = aGroups[g]
    const gLabel = `Fornecedor ${g + 1}`

    if (!bg && ag) {
      changes.push({
        label: gLabel,
        before: '—',
        after: ag.supplier?.name ?? 'Novo fornecedor',
        kind: 'added',
      })
      continue
    }
    if (bg && !ag) {
      changes.push({
        label: gLabel,
        before: bg.supplier?.name ?? '—',
        after: '—',
        kind: 'removed',
      })
      continue
    }
    if (!bg || !ag) continue

    pushDiff(changes, `${gLabel} — nome`, bg.supplier?.name, ag.supplier?.name)
    pushDiff(changes, `${gLabel} — CNPJ`, bg.supplier?.cnpj, ag.supplier?.cnpj)
    pushDiff(changes, `${gLabel} — filial`, bg.branch, ag.branch)

    const bProds = bg.products ?? []
    const aProds = ag.products ?? []
    const maxProds = Math.max(bProds.length, aProds.length)

    for (let p = 0; p < maxProds; p++) {
      const bp = bProds[p]
      const ap = aProds[p]
      const sku = ap?.partnumber ?? bp?.partnumber ?? `#${p + 1}`
      const pLabel = `${gLabel} · ${sku}`

      if (!bp && ap) {
        changes.push({
          label: pLabel,
          before: '—',
          after: `${ap.description ?? sku} · qtd ${ap.quantity ?? 1} · custo ${fmtMoney(ap.unitCost)}`,
          kind: 'added',
        })
        continue
      }
      if (bp && !ap) {
        changes.push({
          label: pLabel,
          before: `${bp.description ?? sku} · qtd ${bp.quantity ?? 1}`,
          after: '—',
          kind: 'removed',
        })
        continue
      }
      if (!bp || !ap) continue

      pushDiff(changes, `${pLabel} — descrição`, bp.description, ap.description)
      pushDiff(changes, `${pLabel} — quantidade`, bp.quantity, ap.quantity)
      pushDiff(changes, `${pLabel} — custo unit.`, bp.unitCost, ap.unitCost, fmtMoney)
      pushDiff(changes, `${pLabel} — natureza`, bp.nature, ap.nature)
    }
  }

  const bCustomers = before.customers ?? []
  const aCustomers = after.customers ?? []
  const maxCust = Math.max(bCustomers.length, aCustomers.length)

  for (let c = 0; c < maxCust; c++) {
    const bc = bCustomers[c]
    const ac = aCustomers[c]
    const cLabel = `Cliente ${c + 1}`

    if (!bc && ac) {
      changes.push({
        label: cLabel,
        before: '—',
        after: ac.customer?.name ?? 'Novo cliente',
        kind: 'added',
      })
      continue
    }
    if (bc && !ac) {
      changes.push({
        label: cLabel,
        before: bc.customer?.name ?? '—',
        after: '—',
        kind: 'removed',
      })
      continue
    }
    if (!bc || !ac) continue

    pushDiff(changes, `${cLabel} — nome`, bc.customer?.name, ac.customer?.name)
    pushDiff(changes, `${cLabel} — CNPJ`, bc.customer?.cnpj, ac.customer?.cnpj)

    const bAllocs = bc.productAllocations ?? []
    const aAllocs = ac.productAllocations ?? []
    const maxAllocs = Math.max(bAllocs.length, aAllocs.length)

    for (let a = 0; a < maxAllocs; a++) {
      const ba = bAllocs[a]
      const aa = aAllocs[a]
      const aLabel = `${cLabel} · alocação ${a + 1}`

      if (!ba && aa) {
        changes.push({
          label: aLabel,
          before: '—',
          after: `qtd ${aa.quantity ?? 0} · venda ${fmtMoney(aa.unitSale)}`,
          kind: 'added',
        })
        continue
      }
      if (ba && !aa) {
        changes.push({ label: aLabel, before: `qtd ${ba.quantity ?? 0}`, after: '—', kind: 'removed' })
        continue
      }
      if (!ba || !aa) continue

      pushDiff(changes, `${aLabel} — quantidade`, ba.quantity, aa.quantity)
      pushDiff(changes, `${aLabel} — venda unit.`, ba.unitSale, aa.unitSale, fmtMoney)
    }
  }

  // Serviço Interatell (SRV): sem fornecedor, itens digitados direto no pedido.
  const bServices = before.serviceCustomers ?? []
  const aServices = after.serviceCustomers ?? []
  const maxServices = Math.max(bServices.length, aServices.length)

  for (let s = 0; s < maxServices; s++) {
    const bs = bServices[s]
    const as = aServices[s]
    const sLabel = `Serviço Interatell ${s + 1}`

    if (!bs && as) {
      changes.push({ label: sLabel, before: '—', after: as.customer?.name ?? 'Novo cliente de serviço', kind: 'added' })
      continue
    }
    if (bs && !as) {
      changes.push({ label: sLabel, before: bs.customer?.name ?? '—', after: '—', kind: 'removed' })
      continue
    }
    if (!bs || !as) continue

    pushDiff(changes, `${sLabel} — cliente`, bs.customer?.name, as.customer?.name)
    pushDiff(changes, `${sLabel} — CNPJ`, bs.customer?.cnpj, as.customer?.cnpj)
    pushDiff(changes, `${sLabel} — filial`, bs.branch, as.branch)

    const bItems = bs.items ?? []
    const aItems = as.items ?? []
    const maxItems = Math.max(bItems.length, aItems.length)

    for (let i = 0; i < maxItems; i++) {
      const bi = bItems[i]
      const ai = aItems[i]
      const iLabel = `${sLabel} · serviço ${i + 1}`

      if (!bi && ai) {
        changes.push({
          label: iLabel,
          before: '—',
          after: `${ai.description ?? '—'} · qtd ${ai.quantity ?? 1} · venda ${fmtMoney(ai.unitSale)}`,
          kind: 'added',
        })
        continue
      }
      if (bi && !ai) {
        changes.push({ label: iLabel, before: bi.description ?? '—', after: '—', kind: 'removed' })
        continue
      }
      if (!bi || !ai) continue

      pushDiff(changes, `${iLabel} — descrição`, bi.description, ai.description)
      pushDiff(changes, `${iLabel} — quantidade`, bi.quantity, ai.quantity)
      pushDiff(changes, `${iLabel} — venda unit.`, bi.unitSale, ai.unitSale, fmtMoney)
    }
  }

  return changes
}

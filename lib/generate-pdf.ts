import { formatPaymentConditionLabel } from '@/lib/payment-condition-utils'
import { issuersFromPayload } from '@/lib/interatell-companies'

type Natureza = 'HW' | 'SW' | 'LC' | 'ST' | 'SRV'

const NATUREZA_LABEL: Record<Natureza, string> = {
  HW:  'Hardware',
  SW:  'Software',
  LC:  'Licença',
  ST:  'Serviço Terceiro',
  SRV: 'Serviço Interatell',
}

const natureOf = (p: any): Natureza => {
  const n = String(p?.nature ?? 'HW').trim().toUpperCase()
  return (['HW', 'SW', 'LC', 'ST', 'SRV'] as const).includes(n as Natureza) ? (n as Natureza) : 'HW'
}

/**
 * Um documento = um PDF. O que vai pro Omie como OC, OV e cada OS de natureza
 * vira um arquivo separado. Todos mostram fornecedor e cliente, menos o de
 * serviço Interatell (SRV), que não passa por fornecedor.
 */
type DocSpec = {
  title: string
  filePrefix: string
  showSuppliers: boolean
  groups: any[]
  customers: any[]
  serviceCustomers?: any[]
  /** Natureza deste documento — usada para filtrar o resumo do Omie. */
  nat?: Natureza | 'OC'
}

/** Números das ordens criadas no Omie, para carimbar no PDF após o envio. */
export type OmiePdfResumo = {
  oc?: Array<{ numero: string; fornecedor?: string }>
  ov?: Array<{ numero: string; cliente?: string }>
  os?: Array<{ numero: string; cliente?: string; nat?: string }>
}

const OMIE_ORDER_LABEL: Record<string, string> = {
  SW:  'Ordem de Serviço — Software (SW)',
  LC:  'Ordem de Serviço — Licença (LC)',
  ST:  'Ordem de Serviço — Serviço Terceiro (ST)',
  SRV: 'Ordem de Serviço — Serviço (SRV)',
}

/** Só os pedidos Omie que pertencem a este documento. */
function omieRowsFor(resumo: OmiePdfResumo | undefined, nat: DocSpec['nat']): string[][] {
  if (!resumo || !nat) return []
  const ok = (n?: string) => !!n && n !== '?'
  const rows: string[][] = []

  if (nat === 'OC') {
    for (const oc of resumo.oc ?? []) {
      if (ok(oc.numero)) rows.push(['Ordem de Compra (OC)', oc.numero, oc.fornecedor || '—'])
    }
    return rows
  }
  if (nat === 'HW') {
    for (const ov of resumo.ov ?? []) {
      if (ok(ov.numero)) rows.push(['Ordem de Venda (OV)', ov.numero, ov.cliente || '—'])
    }
    return rows
  }
  for (const os of resumo.os ?? []) {
    if (ok(os.numero) && os.nat === nat) {
      rows.push([OMIE_ORDER_LABEL[nat] ?? `OS (${nat})`, String(os.numero), os.cliente || '—'])
    }
  }
  return rows
}

/** Natureza do produto referenciado por uma alocação de cliente. */
function allocNature(values: any, alloc: any): Natureza {
  const group = (values.supplierGroups || []).find((g: any) => g.localId === alloc.groupLocalId)
  const product = group?.products?.[alloc.productIndex]
  return natureOf(product)
}

function groupsWith(values: any, keep: (n: Natureza) => boolean) {
  return (values.supplierGroups || [])
    .map((g: any) => ({ ...g, products: (g.products || []).filter((p: any) => keep(natureOf(p))) }))
    .filter((g: any) => g.products.length > 0)
}

function customersWith(values: any, keep: (n: Natureza) => boolean) {
  return (values.customers || [])
    .map((c: any) => ({
      ...c,
      productAllocations: (c.productAllocations || [])
        .filter((a: any) => Number(a.quantity) > 0 && keep(allocNature(values, a))),
    }))
    .filter((c: any) => c.productAllocations.length > 0)
}

/** Monta a lista de documentos que este negócio gera. */
function buildDocSpecs(values: any): DocSpec[] {
  const specs: DocSpec[] = []
  const allCustomers = customersWith(values, () => true)

  // OC — tudo que é comprado de fornecedor (SRV não entra: é serviço próprio).
  const ocGroups = groupsWith(values, n => n !== 'SRV')
  if (ocGroups.length) {
    specs.push({
      title: 'ORDEM DE COMPRA',
      filePrefix: 'ordem_compra',
      showSuppliers: true,
      nat: 'OC',
      groups: ocGroups,
      customers: allCustomers,
    })
  }

  // OV — só hardware.
  const ovGroups = groupsWith(values, n => n === 'HW')
  const ovCustomers = customersWith(values, n => n === 'HW')
  if (ovGroups.length || ovCustomers.length) {
    specs.push({
      title: 'ORDEM DE VENDA',
      filePrefix: 'ordem_venda',
      showSuppliers: true,
      nat: 'HW',
      groups: ovGroups,
      customers: ovCustomers,
    })
  }

  // OS por natureza que passa por fornecedor.
  for (const nat of ['SW', 'LC', 'ST'] as Natureza[]) {
    const g = groupsWith(values, n => n === nat)
    const c = customersWith(values, n => n === nat)
    if (!g.length && !c.length) continue
    specs.push({
      title: `ORDEM DE SERVIÇO — ${NATUREZA_LABEL[nat].toUpperCase()} (${nat})`,
      filePrefix: `ordem_servico_${nat.toLowerCase()}`,
      showSuppliers: true,
      nat,
      groups: g,
      customers: c,
    })
  }

  // OS de serviço Interatell — só cliente, sem fornecedor.
  const svc = (values.serviceCustomers || []).filter((s: any) => (s.items || []).length > 0)
  if (svc.length) {
    specs.push({
      title: 'ORDEM DE SERVIÇO — SERVIÇO INTERATELL (SRV)',
      filePrefix: 'ordem_servico_srv',
      showSuppliers: false,
      nat: 'SRV',
      groups: [],
      customers: [],
      serviceCustomers: svc,
    })
  }

  return specs
}

async function renderDoc(values: any, spec: DocSpec, resumo?: OmiePdfResumo): Promise<void> {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const doc = new jsPDF()
  const PAGE_W = doc.internal.pageSize.getWidth()
  let y = 18

  const safeY = (need: number) => {
    if (y + need > 270) { doc.addPage(); y = 14 }
  }

  const addSection = (title: string) => {
    safeY(14)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30, 64, 175)
    doc.text(title.toUpperCase(), 14, y)
    doc.setDrawColor(30, 64, 175)
    doc.setLineWidth(0.3)
    doc.line(14, y + 1.5, PAGE_W - 14, y + 1.5)
    doc.setTextColor(0, 0, 0)
    y += 7
  }

  const addKV = (label: string, value: string) => {
    safeY(6)
    doc.setFontSize(8.5)
    doc.setFont('helvetica', 'bold')
    doc.text(label, 14, y)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(50, 50, 50)
    const val = doc.splitTextToSize(value || '—', PAGE_W - 70)
    doc.text(val, 58, y)
    doc.setTextColor(0, 0, 0)
    y += Math.max(5, val.length * 4.5)
  }

  // Cabeçalho
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(15, 23, 42)
  doc.text(spec.title, PAGE_W / 2, y, { align: 'center' })
  y += 7
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 116, 139)
  doc.text(
    `Nº ${values.business?.commercialProposal || values.bitrixDealId || '—'}   ·   Emitido em ${new Date().toLocaleDateString('pt-BR')}`,
    PAGE_W / 2, y, { align: 'center' },
  )
  y += 10
  doc.setDrawColor(200, 200, 200)
  doc.setLineWidth(0.5)
  doc.line(14, y, PAGE_W - 14, y)
  y += 8
  doc.setTextColor(0, 0, 0)

  const addEntity = (e: any, opts?: { alwaysContact?: boolean }) => {
    if (!e) return
    if (e.name)              addKV('Razão Social:',  e.name)
    if (e.cnpj)              addKV('CNPJ:',          e.cnpj)
    if (e.stateRegistration) addKV('IE:',            e.stateRegistration)
    const addr = [e.address, e.number].filter(Boolean).join(', ')
    if (addr)                addKV('Endereço:',      addr)
    if (e.neighborhood)      addKV('Bairro:',        e.neighborhood)
    const cityState = [e.city, e.state].filter(Boolean).join('/')
    if (cityState)           addKV('Cidade/UF:',     cityState)
    if (e.zipCode)           addKV('CEP:',           e.zipCode)
    if (e.contactName || opts?.alwaysContact) addKV('Contato:',   e.contactName || '—')
    if (e.phone || opts?.alwaysContact)       addKV('Telefone:',  e.phone || '—')
    if (e.email || opts?.alwaysContact)       addKV('E-mail:',    e.email || '—')
  }

  // O payload guarda interatellBranches (uma ou ambas as filiais), não um objeto
  // pronto — por isso a seção saía vazia quando lia values.interatell direto.
  const issuers = issuersFromPayload(values)
  addSection(issuers.length > 1 ? 'Empresas Emissoras' : 'Empresa Emissora')
  if (!issuers.length) {
    addKV('Razão Social:', '—')
  } else {
    for (const [i, issuer] of issuers.entries()) {
      if (i > 0) y += 2
      addEntity(issuer)
    }
  }
  y += 3

  addSection('Dados do Negócio')
  addKV('Proposta nº:', values.business?.commercialProposal || '')
  addKV('Data OC:', values.business?.purchaseOrderDate || '')
  addKV('Prazo de entrega:', values.business?.deliveryDeadline || '')
  addKV('Prev. faturamento:', values.business?.expectedBillingDate || '')
  addKV('Cond. compra:', formatPaymentConditionLabel(values.business?.purchasePaymentCondition || '', 'purchase'))
  addKV('Cond. venda:', formatPaymentConditionLabel(values.business?.salePaymentCondition || '', 'sale'))
  y += 3

  const money = (v: number) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`

  // Fornecedores (ausente no documento de serviço Interatell)
  if (spec.showSuppliers && spec.groups.length) {
    addSection('Fornecedores e Produtos')
    for (const [gi, group] of spec.groups.entries()) {
      safeY(30)
      doc.setFontSize(8.5)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(30, 64, 175)
      doc.text(`Fornecedor ${gi + 1}${group.branch ? ` · ${group.branch === 'es' ? 'Filial ES' : 'Barueri (SP)'}` : ''}`, 14, y)
      doc.setTextColor(0, 0, 0)
      y += 5
      addEntity(group.supplier)
      const products = group.products || []
      if (products.length) {
        const totalCusto = products.reduce((s: number, p: any) => s + Number(p.unitCost || 0) * Number(p.quantity || 0), 0)
        autoTable(doc, {
          startY: y,
          head: [['Partnumber', 'Descrição', 'Nat.', 'Qtd', 'Custo Unit.', 'Total Custo']],
          body: [
            ...products.map((p: any) => [
              p.partnumber, p.description, natureOf(p), p.quantity,
              money(Number(p.unitCost || 0)),
              money(Number(p.unitCost || 0) * Number(p.quantity || 0)),
            ]),
            ['', '', '', '', { content: 'Total:', styles: { fontStyle: 'bold' as const, halign: 'right' as const } },
              { content: money(totalCusto), styles: { fontStyle: 'bold' as const, halign: 'right' as const, textColor: [30, 64, 175] as any } }],
          ],
          styles:             { fontSize: 7.5, cellPadding: 2.5 },
          headStyles:         { fillColor: [30, 64, 175], textColor: 255, fontStyle: 'bold' },
          alternateRowStyles: { fillColor: [239, 246, 255] },
          columnStyles:       { 0: { fontStyle: 'bold' }, 2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
          margin:             { left: 14, right: 14 },
        })
        y = (doc as any).lastAutoTable.finalY + 6
      }
    }
  }

  // Clientes com produtos alocados
  if (spec.customers.length) {
    addSection('Clientes')
    for (const [ci, entry] of spec.customers.entries()) {
      safeY(30)
      doc.setFontSize(8.5)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(109, 40, 217)
      doc.text(`Cliente ${ci + 1}${entry.branch ? ` · ${entry.branch === 'es' ? 'Filial ES' : 'Barueri (SP)'}` : ''}`, 14, y)
      doc.setTextColor(0, 0, 0)
      y += 5
      addEntity(entry.customer, { alwaysContact: true })
      const allocated = entry.productAllocations || []
      if (allocated.length) {
        const totalVenda = allocated.reduce((s: number, a: any) => s + Number(a.unitSale || 0) * Number(a.quantity || 0), 0)
        autoTable(doc, {
          startY: y,
          head: [['Partnumber', 'Descrição', 'Qtd', 'Preço Unit. Venda', 'Total Venda']],
          body: [
            ...allocated.map((a: any) => [
              a.partnumber, a.description, a.quantity,
              money(Number(a.unitSale || 0)),
              money(Number(a.unitSale || 0) * Number(a.quantity || 0)),
            ]),
            ['', '', '', { content: 'Total:', styles: { fontStyle: 'bold' as const, halign: 'right' as const } },
              { content: money(totalVenda), styles: { fontStyle: 'bold' as const, halign: 'right' as const, textColor: [109, 40, 217] as any } }],
          ],
          styles:             { fontSize: 7.5, cellPadding: 2.5 },
          headStyles:         { fillColor: [109, 40, 217], textColor: 255, fontStyle: 'bold' },
          alternateRowStyles: { fillColor: [245, 243, 255] },
          columnStyles:       { 0: { fontStyle: 'bold' }, 2: { halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
          margin:             { left: 14, right: 14 },
        })
        y = (doc as any).lastAutoTable.finalY + 6
      }
    }
  }

  // Clientes de serviço Interatell — sem fornecedor, itens digitados direto
  if (spec.serviceCustomers?.length) {
    addSection('Clientes e Serviços')
    for (const [ci, entry] of spec.serviceCustomers.entries()) {
      safeY(30)
      doc.setFontSize(8.5)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(13, 148, 136)
      doc.text(`Cliente ${ci + 1}${entry.branch ? ` · ${entry.branch === 'es' ? 'Filial ES' : 'Barueri (SP)'}` : ''}`, 14, y)
      doc.setTextColor(0, 0, 0)
      y += 5
      addEntity(entry.customer, { alwaysContact: true })
      const items = entry.items || []
      if (items.length) {
        const total = items.reduce((s: number, i: any) => s + Number(i.unitSale || 0) * Number(i.quantity || 0), 0)
        autoTable(doc, {
          startY: y,
          head: [['Descrição do Serviço', 'Qtd', 'Valor Unit.', 'Total']],
          body: [
            ...items.map((i: any) => [
              i.description, i.quantity,
              money(Number(i.unitSale || 0)),
              money(Number(i.unitSale || 0) * Number(i.quantity || 0)),
            ]),
            ['', '', { content: 'Total:', styles: { fontStyle: 'bold' as const, halign: 'right' as const } },
              { content: money(total), styles: { fontStyle: 'bold' as const, halign: 'right' as const, textColor: [13, 148, 136] as any } }],
          ],
          styles:             { fontSize: 7.5, cellPadding: 2.5 },
          headStyles:         { fillColor: [13, 148, 136], textColor: 255, fontStyle: 'bold' },
          alternateRowStyles: { fillColor: [240, 253, 250] },
          columnStyles:       { 0: { fontStyle: 'bold' }, 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
          margin:             { left: 14, right: 14 },
        })
        y = (doc as any).lastAutoTable.finalY + 6
      }
    }
  }

  // Pedidos gerados no Omie (só os deste documento)
  const omieRows = omieRowsFor(resumo, spec.nat)
  if (omieRows.length) {
    safeY(omieRows.length * 7 + 18)
    addSection('Pedidos Gerados no Omie')
    autoTable(doc, {
      startY: y,
      head: [['Tipo', 'Número', 'Parceiro']],
      body: omieRows,
      styles:             { fontSize: 7.5, cellPadding: 2.5 },
      headStyles:         { fillColor: [22, 101, 52], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [240, 253, 244] },
      columnStyles:       { 1: { fontStyle: 'bold' } },
      margin:             { left: 14, right: 14 },
    })
    y = (doc as any).lastAutoTable.finalY + 6
  }

  safeY(20)
  addSection('Condições de Pagamento')
  // Mostra o rótulo completo cadastrado (ex.: "A60 - Para 60 Dias"), não só o código.
  addKV('Compra:', formatPaymentConditionLabel(values.business?.purchasePaymentCondition || '', 'purchase'))
  addKV('Venda:', formatPaymentConditionLabel(values.business?.salePaymentCondition || '', 'sale'))
  y += 3

  const extNotes = (values.notes?.externalNotes || '').trim()
  const intNotes = (values.notes?.internalNotes || '').trim()
  if (extNotes || intNotes) {
    addSection('Observações')
    doc.setFontSize(8.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(50, 50, 50)
    const renderNote = (label: string, text: string) => {
      safeY(8)
      doc.setFont('helvetica', 'bold')
      doc.text(label, 14, y)
      y += 4
      doc.setFont('helvetica', 'normal')
      const lines = doc.splitTextToSize(text, PAGE_W - 28)
      for (const line of lines) {
        safeY(6)
        doc.text(line, 14, y)
        y += 5
      }
      y += 2
    }
    if (extNotes) renderNote('Externa:', extNotes)
    if (intNotes) renderNote('Interna:', intNotes)
    doc.setTextColor(0, 0, 0)
  }

  const totalPages = (doc as any).internal.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    const pageH = doc.internal.pageSize.getHeight()
    doc.setFontSize(7)
    doc.setTextColor(150, 150, 150)
    doc.setFont('helvetica', 'normal')
    doc.text(
      `Interatell Integrações e Telecomunicações Ltda  ·  Página ${i} de ${totalPages}`,
      PAGE_W / 2, pageH - 8, { align: 'center' },
    )
    doc.setDrawColor(220, 220, 220)
    doc.setLineWidth(0.3)
    doc.line(14, pageH - 12, PAGE_W - 14, pageH - 12)
  }

  const ref = values.business?.commercialProposal || values.bitrixDealId || 'rascunho'
  doc.save(`${spec.filePrefix}_${ref}${resumo ? '_omie' : ''}.pdf`)
}

/**
 * Gera um PDF por documento (OC, OV e uma OS por natureza).
 * Retorna quantos arquivos foram baixados.
 */
export async function generateDealPDFs(values: any, resumo?: OmiePdfResumo): Promise<number> {
  const specs = buildDocSpecs(values)
  if (!specs.length) {
    // Negócio sem itens: mantém um documento único para não deixar o usuário sem nada.
    await renderDoc(values, {
      title: 'ORDEM DE COMPRA',
      filePrefix: 'ordem_compra',
      showSuppliers: true,
      nat: 'OC',
      groups: values.supplierGroups || [],
      customers: values.customers || [],
    }, resumo)
    return 1
  }
  // Downloads em sequência imediata são engolidos pelo navegador (só o primeiro
  // arquivo chega). Espaçar os saves faz todos passarem — na primeira vez o
  // Chrome pergunta se permite baixar vários arquivos do site.
  for (const [i, spec] of specs.entries()) {
    if (i > 0) await new Promise(r => setTimeout(r, 700))
    await renderDoc(values, spec, resumo)
  }
  return specs.length
}

/** Compatibilidade: gera todos os documentos do negócio. */
export async function generateDealPDF(values: any, resumo?: OmiePdfResumo): Promise<void> {
  await generateDealPDFs(values, resumo)
}

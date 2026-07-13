export async function generateDealPDF(values: any): Promise<void> {
  const { formatPaymentConditionLabel } = await import('@/lib/payment-condition-utils')
  const { default: jsPDF }     = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const doc    = new jsPDF()
  const PAGE_W = doc.internal.pageSize.getWidth()
  let y = 14

  const safeY = (need = 20) => {
    if (y + need > 270) { doc.addPage(); y = 14 }
  }

  const addSection = (title: string) => {
    safeY(12)
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
    y += val.length > 1 ? val.length * 4.5 : 5
  }

  // Cabeçalho
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(15, 23, 42)
  doc.text('ORDEM DE COMPRA', PAGE_W / 2, y, { align: 'center' })
  y += 7
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 116, 139)
  doc.text(
    `Nº ${values.business?.commercialProposal || values.bitrixDealId || '—'}   ·   Emitido em ${new Date().toLocaleDateString('pt-BR')}`,
    PAGE_W / 2, y, { align: 'center' }
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

  // Empresa emissora
  addSection('Empresa Emissora')
  addEntity(values.interatell)
  y += 3

  // Negócio
  addSection('Dados do Negócio')
  addKV('Proposta nº:', values.business?.commercialProposal || '')
  addKV('Data OC:', values.business?.purchaseOrderDate || '')
  addKV('Prazo de entrega:', values.business?.deliveryDeadline || '')
  addKV('Prev. faturamento:', values.business?.expectedBillingDate || '')
  addKV('Cond. compra:', formatPaymentConditionLabel(values.business?.purchasePaymentCondition || '', 'purchase'))
  addKV('Cond. venda:', formatPaymentConditionLabel(values.business?.salePaymentCondition || '', 'sale'))
  y += 3

  // Fornecedores
  addSection('Fornecedores e Produtos')
  for (const [gi, group] of ((values.supplierGroups || []) as any[]).entries()) {
    safeY(30)
    doc.setFontSize(8.5)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30, 64, 175)
    doc.text(`Fornecedor ${gi + 1}`, 14, y)
    doc.setTextColor(0, 0, 0)
    y += 5
    addEntity((group as any).supplier)
    y += 3
    const fmtCur = (v: number) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    const products: any[] = (group as any).products || []
    const totalCusto = products.reduce((s: number, p: any) => s + Number(p.totalCost || 0), 0)
    autoTable(doc, {
      startY: y,
      head: [['Partnumber', 'Descrição', 'Qtd', 'Custo Unit.', 'Total Custo']],
      body: [
        ...products.map((p: any) => [
          p.partnumber, p.description, p.quantity,
          fmtCur(Number(p.unitCost || 0)),
          fmtCur(Number(p.totalCost || 0)),
        ]),
        ['', '', '', { content: 'Total:', styles: { fontStyle: 'bold' as const, halign: 'right' as const } }, { content: fmtCur(totalCusto), styles: { fontStyle: 'bold' as const, halign: 'right' as const, textColor: [30, 64, 175] as any } }],
      ],
      styles:             { fontSize: 7.5, cellPadding: 2.5 },
      headStyles:         { fillColor: [30, 64, 175], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [240, 245, 255] },
      columnStyles:       { 0: { fontStyle: 'bold' }, 2: { halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
      margin:             { left: 14, right: 14 },
    })
    y = (doc as any).lastAutoTable.finalY + 6
  }
  y += 2

  // Clientes
  addSection('Clientes')
  for (const [ci, entry] of ((values.customers || []) as any[]).entries()) {
    safeY(30)
    doc.setFontSize(8.5)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(109, 40, 217)
    doc.text(`Cliente ${ci + 1}`, 14, y)
    doc.setTextColor(0, 0, 0)
    y += 5
    addEntity((entry as any).customer, { alwaysContact: true })
    const allocated = ((entry as any).productAllocations || []).filter((a: any) => a.quantity > 0)
    if (allocated.length > 0) {
      const fmt = (v: number) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
      const totalVenda = allocated.reduce((s: number, a: any) => s + (Number(a.unitSale || 0) * Number(a.quantity || 0)), 0)
      autoTable(doc, {
        startY: y,
        head: [['Partnumber', 'Descrição', 'Qtd', 'Preço Unit. Venda', 'Total Venda']],
        body: [
          ...allocated.map((a: any) => [
            a.partnumber,
            a.description,
            a.quantity,
            fmt(Number(a.unitSale || 0)),
            fmt(Number(a.unitSale || 0) * Number(a.quantity || 0)),
          ]),
          ['', '', '', { content: 'Total:', styles: { fontStyle: 'bold' as const, halign: 'right' as const } }, { content: fmt(totalVenda), styles: { fontStyle: 'bold' as const, halign: 'right' as const, textColor: [109, 40, 217] as any } }],
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

  // Condições de pagamento
  safeY(20)
  addSection('Condições de Pagamento')
  addKV('Compra:', values.business?.purchasePaymentCondition || '')
  addKV('Venda:', values.business?.salePaymentCondition || '')
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

  // Rodapé
  const totalPages = (doc as any).internal.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    const pageH = doc.internal.pageSize.getHeight()
    doc.setFontSize(7)
    doc.setTextColor(150, 150, 150)
    doc.setFont('helvetica', 'normal')
    doc.text(
      `Interatell Integrações e Telecomunicações Ltda  ·  Página ${i} de ${totalPages}`,
      PAGE_W / 2, pageH - 8, { align: 'center' }
    )
    doc.setDrawColor(220, 220, 220)
    doc.setLineWidth(0.3)
    doc.line(14, pageH - 12, PAGE_W - 14, pageH - 12)
  }

  const filename = `ordem_compra_${values.business?.commercialProposal || values.bitrixDealId || 'rascunho'}.pdf`
  doc.save(filename)
}

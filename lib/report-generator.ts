"use client"

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { formatCurrency, formatDate } from './utils'

export interface ReportData {
  business: {
    name: string
    commercialProposal?: string
    purchaseOrderDate: string
    deliveryDeadline: string
    purchasePaymentCondition: string
    expectedBillingDate: string
    salePaymentCondition: string
  }
  companies: {
    supplier: {
      cnpj: string
      name: string
      stateRegistration?: string
      zipCode: string
      city: string
      state: string
      neighborhood: string
      address: string
      number: string
      complement?: string
      contactName?: string
      phone?: string
      email?: string
    }
    customer: {
      cnpj: string
      name: string
      stateRegistration?: string
      zipCode: string
      city: string
      state: string
      neighborhood: string
      address: string
      number: string
      complement?: string
      contactName?: string
      phone?: string
      email?: string
      isTaxpayer?: boolean
      purchaseOrder?: string
    }
    interatell: {
      cnpj: string
      name: string
      stateRegistration?: string
      zipCode: string
      city: string
      state: string
      neighborhood: string
      address: string
      number: string
      complement?: string
      contactName?: string
      phone?: string
      email?: string
    }
  }
  products: Array<{
    id: number
    partnumber: string
    description: string
    state: string
    quantity: number
    unitCost: number
    totalCost: number
    unitSale: number
    totalSale: number
    cfop?: string
    nature?: string
    family?: string
    ncm?: string
  }>
  notes?: {
    internalNotes?: string
    externalNotes?: string
  }
}

export function generatePDFReport(data: ReportData): void {
  const doc = new jsPDF()
  
  // Configurações básicas
  const pageWidth = doc.internal.pageSize.width
  const pageHeight = doc.internal.pageSize.height
  const margin = 20
  const contentWidth = pageWidth - (2 * margin)
  let yPosition = margin

  // Função auxiliar para verificar quebra de página
  const checkPageBreak = (requiredSpace: number) => {
    if (yPosition + requiredSpace > pageHeight - margin - 20) {
      doc.addPage()
      yPosition = margin
      return true
    }
    return false
  }

  // Função auxiliar para formatar valores opcionais
  const formatOptionalValue = (value: string | undefined | null): string => {
    if (!value || value.trim() === '' || value === 'undefined') {
      return 'N/A'
    }
    return value.trim()
  }

  // Função para adicionar título de seção
  const addSectionTitle = (title: string) => {
    checkPageBreak(25)
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text(title, margin, yPosition)
    yPosition += 15
  }

  // Função para adicionar linha de informação
  const addInfoLine = (label: string, value: string, indent: number = 0) => {
    checkPageBreak(8)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text(label, margin + indent, yPosition)
    doc.setFont('helvetica', 'normal')
    
    // Quebrar texto longo se necessário
    const maxWidth = contentWidth - 80 - indent
    const splitText = doc.splitTextToSize(value, maxWidth)
    
    if (Array.isArray(splitText)) {
      splitText.forEach((line, index) => {
        if (index > 0) {
          checkPageBreak(6)
        }
        doc.text(line, margin + 80 + indent, yPosition + (index * 6))
      })
      yPosition += (splitText.length - 1) * 6
    } else {
      doc.text(value, margin + 80 + indent, yPosition)
    }
    
    yPosition += 8
  }

  // CABEÇALHO
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('RELATORIO DE TRANSACAO - INSIDE SALES', pageWidth / 2, yPosition, { align: 'center' })
  yPosition += 15

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, pageWidth - margin, yPosition, { align: 'right' })
  yPosition += 20

  // Linha separadora
  doc.setLineWidth(0.5)
  doc.line(margin, yPosition, pageWidth - margin, yPosition)
  yPosition += 15

  // SEÇÃO 1: INFORMAÇÕES DO NEGÓCIO
  addSectionTitle('1. INFORMACOES DO NEGOCIO')
  
  addInfoLine('Nome do Negocio:', data.business.name || 'N/A')
  addInfoLine('Proposta Comercial:', formatOptionalValue(data.business.commercialProposal))
  addInfoLine('Data da OC:', formatDate(data.business.purchaseOrderDate))
  addInfoLine('Prazo de Entrega:', formatDate(data.business.deliveryDeadline))
  addInfoLine('Condicao Pagamento Compra:', data.business.purchasePaymentCondition || 'N/A')
  addInfoLine('Data Previsao Faturamento:', formatDate(data.business.expectedBillingDate))
  addInfoLine('Condicao Pagamento Venda:', data.business.salePaymentCondition || 'N/A')

  yPosition += 10

  // SEÇÃO 2: EMPRESAS
  addSectionTitle('2. EMPRESAS ENVOLVIDAS')

  // Fornecedor
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('2.1 FORNECEDOR', margin, yPosition)
  yPosition += 10

  addInfoLine('Nome:', data.companies.supplier.name || 'N/A', 5)
  addInfoLine('CNPJ:', data.companies.supplier.cnpj || 'N/A', 5)
  addInfoLine('Inscricao Estadual:', formatOptionalValue(data.companies.supplier.stateRegistration), 5)
  
  const supplierAddress = `${data.companies.supplier.address || ''}, ${data.companies.supplier.number || ''}`.replace(/^, |, $/, '') || 'N/A'
  addInfoLine('Endereco:', supplierAddress, 5)
  addInfoLine('Bairro:', data.companies.supplier.neighborhood || 'N/A', 5)
  addInfoLine('Cidade/Estado:', `${data.companies.supplier.city || ''}/${data.companies.supplier.state || ''}`.replace(/^\/|\/$/g, '') || 'N/A', 5)
  addInfoLine('CEP:', data.companies.supplier.zipCode || 'N/A', 5)
  addInfoLine('Contato:', formatOptionalValue(data.companies.supplier.contactName), 5)
  addInfoLine('Telefone:', formatOptionalValue(data.companies.supplier.phone), 5)
  addInfoLine('Email:', formatOptionalValue(data.companies.supplier.email), 5)

  yPosition += 5

  // Cliente
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('2.2 CLIENTE', margin, yPosition)
  yPosition += 10

  addInfoLine('Nome:', data.companies.customer.name || 'N/A', 5)
  addInfoLine('CNPJ:', data.companies.customer.cnpj || 'N/A', 5)
  addInfoLine('Inscricao Estadual:', formatOptionalValue(data.companies.customer.stateRegistration), 5)
  
  const customerAddress = `${data.companies.customer.address || ''}, ${data.companies.customer.number || ''}`.replace(/^, |, $/, '') || 'N/A'
  addInfoLine('Endereco:', customerAddress, 5)
  addInfoLine('Bairro:', data.companies.customer.neighborhood || 'N/A', 5)
  addInfoLine('Cidade/Estado:', `${data.companies.customer.city || ''}/${data.companies.customer.state || ''}`.replace(/^\/|\/$/g, '') || 'N/A', 5)
  addInfoLine('CEP:', data.companies.customer.zipCode || 'N/A', 5)
  addInfoLine('Contato:', formatOptionalValue(data.companies.customer.contactName), 5)
  addInfoLine('Telefone:', formatOptionalValue(data.companies.customer.phone), 5)
  addInfoLine('Email:', formatOptionalValue(data.companies.customer.email), 5)
  addInfoLine('Contribuinte:', data.companies.customer.isTaxpayer ? 'Sim' : 'Nao', 5)
  addInfoLine('Ordem de Compra:', formatOptionalValue(data.companies.customer.purchaseOrder), 5)

  yPosition += 5

  // Interatell
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('2.3 INTERATELL', margin, yPosition)
  yPosition += 10

  addInfoLine('Nome:', data.companies.interatell.name || 'N/A', 5)
  addInfoLine('CNPJ:', data.companies.interatell.cnpj || 'N/A', 5)
  addInfoLine('Inscricao Estadual:', formatOptionalValue(data.companies.interatell.stateRegistration), 5)
  
  const interatellAddress = `${data.companies.interatell.address || ''}, ${data.companies.interatell.number || ''}`.replace(/^, |, $/, '') || 'N/A'
  addInfoLine('Endereco:', interatellAddress, 5)
  addInfoLine('Bairro:', data.companies.interatell.neighborhood || 'N/A', 5)
  addInfoLine('Cidade/Estado:', `${data.companies.interatell.city || ''}/${data.companies.interatell.state || ''}`.replace(/^\/|\/$/g, '') || 'N/A', 5)
  addInfoLine('CEP:', data.companies.interatell.zipCode || 'N/A', 5)
  addInfoLine('Contato:', formatOptionalValue(data.companies.interatell.contactName), 5)
  addInfoLine('Telefone:', formatOptionalValue(data.companies.interatell.phone), 5)
  addInfoLine('Email:', formatOptionalValue(data.companies.interatell.email), 5)

  // Nova página para produtos
  doc.addPage()
  yPosition = margin

  // SEÇÃO 3: PRODUTOS
  addSectionTitle('3. LISTA DE PRODUTOS')

  if (!data.products || data.products.length === 0) {
    doc.setFontSize(12)
    doc.setFont('helvetica', 'italic')
    doc.text('Nenhum produto foi adicionado a esta transacao.', margin, yPosition)
    yPosition += 20
  } else {
    // Tabela de produtos simplificada
    const tableData = data.products.map(product => [
      product.partnumber || 'N/A',
      product.description || 'N/A',
      product.quantity?.toString() || '0',
      formatCurrency(product.unitCost || 0),
      formatCurrency(product.totalCost || 0),
      formatCurrency(product.unitSale || 0),
      formatCurrency(product.totalSale || 0)
    ])

    autoTable(doc, {
      head: [['Part Number', 'Descricao', 'Qtd', 'Custo Unit.', 'Custo Total', 'Venda Unit.', 'Venda Total']],
      body: tableData,
      startY: yPosition,
      styles: { 
        fontSize: 8,
        cellPadding: 2,
        overflow: 'linebreak'
      },
      headStyles: { 
        fillColor: [70, 130, 180],
        textColor: 255,
        fontStyle: 'bold'
      },
      columnStyles: {
        0: { cellWidth: 25 },
        1: { cellWidth: 35 },
        2: { halign: 'center', cellWidth: 15 },
        3: { halign: 'right', cellWidth: 22 },
        4: { halign: 'right', cellWidth: 22 },
        5: { halign: 'right', cellWidth: 22 },
        6: { halign: 'right', cellWidth: 22 }
      },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      margin: { left: margin, right: margin }
    })

    yPosition = (doc as any).lastAutoTable.finalY + 15
  }

  // SEÇÃO 4: RESUMO FINANCEIRO
  checkPageBreak(50)
  addSectionTitle('4. RESUMO FINANCEIRO')

  const totalCost = data.products?.reduce((sum, product) => sum + (product.totalCost || 0), 0) || 0
  const totalSale = data.products?.reduce((sum, product) => sum + (product.totalSale || 0), 0) || 0
  const profit = totalSale - totalCost
  const profitMargin = totalSale > 0 ? (profit / totalSale) * 100 : 0

  addInfoLine('Custo Total:', formatCurrency(totalCost))
  addInfoLine('Venda Total:', formatCurrency(totalSale))
  addInfoLine('Lucro:', formatCurrency(profit))
  addInfoLine('Margem de Lucro:', `${profitMargin.toFixed(2)}%`)

  // SEÇÃO 5: OBSERVAÇÕES
  const hasNotes = (data.notes?.internalNotes && data.notes.internalNotes.trim() !== '') || 
                   (data.notes?.externalNotes && data.notes.externalNotes.trim() !== '')
  
  if (hasNotes) {
    yPosition += 10
    addSectionTitle('5. OBSERVACOES')

    if (data.notes?.internalNotes && data.notes.internalNotes.trim() !== '') {
      doc.setFontSize(12)
      doc.setFont('helvetica', 'bold')
      doc.text('5.1 OBSERVACOES INTERNAS', margin, yPosition)
      yPosition += 10
      
      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      const splitInternalNotes = doc.splitTextToSize(data.notes.internalNotes.trim(), contentWidth - 10)
      
      if (Array.isArray(splitInternalNotes)) {
        splitInternalNotes.forEach((line) => {
          checkPageBreak(8)
          doc.text(line, margin + 5, yPosition)
          yPosition += 6
        })
      } else {
        doc.text(splitInternalNotes, margin + 5, yPosition)
        yPosition += 6
      }
      yPosition += 10
    }
    
    if (data.notes?.externalNotes && data.notes.externalNotes.trim() !== '') {
      doc.setFontSize(12)
      doc.setFont('helvetica', 'bold')
      doc.text('5.2 OBSERVACOES EXTERNAS', margin, yPosition)
      yPosition += 10
      
      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      const splitExternalNotes = doc.splitTextToSize(data.notes.externalNotes.trim(), contentWidth - 10)
      
      if (Array.isArray(splitExternalNotes)) {
        splitExternalNotes.forEach((line) => {
          checkPageBreak(8)
          doc.text(line, margin + 5, yPosition)
          yPosition += 6
        })
      } else {
        doc.text(splitExternalNotes, margin + 5, yPosition)
        yPosition += 6
      }
    }
  }

  // Rodapé simples
  const pageCount = (doc as any).internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(100, 100, 100)
    
    doc.line(margin, pageHeight - 15, pageWidth - margin, pageHeight - 15)
    doc.text('Sistema de Inside Sales - Relatorio de Transacao', margin, pageHeight - 8)
    doc.text(`Pagina ${i} de ${pageCount}`, pageWidth - margin, pageHeight - 8, { align: 'right' })
    
    doc.setTextColor(0, 0, 0)
  }

  // Download
  const businessName = data.business.name?.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '-') || 'transacao'
  const dateStr = new Date().toISOString().split('T')[0]
  const fileName = `relatorio-${businessName}-${dateStr}.pdf`
  
  doc.save(fileName)
}

export function generateExcelReport(data: ReportData): void {
  // Função auxiliar para formatar valores opcionais
  const formatOptionalValue = (value: string | undefined | null): string => {
    if (!value || value.trim() === '' || value === 'undefined') {
      return 'N/A'
    }
    return value.trim()
  }

  // Criar workbook
  const wb = XLSX.utils.book_new()

  // Calcular totais com segurança
  const totalCost = data.products?.reduce((sum, product) => sum + (product.totalCost || 0), 0) || 0
  const totalSale = data.products?.reduce((sum, product) => sum + (product.totalSale || 0), 0) || 0
  const profit = totalSale - totalCost
  const profitMargin = totalSale > 0 ? (profit / totalSale) * 100 : 0

  // Aba 1: Resumo
  const summaryData = [
    ['RELATÓRIO DE TRANSAÇÃO - INSIDE SALES'],
    [''],
    ['Gerado em:', new Date().toLocaleString('pt-BR')],
    [''],
    ['INFORMAÇÕES DO NEGÓCIO'],
    ['Nome do Negócio:', data.business.name || 'N/A'],
    ['Proposta Comercial:', formatOptionalValue(data.business.commercialProposal)],
    ['Data da OC:', formatDate(data.business.purchaseOrderDate)],
    ['Prazo de Entrega:', formatDate(data.business.deliveryDeadline)],
    ['Condição Pagamento Compra:', data.business.purchasePaymentCondition || 'N/A'],
    ['Data Previsão Faturamento:', formatDate(data.business.expectedBillingDate)],
    ['Condição Pagamento Venda:', data.business.salePaymentCondition || 'N/A'],
    [''],
    ['RESUMO FINANCEIRO'],
    ['Custo Total:', totalCost],
    ['Venda Total:', totalSale],
    ['Lucro:', profit],
    ['Margem de Lucro (%):', profitMargin.toFixed(2)]
  ]

  if (data.notes?.internalNotes || data.notes?.externalNotes) {
    summaryData.push([''], ['OBSERVAÇÕES'])
    if (data.notes.internalNotes && data.notes.internalNotes.trim() !== '') {
      summaryData.push(['Observações Internas:', data.notes.internalNotes.trim()])
    }
    if (data.notes.externalNotes && data.notes.externalNotes.trim() !== '') {
      summaryData.push(['Observações Externas:', data.notes.externalNotes.trim()])
    }
  }

  const summaryWs = XLSX.utils.aoa_to_sheet(summaryData)
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Resumo')

  // Aba 2: Empresas
  const companiesData = [
    ['EMPRESAS ENVOLVIDAS'],
    [''],
    ['FORNECEDOR'],
    ['Nome:', data.companies.supplier.name || 'N/A'],
    ['CNPJ:', data.companies.supplier.cnpj || 'N/A'],
    ['Inscrição Estadual:', formatOptionalValue(data.companies.supplier.stateRegistration)],
    ['Endereço:', data.companies.supplier.address || 'N/A'],
    ['Número:', data.companies.supplier.number || 'N/A'],
    ['Complemento:', formatOptionalValue(data.companies.supplier.complement)],
    ['Bairro:', data.companies.supplier.neighborhood || 'N/A'],
    ['Cidade:', data.companies.supplier.city || 'N/A'],
    ['Estado:', data.companies.supplier.state || 'N/A'],
    ['CEP:', data.companies.supplier.zipCode || 'N/A'],
    ['Contato:', formatOptionalValue(data.companies.supplier.contactName)],
    ['Telefone:', formatOptionalValue(data.companies.supplier.phone)],
    ['Email:', formatOptionalValue(data.companies.supplier.email)],
    [''],
    ['CLIENTE'],
    ['Nome:', data.companies.customer.name || 'N/A'],
    ['CNPJ:', data.companies.customer.cnpj || 'N/A'],
    ['Inscrição Estadual:', formatOptionalValue(data.companies.customer.stateRegistration)],
    ['Endereço:', data.companies.customer.address || 'N/A'],
    ['Número:', data.companies.customer.number || 'N/A'],
    ['Complemento:', formatOptionalValue(data.companies.customer.complement)],
    ['Bairro:', data.companies.customer.neighborhood || 'N/A'],
    ['Cidade:', data.companies.customer.city || 'N/A'],
    ['Estado:', data.companies.customer.state || 'N/A'],
    ['CEP:', data.companies.customer.zipCode || 'N/A'],
    ['Contato:', formatOptionalValue(data.companies.customer.contactName)],
    ['Telefone:', formatOptionalValue(data.companies.customer.phone)],
    ['Email:', formatOptionalValue(data.companies.customer.email)],
    ['Contribuinte:', data.companies.customer.isTaxpayer ? 'Sim' : 'Não'],
    ['Ordem de Compra:', formatOptionalValue(data.companies.customer.purchaseOrder)],
    [''],
    ['INTERATELL'],
    ['Nome:', data.companies.interatell.name || 'N/A'],
    ['CNPJ:', data.companies.interatell.cnpj || 'N/A'],
    ['Inscrição Estadual:', formatOptionalValue(data.companies.interatell.stateRegistration)],
    ['Endereço:', data.companies.interatell.address || 'N/A'],
    ['Número:', data.companies.interatell.number || 'N/A'],
    ['Complemento:', formatOptionalValue(data.companies.interatell.complement)],
    ['Bairro:', data.companies.interatell.neighborhood || 'N/A'],
    ['Cidade:', data.companies.interatell.city || 'N/A'],
    ['Estado:', data.companies.interatell.state || 'N/A'],
    ['CEP:', data.companies.interatell.zipCode || 'N/A'],
    ['Contato:', formatOptionalValue(data.companies.interatell.contactName)],
    ['Telefone:', formatOptionalValue(data.companies.interatell.phone)],
    ['Email:', formatOptionalValue(data.companies.interatell.email)]
  ]

  const companiesWs = XLSX.utils.aoa_to_sheet(companiesData)
  XLSX.utils.book_append_sheet(wb, companiesWs, 'Empresas')

  // Aba 3: Produtos
  const productsHeader = [
    'Part Number',
    'Descrição',
    'Estado',
    'Quantidade',
    'Custo Unitário',
    'Custo Total',
    'Venda Unitária',
    'Venda Total',
    'CFOP',
    'Natureza',
    'Família',
    'NCM'
  ]

  const productsData = [
    productsHeader,
    ...(data.products || []).map(product => [
      product.partnumber || 'N/A',
      product.description || 'N/A',
      product.state || 'N/A',
      product.quantity || 0,
      product.unitCost || 0,
      product.totalCost || 0,
      product.unitSale || 0,
      product.totalSale || 0,
      formatOptionalValue(product.cfop),
      formatOptionalValue(product.nature),
      formatOptionalValue(product.family),
      formatOptionalValue(product.ncm)
    ])
  ]

  const productsWs = XLSX.utils.aoa_to_sheet(productsData)
  XLSX.utils.book_append_sheet(wb, productsWs, 'Produtos')

  // Download do Excel com nome melhorado
  const businessName = data.business.name?.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '-') || 'transacao'
  const dateStr = new Date().toISOString().split('T')[0]
  const fileName = `relatorio-${businessName}-${dateStr}.xlsx`
  
  XLSX.writeFile(wb, fileName)
}
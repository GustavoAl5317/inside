"use server"

import { createTransaction } from "./db"
import { sql } from "./db"
import { validateCNPJ, formatZipCode, formatPhoneNumber, normalizeCNPJDigits } from "./utils"
import { BitrixService } from "./bitrix-service"
import { ProcessHistoryService } from "./process-history-service"
import { unifiedLogService } from "./unified-log-service"
import { getSessionUser } from "./auth-actions"

// Mapeia uma linha da tabela deals para o formato ProcessHistoryEntry usado pela UI
function dealToProcessEntry(deal: any) {
  const payload = typeof deal.payload === 'string' ? JSON.parse(deal.payload) : (deal.payload ?? {})
  return {
    id:                   deal.id,
    transaction_id:       deal.id,
    bitrix_deal_id:       deal.bitrix_deal_id ?? null,
    status:               deal.status,
    current_stage_id:     deal.current_stage_id ?? null,
    current_stage_name:   deal.current_stage_name ?? null,
    omie_response:        deal.omie_response ?? null,
    error_message:        deal.error_message ?? null,
    created_at:           deal.created_at,
    updated_at:           deal.updated_at,
    business_name:        payload?.business?.name ?? null,
    supplier_name:        payload?.supplierGroups?.[0]?.supplier?.name ?? null,
    customer_name:        payload?.customers?.[0]?.customer?.name ?? null,
  }
}

// ============================
// Bitrix – Dynamic Item (ETID 129)
// 1) crm.item.list (filtro por XML_ID e %TITLE no categoryId=13)
// 2) crm.item.get (item completo)
// ============================

const BITRIX_BASE_DYNAMIC = "https://interatell.bitrix24.com.br/rest/189/s00kb52tz12l8xo6"
const DYN_ENTITY_TYPE_ID = 129
const DYN_CATEGORY_ID = 13
const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" }

type BitrixListItem = {
  id: number
  title?: string
  xmlId?: string | number
  stageId?: string
  categoryId?: number
}

// --- Helpers menores
const parseXmlId = (input: string) => {
  const s = String(input || "").trim()
  if (!s) return ""
  const parts = s.split(".")
  return parts.length > 1 ? parts[1].trim() : s
}

const isClosed = (stageId?: string) =>
  !!stageId && (stageId.endsWith(":SUCCESS") || stageId.endsWith(":FAIL"))

const isOpen = (stageId?: string) => !!stageId && !isClosed(stageId)

// versão “apenas abertos” do picker
const pickBestCandidate = (items: BitrixListItem[], xmlId: string, fullCode: string) => {
  const inCat = items
    .filter(i => Number(i.categoryId) === DYN_CATEGORY_ID && isOpen(i.stageId))
    .sort((a, b) => Number(b.id) - Number(a.id))

  const hasFull = (i: BitrixListItem) => (i.title || "").includes(fullCode)
  const isXml   = (i: BitrixListItem) => String(i.xmlId ?? "") === String(xmlId)

  // 1) título com código completo (ABERTO)
  const exactTitleOpen = inCat.find(i => hasFull(i))
  if (exactTitleOpen) return exactTitleOpen

  // 2) XML_ID exato (ABERTO)
  const exactXmlOpen = inCat.find(i => isXml(i))
  if (exactXmlOpen) return exactXmlOpen

  // 3) qualquer ABERTO do funil 13
  return inCat[0] || null
}

// --- Chamadas Bitrix (compactas)
async function bitrixPost<T = any>(path: string, body: any): Promise<T> {
  const r = await fetch(`${BITRIX_BASE_DYNAMIC}${path}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
    cache: "no-store",
    next: { revalidate: 0 }
  })
  if (!r.ok) throw new Error(`Bitrix POST ${path} → HTTP ${r.status} ${r.statusText}`)
  const j = await r.json()
  if (j?.error) throw new Error(j?.error_description || j?.error)
  return j
}

async function bitrixGet<T = any>(path: string): Promise<T> {
  const r = await fetch(`${BITRIX_BASE_DYNAMIC}${path}`, {
    method: "GET",
    headers: JSON_HEADERS,
    cache: "no-store",
    next: { revalidate: 0 }
  })
  if (!r.ok) throw new Error(`Bitrix GET ${path} → HTTP ${r.status} ${r.statusText}`)
  const j = await r.json()
  if (j?.error) throw new Error(j?.error_description || j?.error)
  return j
}

async function bitrixList(filter: Record<string, any>) {
  // crm.item.list — usar POST evita problemas com colchetes e % no filtro
  const j = await bitrixPost("/crm.item.list.json", {
    entityTypeId: DYN_ENTITY_TYPE_ID,
    filter,
    select: ["id", "title", "xmlId", "stageId", "categoryId"],
    order: { id: "desc" },
    start: 0
  })
  const items = Array.isArray(j.result) ? j.result : (j.result?.items || [])
  return items as BitrixListItem[]
}

async function bitrixGetItem(id: number | string) {
  const j = await bitrixGet(`/crm.item.get.json?entityTypeId=${DYN_ENTITY_TYPE_ID}&id=${id}`)
  return j?.result?.item
}

// tenta localizar por xmlId com variações e retorna SOMENTE ABERTOS
async function listByXmlIdOpenOnly(xmlId: string) {
  const tries = [
    { categoryId: DYN_CATEGORY_ID, '=xmlId': xmlId },
    { categoryId: DYN_CATEGORY_ID, 'xmlId': xmlId },
    { categoryId: DYN_CATEGORY_ID, '=XML_ID': xmlId },
    { categoryId: DYN_CATEGORY_ID, 'XML_ID': xmlId },
  ]
  for (const filter of tries) {
    const items = await bitrixList(filter)
    const openOnly = items.filter(i => isOpen(i.stageId))
    if (openOnly.length) return openOnly
  }
  return []
}

/**
 * Resolve o ID real (via XML_ID → fallback %TITLE) e retorna o item completo do pipeline 13.
 * Aceita "AAAA.NNNN" ou "NNNN". Apenas itens ABERTOS.
 */
export async function getBitrixDynamicItemByCodeAction(codeOrXmlId: string) {
  const { logInfo, logError } = await import("@/lib/log-capture")
  try {
    const xmlId = parseXmlId(codeOrXmlId)
    if (!xmlId) return { success: false, error: "Código inválido. Use 'AAAA.NNNN' ou 'NNNN'." }

    // 1) tenta por XML_ID (somente abertos)
    let items: BitrixListItem[] = await listByXmlIdOpenOnly(xmlId)

    // 2) fallback por %TITLE (somente abertos)
    if (!items.length) {
      const t1 = await bitrixList({ categoryId: DYN_CATEGORY_ID, "%TITLE": codeOrXmlId })
      const t2 = !t1.length ? await bitrixList({ categoryId: DYN_CATEGORY_ID, "%TITLE": xmlId }) : []
      items = [...t1, ...t2].filter(i => isOpen(i.stageId))
    }

    if (!items.length) {
      return { success: false, error: "Nenhum item ABERTO encontrado no Bitrix (pipeline 13) para esse código." }
    }

    const chosen = pickBestCandidate(items, xmlId, codeOrXmlId)
    if (!chosen) {
      return { success: false, error: "Só encontrei itens FECHADOS (SUCCESS/FAIL) para esse código." }
    }

    logInfo("Bitrix chosen item (open-only)", "bitrix", {
      id: chosen.id, title: chosen.title, xmlId: chosen.xmlId, categoryId: chosen.categoryId, stageId: chosen.stageId
    })

    const full = await bitrixGetItem(chosen.id)

    // defesa: se fechou entre o list e o get
    if (!isOpen(full?.stageId)) {
      return { success: false, error: "O item foi movido para FECHADO durante a consulta." }
    }

    return { success: true, id: chosen.id, summary: chosen, item: full }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    try {
      const { logError } = await import("@/lib/log-capture")
      logError("Erro em getBitrixDynamicItemByCodeAction", "bitrix", { error: msg })
    } catch {}
    return { success: false, error: msg }
  }
}

/** Retorna somente o ID interno a partir de "AAAA.NNNN" ou "NNNN". */
export async function resolveBitrixDynamicItemIdAction(codeOrXmlId: string) {
  const r = await getBitrixDynamicItemByCodeAction(codeOrXmlId)
  return r.success ? { success: true, id: r.id } : r
}

// ============================
// Inside Sales – consultas diretas ao Bitrix (sem banco de dados)
// ============================

/**
 * Retorna todos os itens de inside sales de uma etapa do pipeline (sem DB)
 */
export async function getInsideSalesByStageAction(stageId: string) {
  try {
    const result = await BitrixService.getItemsByStage(stageId)
    return { success: true, items: result.items, total: result.total }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' }
  }
}

// ============================
// Bitrix24 — Detalhes completos do card (item + empresa cliente)
// ============================

/**
 * Busca o item completo + empresa cliente do Bitrix24 ao selecionar um card.
 * Retorna tudo necessário para pré-preencher o formulário automaticamente.
 */
export async function getInsideSalesCardDetailsAction(itemId: number) {
  try {
    const item = await BitrixService.getFullInsideSalesItem(itemId)
    if (!item) return { success: false as const, error: 'Item não encontrado no Bitrix24' }

    // Empresa cliente e responsável em paralelo
    const [clientCompany, assignedUser] = await Promise.all([
      item.companyId && Number(item.companyId) > 0
        ? BitrixService.getCRMCompanyById(Number(item.companyId))
        : Promise.resolve(null),
      item.assignedById && Number(item.assignedById) > 0
        ? BitrixService.getBitrixUser(Number(item.assignedById))
        : Promise.resolve(null),
    ])

    return { success: true as const, item, clientCompany, assignedUser }
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'Erro desconhecido' }
  }
}

// ============================
// Bitrix24 — Empresas CRM (sem banco)
// ============================

export async function searchBitrixCompaniesAction(query: string) {
  try {
    const companies = await BitrixService.searchCRMCompanies(query)
    return { success: true, companies }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' }
  }
}

export async function getBitrixCompanyCnpjAction(companyId: number) {
  try {
    const cnpj = await BitrixService.getCRMCompanyCnpj(companyId)
    return { success: true, cnpj }
  } catch (error) {
    return { success: false, cnpj: '' }
  }
}

export async function getBitrixCompanyDetailsAction(companyId: number) {
  try {
    const details = await BitrixService.getCRMCompanyFullDetails(companyId)
    return { success: true, ...details }
  } catch (error) {
    return { success: false, cnpj: '', name: '', email: '', phone: '',
      address: '', number: '', complement: '', neighborhood: '',
      city: '', state: '', zipCode: '', stateRegistration: '' }
  }
}

// ============================
// Bitrix24 — Lista de Clientes #63
// ============================

export async function getBitrixClientsAction(query = "") {
  try {
    const clients = await BitrixService.getClients()
    const q = query.trim().toLowerCase()
    const filtered = q
      ? clients.filter(c =>
          c.name.toLowerCase().includes(q) ||
          c.cnpj.includes(q) ||
          c.cidade.toLowerCase().includes(q)
        )
      : clients
    return filtered.map(c => ({
      id: c.id,
      name: c.name,
      cnpj: c.cnpj,
      stateRegistration: c.ie,
      email: c.email,
      phone: c.telefone1 || c.telefone2,
      address: c.endereco,
      number: c.numero,
      complement: c.complemento,
      neighborhood: c.bairro,
      city: c.cidade,
      state: c.estado,
      zipCode: c.cep,
      contactName: c.contato,
    }))
  } catch (error) {
    return []
  }
}

export async function createBitrixClientAction(data: {
  name: string; cnpj: string; stateRegistration?: string; email?: string;
  phone?: string; address?: string; number?: string; complement?: string;
  neighborhood?: string; city?: string; state?: string; zipCode?: string; contactName?: string;
}) {
  try {
    const id = await BitrixService.createClient({
      name: data.name,
      cnpj: data.cnpj,
      ie: data.stateRegistration || '',
      email: data.email || '',
      contato: data.contactName || '',
      telefone1: data.phone || '',
      telefone2: '',
      endereco: data.address || '',
      numero: data.number || '',
      complemento: data.complement || '',
      bairro: data.neighborhood || '',
      cidade: data.city || '',
      estado: data.state || '',
      cep: data.zipCode || '',
      enderecoCompleto: [data.address, data.number, data.neighborhood, data.city, data.state]
        .filter(Boolean).join(', '),
    })
    return { success: true, id }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' }
  }
}

// ============================
// Bitrix24 — Catálogo de Produtos (sem banco)
// ============================

export async function searchBitrixProductsAction(query: string) {
  try {
    const products = await BitrixService.searchCatalogProducts(query)

    // Enriquece com NCM, cfop, nature e family do banco local (por partnumber)
    const codes = products.map((p: any) => p.code || p.partnumber).filter(Boolean)
    if (codes.length > 0) {
      const locals = await sql`
        SELECT partnumber, ncm, cfop, nature, family
        FROM products
        WHERE partnumber = ANY(${codes})
      `
      const localMap = new Map(locals.map((r: any) => [r.partnumber, r]))
      const enriched = products.map((p: any) => {
        const code = p.code || p.partnumber
        const local = localMap.get(code) as any
        return {
          ...p,
          ncm:    p.ncm    || local?.ncm    || '',
          cfop:   p.cfop   || local?.cfop   || '',
          nature: p.nature || local?.nature || 'HW',
          family: local?.family || '',
        }
      })
      return { success: true, products: enriched }
    }

    return { success: true, products }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' }
  }
}

// ============================
// Bitrix24 — Listas (condições de pagamento, famílias, etc.) (sem banco)
// ============================

export async function getBitrixListElementsAction(listId: number | string) {
  try {
    const elements = await BitrixService.getListElements(listId)
    return { success: true, elements }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' }
  }
}

// Condições de pagamento — lista 67, campo TIPO (propriedade real no Bitrix)
export async function getBitrixPaymentConditionsAction(tipo?: string) {
  const listId = process.env.BITRIX_LIST_PAYMENT_ID
  if (!listId) return { success: false as const, error: 'BITRIX_LIST_PAYMENT_ID não configurado no .env', elements: [] }
  try {
    const elements = await BitrixService.getPaymentConditions(Number(listId), tipo)
    return { success: true as const, elements }
  } catch (error) {
    return { success: false as const, error: String(error), elements: [] }
  }
}

// Busca compra+venda em uma única chamada (2 requests ao invés de 4)
export async function getBitrixAllPaymentConditionsAction() {
  const listId = process.env.BITRIX_LIST_PAYMENT_ID
  if (!listId) return {
    success: false as const,
    error: 'BITRIX_LIST_PAYMENT_ID não configurado no .env',
    purchase: [] as any[],
    sale: [] as any[],
  }
  try {
    const all = await BitrixService.getPaymentConditions(Number(listId))
    return {
      success: true as const,
      purchase: all.filter(e => e.tipo.toLowerCase() === 'compra'),
      sale:     all.filter(e => e.tipo.toLowerCase() === 'venda'),
    }
  } catch (error) {
    return { success: false as const, error: String(error), purchase: [] as any[], sale: [] as any[] }
  }
}

export async function createPaymentConditionAction(desc: string, code: string, tipo: string) {
  const listId = Number(process.env.BITRIX_LIST_PAYMENT_ID)
  if (!listId) return { success: false as const, error: 'BITRIX_LIST_PAYMENT_ID não configurado' }
  try {
    const id = await BitrixService.addPaymentCondition(listId, desc, code, tipo)
    return { success: true as const, id }
  } catch (error) {
    return { success: false as const, error: String(error) }
  }
}

export async function updatePaymentConditionAction(id: string, desc: string, code: string, tipo: string) {
  const listId = Number(process.env.BITRIX_LIST_PAYMENT_ID)
  if (!listId) return { success: false as const, error: 'BITRIX_LIST_PAYMENT_ID não configurado' }
  try {
    await BitrixService.updatePaymentCondition(listId, id, desc, code, tipo)
    return { success: true as const }
  } catch (error) {
    return { success: false as const, error: String(error) }
  }
}

export async function deletePaymentConditionAction(id: string) {
  const listId = Number(process.env.BITRIX_LIST_PAYMENT_ID)
  if (!listId) return { success: false as const, error: 'BITRIX_LIST_PAYMENT_ID não configurado' }
  try {
    await BitrixService.deletePaymentCondition(listId, id)
    return { success: true as const }
  } catch (error) {
    return { success: false as const, error: String(error) }
  }
}

// Famílias — lista configurada em BITRIX_LIST_FAMILY_ID
export async function getBitrixFamiliesAction() {
  const listId = process.env.BITRIX_LIST_FAMILY_ID
  if (!listId) return { success: false, error: 'BITRIX_LIST_FAMILY_ID não configurado no .env' }
  return getBitrixListElementsAction(listId)
}

/**
 * Retorna todas as famílias da lista #65 com omieCode e localidade.
 * Regra de negócio:
 *  - state = 'ES' → filtra por location contendo 'es' ou 'espirito'
 *  - demais UFs   → filtra por location contendo 'barueri'
 *  - sem localidade configurada → retorna tudo
 */
export async function getBitrixFamiliesFullAction(state?: string) {
  try {
    const listId = Number(process.env.BITRIX_LIST_FAMILY_ID || '65')
    const all = await BitrixService.getFamilyList(listId)

    let families = all
    if (state && all.some(f => f.location)) {
      const isES = state === 'ES'
      families = all.filter(f => {
        if (!f.location) return true
        return isES
          ? f.location.includes('es') || f.location.includes('espirito') || f.location.includes('espírito')
          : f.location.includes('barueri') || f.location.includes('sp')
      })
    }

    return { success: true as const, families }
  } catch (error) {
    return { success: false as const, families: [], error: String(error) }
  }
}

// ============================
// CNPJ via BrasilAPI (sem banco)
// ============================

export async function lookupCNPJDirectAction(cnpj: string) {
  try {
    const clean = normalizeCNPJDigits(cnpj)
    if (clean.length !== 14) return { error: 'CNPJ inválido. Deve conter 14 dígitos.' }

    const formatted = clean.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')

    try {
      const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${clean}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
      if (!resp.ok) throw new Error('BrasilAPI indisponível')
      const d = await resp.json()
      return {
        cnpj: formatted,
        name: d.nome || d.razao_social || '',
        stateRegistration: '',
        zipCode: (d.cep || '').replace(/\D/g, '').replace(/^(\d{5})(\d{3})$/, '$1-$2'),
        city: d.municipio || '',
        state: d.uf || '',
        neighborhood: d.bairro || '',
        address: d.logradouro || '',
        number: d.numero || 'S/N',
        complement: d.complemento || '',
        contactName: '',
        phone: d.telefone || '',
        email: d.email || '',
        source: 'api' as const,
      }
    } catch {
      return {
        cnpj: formatted, name: '', stateRegistration: '', zipCode: '', city: '',
        state: '', neighborhood: '', address: '', number: '', complement: '',
        contactName: '', phone: '', email: '',
        message: 'CNPJ válido. Preencha os dados manualmente.',
        source: 'manual' as const,
      }
    }
  } catch (error) {
    return { error: 'Erro ao processar CNPJ.' }
  }
}

// ============================
// Funções originais (mantidas)
// ============================

// Função para buscar produtos por termo de pesquisa
export async function searchProductsAction(query: string) {
  try {
    const products = await sql`
      SELECT id, partnumber, description, cfop, nature, ncm
      FROM products
      WHERE partnumber ILIKE ${"%" + query + "%"} OR description ILIKE ${"%" + query + "%"}
      LIMIT 10
    `
    return products
  } catch {
    return []
  }
}

// Função para obter um produto pelo ID
export async function getProductByIdAction(id: number) {
  try {
    const [product] = await sql`
      SELECT id, partnumber, description, cfop, nature, ncm
      FROM products
      WHERE id = ${id}
    `
    return product
  } catch {
    return null
  }
}

export async function createTransactionAction(data: any) {
  const { logInfo, logError } = await import("@/lib/log-capture")
  try {
    logInfo(`Iniciando criação de transação`, "transaction", {
      transactionData: {
        businessType: data.business?.type,
        supplierCnpj: data.companies?.supplier?.cnpj,
        customerCnpj: data.companies?.customer?.cnpj,
        productsCount: data.products?.length || 0
      }
    })
    const result = await createTransaction(data)
    if (result.success) {
      logInfo(`Transação criada com sucesso - ID: ${result.transactionId}`, "transaction", {
        transactionId: result.transactionId, success: true
      })
    }
    return result
  } catch (error) {
    logError(`Erro ao criar transação: ${error instanceof Error ? error.message : "Erro desconhecido"}`, "transaction", {
      error: error instanceof Error ? error.message : "Erro desconhecido",
      stack: error instanceof Error ? error.stack : undefined
    })
    throw error
  }
}

// Empresas
export async function getCompaniesAction(query = "") {
  try {
    const q = "%" + query + "%"
    return query
      ? await sql`SELECT * FROM companies WHERE name ILIKE ${q} OR cnpj ILIKE ${q} ORDER BY name`
      : await sql`SELECT * FROM companies ORDER BY name`
  } catch {
    return []
  }
}

// Busca apenas fornecedores cadastrados (company_type = 'supplier')
export async function getSuppliersAction(query = "") {
  try {
    const q = "%" + query + "%"
    return query
      ? await sql`
          SELECT * FROM companies
          WHERE company_type = 'supplier'
            AND (name ILIKE ${q} OR cnpj ILIKE ${q})
          ORDER BY name
        `
      : await sql`
          SELECT * FROM companies
          WHERE company_type = 'supplier'
          ORDER BY name
        `
  } catch {
    return []
  }
}

// Busca fornecedores da lista Bitrix24 #61 (Gestão de Fornecedores)
export async function getBitrixSuppliersAction(query = "") {
  try {
    const suppliers = await BitrixService.getSuppliers()
    const mapped = suppliers.map(s => ({
      id:                s.id,
      name:              s.name,
      cnpj:              s.cnpj,
      stateRegistration: s.ie,
      zipCode:           s.cep,
      city:              s.cidade,
      state:             s.estado,
      neighborhood:      s.bairro,
      address:           s.endereco,
      number:            s.numero,
      complement:        s.complemento,
      contactName:       s.contato,
      phone:             s.telefone1,
      email:             s.email,
    }))
    if (!query) return mapped
    const q = query.toLowerCase()
    return mapped.filter(s => s.name.toLowerCase().includes(q) || s.cnpj.toLowerCase().includes(q))
  } catch {
    return []
  }
}

export async function getCompanyByIdAction(id: number) {
  try {
    const [company] = await sql`SELECT * FROM companies WHERE id = ${id}`
    return company
  } catch {
    return null
  }
}

export async function createCompanyAction(data: any) {
  try {
    const existing = await sql`SELECT id FROM companies WHERE cnpj = ${data.cnpj}`
    if (existing.length) return { error: "Já existe uma empresa cadastrada com este CNPJ" }

    const state = data.state?.substring(0, 2) ?? null
    const zipCode = data.zipCode?.substring(0, 20) ?? null
    const number = data.number?.substring(0, 20) ?? null
    const phone = data.phone?.substring(0, 20) ?? null
    const companyType = data.companyType?.substring(0, 20) ?? null

    const [company] = await sql`
      INSERT INTO companies (
        cnpj, name, state_registration, zip_code, city, state, neighborhood,
        address, number, complement, contact_name, phone, email, company_type,
        is_taxpayer
      ) VALUES (
        ${data.cnpj}, ${data.name}, ${data.stateRegistration || null}, ${zipCode},
        ${data.city || null}, ${state}, ${data.neighborhood || null}, ${data.address || null},
        ${number}, ${data.complement || null}, ${data.contactName || null},
        ${phone}, ${data.email || null}, ${companyType},
        ${data.companyType === "customer" ? data.isTaxpayer || false : null}
      ) RETURNING id
    `
    return { success: true, id: company.id }
  } catch (error) {
    return { error: "Falha ao criar empresa: " + (error instanceof Error ? error.message : "Erro desconhecido") }
  }
}

export async function updateCompanyAction(data: any) {
  try {
    const state = data.state?.substring(0, 2) ?? null
    const zipCode = data.zipCode?.substring(0, 20) ?? null
    const number = data.number?.substring(0, 20) ?? null
    const phone = data.phone?.substring(0, 20) ?? null
    const companyType = data.companyType?.substring(0, 20) ?? null

    await sql`
      UPDATE companies
      SET 
        cnpj = ${data.cnpj}, name = ${data.name}, state_registration = ${data.stateRegistration || null},
        zip_code = ${zipCode}, city = ${data.city || null}, state = ${state},
        neighborhood = ${data.neighborhood || null}, address = ${data.address || null},
        number = ${number}, complement = ${data.complement || null}, contact_name = ${data.contactName || null},
        phone = ${phone}, email = ${data.email || null}, company_type = ${companyType},
        is_taxpayer = ${data.companyType === "customer" ? data.isTaxpayer || false : null},
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${data.id}
    `
    return { success: true }
  } catch (error) {
    return { error: "Falha ao atualizar empresa: " + (error instanceof Error ? error.message : "Erro desconhecido") }
  }
}

export async function deleteCompanyAction(id: number, forceDelete = false) {
  try {
    const transactions = await sql`
      SELECT id, status FROM transactions
      WHERE supplier_id = ${id} OR customer_id = ${id} OR interatell_id = ${id}
    `
    if (transactions.length && !forceDelete) {
      const statusCount = transactions.reduce((acc: any, t: any) => (acc[t.status] = (acc[t.status] || 0) + 1, acc), {})
      const statusSummary = Object.entries(statusCount).map(([s, c]) => `${c} ${s}`).join(", ")
      return {
        error: "Esta empresa não pode ser excluída pois está sendo usada em transações",
        details: { transactionCount: transactions.length, statusSummary, canForceDelete: true }
      }
    }

    if (forceDelete && transactions.length) {
      await sql`
        UPDATE transactions
        SET
          supplier_id = CASE WHEN supplier_id = ${id} THEN NULL ELSE supplier_id END,
          customer_id = CASE WHEN customer_id = ${id} THEN NULL ELSE customer_id END,
          interatell_id = CASE WHEN interatell_id = ${id} THEN NULL ELSE interatell_id END,
          updated_at = CURRENT_TIMESTAMP
        WHERE supplier_id = ${id} OR customer_id = ${id} OR interatell_id = ${id}
      `
    }

    await sql`DELETE FROM companies WHERE id = ${id}`
    return {
      success: true,
      message: forceDelete && transactions.length
        ? `Empresa excluída e ${transactions.length} transações foram atualizadas`
        : "Empresa excluída com sucesso"
    }
  } catch (error) {
    return { error: "Falha ao excluir empresa: " + (error instanceof Error ? error.message : "Erro desconhecido") }
  }
}

// CNPJ (BrasilAPI)
export async function lookupCNPJAction(cnpj: string) {
  try {
    const clean = normalizeCNPJDigits(cnpj)
    if (clean.length !== 14) return { error: "CNPJ inválido. Deve conter 14 dígitos." }
    if (!validateCNPJ(clean)) return { error: "CNPJ inválido. Dígitos verificadores não conferem." }

    const formatted = clean.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")

    const existing = await sql`SELECT * FROM companies WHERE cnpj = ${clean} OR cnpj = ${formatted} LIMIT 1`
    if (existing.length) {
      const c = existing[0]
      return {
        cnpj: c.cnpj, name: c.name, stateRegistration: c.state_registration || "",
        zipCode: c.zip_code || "", city: c.city || "", state: c.state || "",
        neighborhood: c.neighborhood || "", address: c.address || "",
        number: c.number || "", complement: c.complement || "",
        contactName: c.contact_name || "", phone: c.phone || "", email: c.email || "",
        message: "Dados obtidos do cadastro local. CNPJ encontrado no banco de dados.", source: "database"
      }
    }

    try {
      const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${clean}`, {
        method: "GET", headers: { Accept: "application/json", "Content-Type": "application/json" },
        cache: "no-store", next: { revalidate: 0 }
      })
      if (!resp.ok) throw new Error(`Erro ao consultar CNPJ: ${resp.status} ${resp.statusText}`)
      const d = await resp.json()
      return {
        cnpj: d.cnpj, name: d.nome || d.razao_social, stateRegistration: d.inscricao_estadual || "",
        zipCode: formatZipCode(d.cep || ""), city: d.municipio || "", state: d.uf || "",
        neighborhood: d.bairro || "", address: d.logradouro || "", number: d.numero || "S/N",
        complement: d.complemento || "", contactName: "", phone: formatPhoneNumber(d.telefone || ""),
        email: d.email || "", message: "Dados obtidos da API BrasilAPI", source: "api" as const
      }
    } catch (e) {
      return {
        cnpj: formatted, name: "", stateRegistration: "", zipCode: "", city: "", state: "",
        neighborhood: "", address: "", number: "", complement: "", contactName: "", phone: "", email: "",
        message: "CNPJ validado com sucesso! A consulta online não está disponível no momento. Preencha manualmente.",
        source: "manual"
      }
    }
  } catch (error) {
    return { error: "Erro ao processar CNPJ. Por favor, tente novamente.", cnpj }
  }
}

// Sintegra (simulado)
export async function lookupSintegraAction(cnpj: string, state: string) {
  try {
    const clean = normalizeCNPJDigits(cnpj)
    if (clean.length !== 14) return { error: "CNPJ inválido. Deve conter 14 dígitos." }
    if (!validateCNPJ(clean)) return { error: "CNPJ inválido. Dígitos verificadores não conferem." }

    const formatted = clean.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
    const existing = await sql`SELECT * FROM companies WHERE cnpj = ${clean} OR cnpj = ${formatted} LIMIT 1`
    if (existing.length) {
      const c = existing[0]
      return {
        cnpj: c.cnpj, name: c.name, stateRegistration: c.state_registration || "",
        zipCode: c.zip_code || "", city: c.city || "", state: c.state || "",
        neighborhood: c.neighborhood || "", address: c.address || "", number: c.number || "",
        complement: c.complement || "", contactName: c.contact_name || "", phone: c.phone || "", email: c.email || "",
        situacao: "ATIVA", regime: "NORMAL", dataInicioAtividade: "01/01/2020",
        message: "Dados obtidos do cadastro local. CNPJ encontrado no banco de dados.", source: "database"
      }
    }

    return {
      cnpj: formatted, name: "", stateRegistration: "", zipCode: "", city: "", state,
      neighborhood: "", address: "", number: "", complement: "", contactName: "", phone: "", email: "",
      situacao: "Não disponível", regime: "Não disponível", dataInicioAtividade: "",
      message: "CNPJ validado! Consulta Sintegra indisponível. Preencha manualmente.", source: "manual"
    }
  } catch (error) {
    return { error: "Falha ao consultar Sintegra. Preencha os dados manualmente.", cnpj, state }
  }
}

// Buscar empresa por CNPJ (apenas banco)
export async function getCompanyByCNPJAction(cnpj: string) {
  try {
    const clean = normalizeCNPJDigits(cnpj)
    if (clean.length !== 14) return { error: "CNPJ inválido. Deve conter 14 dígitos." }
    if (!validateCNPJ(clean)) return { error: "CNPJ inválido. Dígitos verificadores não conferem." }

    const formatted = clean.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
    const existing = await sql`SELECT * FROM companies WHERE cnpj = ${clean} OR cnpj = ${formatted} LIMIT 1`
    if (existing.length) {
      const c = existing[0]
      return {
        cnpj: c.cnpj, name: c.name, stateRegistration: c.state_registration || "",
        zipCode: c.zip_code || "", city: c.city || "", state: c.state || "",
        neighborhood: c.neighborhood || "", address: c.address || "", number: c.number || "",
        complement: c.complement || "", contactName: c.contact_name || "", phone: c.phone || "", email: c.email || "",
        message: "Dados obtidos do cadastro local. CNPJ encontrado no banco de dados.", source: "database"
      }
    }
    return { error: "CNPJ não encontrado no banco de dados. Cadastre a empresa primeiro.", cnpj: formatted }
  } catch {
    return { error: "Erro ao buscar empresa. Por favor, tente novamente.", cnpj }
  }
}

// Deals padrão (não entidade dinâmica)
export async function getBitrixDealAction(id: string) {
  if (!id) return null
  try {
    const baseUrl = "https://interatell.bitrix24.com.br/rest/189/06s8ccs4p008cy4v"
    const response = await fetch(`${baseUrl}/crm.deal.get?id=${id}`, {
      method: "GET", headers: JSON_HEADERS, cache: "no-store"
    })
    if (!response.ok) {
      const err = `${response.status} ${response.statusText}`
      try {
        const e = await response.json()
        if (e?.error_description) return { error: `Erro de autenticação na API do Bitrix24. ${e.error_description}` }
      } catch {}
      return { error: `Erro na API do Bitrix24: ${err}.` }
    }
    const data = await response.json()
    if (data.error) return { error: `Erro do Bitrix24: ${data.error_description || data.error}` }
    return data.result
  } catch {
    return { error: "Falha ao consultar a API do Bitrix24. Verifique sua conexão com a internet." }
  }
}

// Produtos
export async function getProductsAction(query = "") {
  try {
    const q = "%" + query + "%"
    return query
      ? await sql`
          SELECT id, partnumber, description, cfop, nature, family, ncm
          FROM products
          WHERE partnumber ILIKE ${q} OR description ILIKE ${q}
          ORDER BY partnumber`
      : await sql`
          SELECT id, partnumber, description, cfop, nature, family, ncm
          FROM products
          ORDER BY partnumber`
  } catch {
    return []
  }
}

export async function createProductAction(data: any) {
  try {
    const existing = await sql`SELECT id FROM products WHERE partnumber = ${data.partnumber}`
    if (existing.length) return { error: "Já existe um produto cadastrado com este partnumber" }
    const { type, ...p } = data
    const [product] = await sql`
      INSERT INTO products (partnumber, description, cfop, nature, family, ncm)
      VALUES (${p.partnumber}, ${p.description}, ${p.cfop || null}, ${p.nature || null}, ${p.family || null}, ${p.ncm || null})
      RETURNING id
    `
    return { success: true, id: product.id }
  } catch (error) {
    return { error: "Falha ao criar produto: " + (error instanceof Error ? error.message : "Erro desconhecido") }
  }
}

export async function updateProductAction(data: any) {
  try {
    const { type, ...p } = data
    await sql`
      UPDATE products
      SET partnumber = ${p.partnumber}, description = ${p.description},
          cfop = ${p.cfop || null}, nature = ${p.nature || null},
          family = ${p.family || null}, ncm = ${p.ncm || null},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${p.id}
    `
    return { success: true }
  } catch (error) {
    return { error: "Falha ao atualizar produto: " + (error instanceof Error ? error.message : "Erro desconhecido") }
  }
}

export async function deleteProductAction(id: number, forceDelete = false) {
  try {
    const items = await sql`
      SELECT ti.id, t.status
      FROM transaction_items ti
      JOIN transactions t ON ti.transaction_id = t.id
      WHERE ti.product_id = ${id}
    `
    if (items.length && !forceDelete) {
      const statusCount = items.reduce((a: any, x: any) => (a[x.status] = (a[x.status] || 0) + 1, a), {})
      const statusSummary = Object.entries(statusCount).map(([s, c]) => `${c} em transações ${s}`).join(", ")
      return { error: "Este produto não pode ser excluído pois está sendo usado em transações",
        details: { transactionItemCount: items.length, statusSummary, canForceDelete: true } }
    }

    if (forceDelete && items.length) {
      await sql`DELETE FROM transaction_items WHERE product_id = ${id}`
    }

    await sql`DELETE FROM products WHERE id = ${id}`
    return {
      success: true,
      message: forceDelete && items.length
        ? `Produto excluído e ${items.length} itens de transação foram removidos`
        : "Produto excluído com sucesso"
    }
  } catch (error) {
    return { error: "Falha ao excluir produto: " + (error instanceof Error ? error.message : "Erro desconhecido") }
  }
}

// Famílias
export async function getFamiliesAction(state?: string) {
  try {
    return state
      ? await sql`SELECT id, name, state, omie_code FROM families WHERE state = ${state} ORDER BY name`
      : await sql`SELECT id, name, state, omie_code FROM families ORDER BY state, name`
  } catch {
    return []
  }
}

export async function createFamilyAction(data: { name: string; state: string; omie_code?: string }) {
  try {
    const existing = await sql`SELECT id FROM families WHERE name = ${data.name} AND state = ${data.state}`
    if (existing.length) return { error: "Já existe uma família com este nome para este estado" }
    const [family] = await sql`
      INSERT INTO families (name, state, omie_code)
      VALUES (${data.name}, ${data.state}, ${data.omie_code || null})
      RETURNING id`
    return { success: true, id: family.id }
  } catch (error) {
    return { error: "Falha ao criar família: " + (error instanceof Error ? error.message : "Erro desconhecido") }
  }
}

export async function updateFamilyAction(data: { id: number; name: string; state: string; omie_code?: string }) {
  try {
    const existing = await sql`
      SELECT id FROM families WHERE name = ${data.name} AND state = ${data.state} AND id != ${data.id}`
    if (existing.length) return { error: "Já existe outra família com este nome para este estado" }
    await sql`
      UPDATE families
      SET name = ${data.name}, state = ${data.state}, omie_code = ${data.omie_code || null},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${data.id}
    `
    return { success: true }
  } catch (error) {
    return { error: "Falha ao atualizar família: " + (error instanceof Error ? error.message : "Erro desconhecido") }
  }
}

const SEED_FAMILIES = [
  { name: 'Aruba - Hardware',      omie_code: '2081927710', state: 'SP' },
  { name: 'Aruba - Licença',       omie_code: '2081927725', state: 'SP' },
  { name: 'Aruba - Software',      omie_code: '2081927797', state: 'SP' },
  { name: 'Checkpoint - Hardware', omie_code: '2081928362', state: 'SP' },
  { name: 'Checkpoint - Licença',  omie_code: '2081928392', state: 'SP' },
  { name: 'Checkpoint - Software', omie_code: '2081928423', state: 'SP' },
  { name: 'Cisco - Hardware',      omie_code: '2081928474', state: 'SP' },
  { name: 'Cisco - Licença',       omie_code: '2081928489', state: 'SP' },
  { name: 'Cisco - Software',      omie_code: '2081928499', state: 'SP' },
  { name: 'Fortinet - Hardware',   omie_code: '2081928508', state: 'SP' },
  { name: 'Fortinet - Licença',    omie_code: '2081928516', state: 'SP' },
  { name: 'Fortinet - Software',   omie_code: '2081928547', state: 'SP' },
  { name: 'Furukawa - Hardware',   omie_code: '2101313207', state: 'SP' },
  { name: 'Furukawa - Licença',    omie_code: '2101313397', state: 'SP' },
  { name: 'Furukawa - Software',   omie_code: '2101314357', state: 'SP' },
  { name: 'HP - Hardware',         omie_code: '2081928554', state: 'SP' },
  { name: 'HP - Licença',          omie_code: '2081928561', state: 'SP' },
  { name: 'HP - Software',         omie_code: '2081928580', state: 'SP' },
  { name: 'HPE - Hardware',        omie_code: '2163576450', state: 'SP' },
  { name: 'HPE - Licença',         omie_code: '2163576529', state: 'SP' },
  { name: 'HPE - Software',        omie_code: '2163576959', state: 'SP' },
  { name: 'Intelbras - Hardware',  omie_code: '2101375261', state: 'SP' },
  { name: 'Intelbras - Licença',   omie_code: '2101375369', state: 'SP' },
  { name: 'Intelbras - Software',  omie_code: '2101375342', state: 'SP' },
  { name: 'Logitech - Hardware',   omie_code: '2081928583', state: 'SP' },
  { name: 'Logitech - Licença',    omie_code: '2081928600', state: 'SP' },
  { name: 'Logitech - Software',   omie_code: '2081928624', state: 'SP' },
  { name: 'Microsoft - Hardware',  omie_code: '2081928639', state: 'SP' },
  { name: 'Microsoft - Licença',   omie_code: '2081928677', state: 'SP' },
  { name: 'Microsoft - Software',  omie_code: '2081928701', state: 'SP' },
  { name: 'Outros - Fami',         omie_code: '2164790403', state: 'SP' },
  { name: 'Palo Alto - Hardware',  omie_code: '2081928719', state: 'SP' },
  { name: 'Palo Alto - Licença',   omie_code: '2081928724', state: 'SP' },
  { name: 'Palo Alto - Software',  omie_code: '2081928739', state: 'SP' },
  { name: 'Poly - Hardware',       omie_code: '2081928825', state: 'SP' },
  { name: 'Poly - Serviços',       omie_code: '2081928836', state: 'SP' },
  { name: 'Poly - Software',       omie_code: '2081928847', state: 'SP' },
  { name: 'Vmware - Software',     omie_code: '2093070670', state: 'SP' },
  { name: 'Yealink - Hardware',    omie_code: '2101377412', state: 'SP' },
  { name: 'Yealink - Licença',     omie_code: '2101377485', state: 'SP' },
  { name: 'Yealink - Software',    omie_code: '2101377471', state: 'SP' },
  { name: 'Aruba - Hardware',      omie_code: '5193041599', state: 'ES' },
  { name: 'Checkpoint - Hardware', omie_code: '5193055171', state: 'ES' },
  { name: 'Cisco - Hardware',      omie_code: '5193055403', state: 'ES' },
  { name: 'Fortinet - Hardware',   omie_code: '5193055497', state: 'ES' },
  { name: 'Furukawa - Hardware',   omie_code: '5226919005', state: 'ES' },
  { name: 'HP - Hardware',         omie_code: '5193056281', state: 'ES' },
  { name: 'HPE - Hardware',        omie_code: '5409033867', state: 'ES' },
  { name: 'Intelbras - Hardware',  omie_code: '5227063785', state: 'ES' },
  { name: 'Logitech - Hardware',   omie_code: '5193056425', state: 'ES' },
  { name: 'Microsoft - Hardware',  omie_code: '5407897042', state: 'ES' },
  { name: 'Outros - Fami',         omie_code: '5411396394', state: 'ES' },
  { name: 'Poly - Hardware',       omie_code: '5193057202', state: 'ES' },
  { name: 'Yealink - Hardware',    omie_code: '5227091521', state: 'ES' },
]

export async function seedFamiliesAction() {
  try {
    await sql`ALTER TABLE families ADD COLUMN IF NOT EXISTS omie_code VARCHAR(20)`
    let inserted = 0, updated = 0
    for (const f of SEED_FAMILIES) {
      const existing = await sql`SELECT id FROM families WHERE name = ${f.name} AND state = ${f.state}`
      if (existing.length > 0) {
        await sql`UPDATE families SET omie_code = ${f.omie_code}, updated_at = CURRENT_TIMESTAMP WHERE name = ${f.name} AND state = ${f.state}`
        updated++
      } else {
        await sql`INSERT INTO families (name, state, omie_code) VALUES (${f.name}, ${f.state}, ${f.omie_code})`
        inserted++
      }
    }
    return { success: true, inserted, updated }
  } catch (error) {
    return { error: "Falha ao importar famílias: " + (error instanceof Error ? error.message : "Erro desconhecido") }
  }
}

export async function deleteFamilyAction(id: number) {
  try {
    await sql`DELETE FROM families WHERE id = ${id}`
    return { success: true }
  } catch (error) {
    return { error: "Falha ao excluir família: " + (error instanceof Error ? error.message : "Erro desconhecido") }
  }
}

// Condições de pagamento
export async function getPaymentConditionsAction(type?: string) {
  try {
    return type
      ? await sql`SELECT * FROM payment_conditions WHERE type = ${type} ORDER BY code`
      : await sql`SELECT * FROM payment_conditions ORDER BY type, code`
  } catch {
    return []
  }
}

// Relatórios
export async function generateReportAction(data: any, type: "pdf" | "excel" | "json") {
  try {
    if (type === "json") return { success: true, data }
    await new Promise(r => setTimeout(r, 1500))
    const mockUrl = `/api/reports/${type}?id=${Date.now()}`
    return { success: true, url: mockUrl }
  } catch (error) {
    return { error: `Falha ao gerar relatório ${type}: ${error instanceof Error ? error.message : "Erro desconhecido"}` }
  }
}

// Webhook logs por transação
export async function getWebhookLogsByTransactionAction(transactionId: number) {
  try {
    const logs = await sql`
      SELECT * FROM webhook_logs
      WHERE transaction_id = ${transactionId}
      ORDER BY created_at DESC
    `
    return { success: true, logs }
  } catch (error) {
    return { error: "Falha ao buscar logs de webhook: " + (error instanceof Error ? error.message : "Erro desconhecido") }
  }
}

// ===== Sistema de Aprovação =====
export async function checkBitrixApprovalAction(dealId: string) {
  try {
    const approvalResult = await BitrixService.isDealApproved(dealId)
    return { success: true, ...approvalResult }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Erro desconhecido" }
  }
}

export async function getBitrixDealInfoAction(dealId: string) {
  try {
    const deal = await BitrixService.getDeal(dealId)
    if (!deal) return { success: false, error: "Negócio não encontrado" }
    const stageName = await BitrixService.getStageName(deal.stageId)
    return { success: true, deal: { ...deal, stageName } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Erro desconhecido" }
  }
}

export async function getBitrixStagesAction() {
  try {
    const stages = await BitrixService.getStages()
    return { success: true, stages }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Erro desconhecido" }
  }
}

export async function createTransactionWithApprovalAction(data: any) {
  const { logInfo, logError } = await import("@/lib/log-capture")
  try {
    logInfo(`Iniciando criação de transação com verificação de aprovação`, "transaction", {
      bitrixDealId: data.bitrixDealId, businessType: data.business?.type
    })

    const trx = await createTransaction(data)
    if (!trx.success) return trx
    const transactionId = trx.transactionId

    if (data.bitrixDealId) {
      await sql`UPDATE transactions SET bitrix_deal_id = ${data.bitrixDealId} WHERE id = ${transactionId}`
    }

    let approvalResult: any = null
    let processStatus: "pending" | "approved" = "pending"

    if (data.bitrixDealId) {
      try {
        approvalResult = await BitrixService.isDealApproved(data.bitrixDealId)
        processStatus = approvalResult.approved ? "approved" : "pending"
        logInfo(`Verificação de aprovação concluída`, "transaction", {
          transactionId, bitrixDealId: data.bitrixDealId, approved: approvalResult.approved,
          currentStage: approvalResult.currentStageName
        })
      } catch (e) {
        logError(`Erro na verificação de aprovação`, "transaction", {
          transactionId, bitrixDealId: data.bitrixDealId, error: e instanceof Error ? e.message : "Erro desconhecido"
        })
      }
    }

    await ProcessHistoryService.createEntry({
      transaction_id: transactionId,
      bitrix_deal_id: data.bitrixDealId,
      status: processStatus,
      current_stage_id: approvalResult?.currentStage,
      current_stage_name: approvalResult?.currentStageName,
      approval_check_result: approvalResult
    })

    logInfo(`Transação criada com sucesso`, "transaction", {
      transactionId, processStatus, needsApproval: processStatus === "pending"
    })

    return { success: true, transactionId, processStatus, approvalResult, needsApproval: processStatus === "pending" }
  } catch (error) {
    logError(`Erro ao criar transação com aprovação`, "transaction", {
      error: error instanceof Error ? error.message : "Erro desconhecido",
      stack: error instanceof Error ? error.stack : undefined
    })
    return { success: false, error: error instanceof Error ? error.message : "Erro desconhecido" }
  }
}

export async function getCompletedProcessesAction(limit = 50) {
  try {
    const rows = await sql`
      SELECT * FROM deals
      WHERE status IN ('sent', 'failed')
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `
    const processes = rows.map(dealToProcessEntry)
    return { success: true, processes }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Erro desconhecido" }
  }
}

export async function checkPendingApprovalsAction() {
  const out = { checked: 0, approved: 0, errors: [] as string[] }
  try {
    const pendentes = await sql`
      SELECT id, bitrix_deal_id FROM deals
      WHERE status = 'pending' AND bitrix_deal_id IS NOT NULL
      ORDER BY created_at DESC
    `
    out.checked = pendentes.length
    for (const row of pendentes as Array<{ id: number; bitrix_deal_id: string }>) {
      try {
        const approval = await BitrixService.isDealApproved(row.bitrix_deal_id)
        await sql`
          UPDATE deals SET
            status = ${approval.approved ? 'approved' : 'pending'},
            current_stage_id = ${approval.currentStage || null},
            current_stage_name = ${approval.currentStageName || null},
            updated_at = NOW()
          WHERE id = ${row.id}
        `
        if (approval.approved) out.approved++
      } catch (e) {
        out.errors.push(`Deal ${row.id}: ${e instanceof Error ? e.message : 'Erro desconhecido'}`)
      }
    }
    return { success: true, ...out }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Erro desconhecido" }
  }
}

export async function getProcessHistoryAction(transactionId: number) {
  try {
    const rows = await sql`SELECT * FROM deals WHERE id = ${transactionId}`
    return { success: true, history: rows.map(dealToProcessEntry) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Erro desconhecido" }
  }
}

export async function sendApprovedProcessToOmieAction(
  dealId: number,
  options?: { update?: boolean; changes?: Array<{ label: string; before: string; after: string; kind: string }>; runId?: string },
) {
  try {
    const [deal] = await sql`SELECT id, status FROM deals WHERE id = ${dealId}`
    if (!deal) return { success: false, error: "Deal não encontrado" }
    if (deal.status !== "approved")
      return { success: false, error: "Deal não está aprovado para envio" }

    // ── Autorização por papel ─────────────────────────────────────────────────
    const sessionUser = await getSessionUser()
    if (sessionUser) {
      if (sessionUser.role === 'financeiro') {
        return { success: false, error: "O financeiro não executa envios ao Omie (apenas aprova)." }
      }
      // Atualização feita por insideSales exige aprovação vigente do financeiro
      if (options?.update && sessionUser.role === 'insidesales') {
        const [appr] = await sql`
          SELECT id FROM update_requests
          WHERE deal_id = ${dealId} AND status = 'approved' AND consumed_at IS NULL
          ORDER BY created_at DESC LIMIT 1
        `
        if (!appr) {
          return { success: false, error: "Esta atualização precisa de aprovação do financeiro." }
        }
        // Consome a aprovação (uma aprovação = uma atualização)
        await sql`UPDATE update_requests SET consumed_at = NOW() WHERE id = ${appr.id}`
      }
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
    const response = await fetch(`${baseUrl}/api/omie/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dealId,
        update: options?.update === true,
        changes: options?.changes ?? [],
        runId: options?.runId ?? null,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return { success: false, error: `Erro no webhook: ${response.status} - ${errorText}` }
    }

    const responseData = await response.json()

    // Grava números OC/OV/OS de volta no card do Bitrix (best-effort)
    try {
      const [dealRow] = await sql`SELECT payload, bitrix_deal_id FROM deals WHERE id = ${dealId}`
      const resumo = responseData?.resumo ?? responseData?.data?.resumo
      if (dealRow?.bitrix_deal_id && resumo) {
        const numbers = {
          oc: (resumo.oc ?? []).map((o: any) => o.numero).filter(Boolean),
          ov: (resumo.ov ?? []).map((o: any) => o.numero).filter(Boolean),
          os: (resumo.os ?? []).map((o: any) => o.numero).filter(Boolean),
        }
        await BitrixService.updateDealOmieNumbers(dealRow.bitrix_deal_id, numbers)
      }
    } catch { /* best-effort */ }

    return { success: true, data: responseData }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function getPendingProcessesAction() {
  try {
    const rows = await sql`
      SELECT * FROM deals
      WHERE status IN ('pending', 'approved')
      ORDER BY created_at DESC
    `
    return { success: true, processes: rows.map(dealToProcessEntry) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Erro desconhecido" }
  }
}

export async function deleteProcessAction(id: number) {
  try {
    await sql`DELETE FROM deals WHERE id = ${id}`
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' }
  }
}

// ============================
// Deal (novo modelo M×N)
// ============================

export async function createDealAction(data: {
  bitrixDealId?: string
  status?: string
  business: any
  interatell?: any
  interatellBranches?: any
  supplierGroups: any[]
  customers: any[]
  notes?: any
}) {
  try {
    const payload = {
      bitrixDealId:       data.bitrixDealId || null,
      business:           data.business,
      interatellBranches: data.interatellBranches,
      supplierGroups:     data.supplierGroups,
      customers:          data.customers,
      notes:              data.notes || {},
    }

    const status = data.status || "pending"

    console.log(`[createDeal] bitrix_deal_id="${data.bitrixDealId}" status="${status}"`)

    const [row] = await sql`
      INSERT INTO deals (bitrix_deal_id, status, payload)
      VALUES (
        ${data.bitrixDealId || null},
        ${status},
        ${JSON.stringify(payload)}
      )
      RETURNING id
    `

    console.log(`[createDeal] OK → deal #${row.id}`)
    return { success: true, dealId: row.id as number }
  } catch (error) {
    console.error("Erro ao criar deal:", error)
    return { success: false, error: error instanceof Error ? error.message : "Erro desconhecido" }
  }
}

/**
 * Salva (upsert) um rascunho de deal em status "pending".
 * - Se `existingDealId` for informado, atualiza aquele deal.
 * - Senão, tenta reaproveitar o rascunho pendente mais recente do mesmo
 *   bitrix_deal_id (evita duplicar rascunhos ao salvar o backlog várias vezes).
 * - Caso não exista, cria um novo.
 */
export async function saveDraftAction(
  data: {
    bitrixDealId?: string
    business: any
    interatell?: any
    interatellBranches?: any
    supplierGroups: any[]
    customers: any[]
    notes?: any
  },
  existingDealId?: number,
) {
  try {
    const payload = {
      bitrixDealId:       data.bitrixDealId || null,
      business:           data.business,
      interatellBranches: data.interatellBranches,
      supplierGroups:     data.supplierGroups,
      customers:          data.customers,
      notes:              data.notes || {},
    }

    let targetId: number | null = existingDealId ?? null

    if (!targetId && data.bitrixDealId) {
      const [row] = await sql`
        SELECT id FROM deals
        WHERE bitrix_deal_id = ${data.bitrixDealId} AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
      `
      if (row) targetId = row.id as number
    }

    if (targetId) {
      await sql`
        UPDATE deals
        SET payload = ${JSON.stringify(payload)}, status = 'pending', updated_at = NOW()
        WHERE id = ${targetId}
      `
      console.log(`[saveDraft] atualizado rascunho deal #${targetId}`)
      return { success: true as const, dealId: targetId }
    }

    const [ins] = await sql`
      INSERT INTO deals (bitrix_deal_id, status, payload)
      VALUES (${data.bitrixDealId || null}, ${'pending'}, ${JSON.stringify(payload)})
      RETURNING id
    `
    console.log(`[saveDraft] criado rascunho deal #${ins.id}`)
    return { success: true as const, dealId: ins.id as number }
  } catch (error) {
    console.error('Erro ao salvar rascunho:', error)
    return { success: false as const, error: error instanceof Error ? error.message : 'Erro desconhecido' }
  }
}

// ============================
// Solicitações de aprovação de ATUALIZAÇÃO
// ============================

/** Garante colunas extras usadas pelo fluxo de atualização parcial (idempotente). */
let _updateRequestsColumnsEnsured = false
async function ensureUpdateRequestColumns() {
  if (_updateRequestsColumnsEnsured) return
  try {
    await sql`ALTER TABLE update_requests ADD COLUMN IF NOT EXISTS pending_patch JSONB`
    // Aprovação da etapa "Pedido Omie" é por número de pedido, sem exigir deal vinculado.
    await sql`ALTER TABLE update_requests ALTER COLUMN deal_id DROP NOT NULL`
    await sql`ALTER TABLE update_requests ADD COLUMN IF NOT EXISTS order_kind VARCHAR(10)`
    await sql`ALTER TABLE update_requests ADD COLUMN IF NOT EXISTS order_numero VARCHAR(50)`
    await sql`ALTER TABLE update_requests ADD COLUMN IF NOT EXISTS order_branch VARCHAR(20)`
    _updateRequestsColumnsEnsured = true
  } catch (e) {
    console.error('[ensureUpdateRequestColumns] falha ao garantir colunas:', e)
  }
}

/** Notifica financeiro/admin no Bitrix24 sobre uma nova solicitação (best-effort). */
async function notifyFinanceirosNewRequest(requesterId: string, requesterName: string, title: string) {
  try {
    const financeiros = await sql`
      SELECT bitrix_user_id FROM app_users
      WHERE role IN ('financeiro', 'admin') AND active = true AND bitrix_user_id != ${requesterId}
    `
    const BITRIX_WEBHOOK = 'https://interatell.bitrix24.com.br/rest/189/s00kb52tz12l8xo6'
    for (const fin of financeiros) {
      await fetch(`${BITRIX_WEBHOOK}/im.notify.system.add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: fin.bitrix_user_id,
          message: `📋 Nova solicitação de atualização\n${requesterName} solicitou aprovação para: ${title}\nAcesse o app para revisar.`,
        }),
      }).catch(() => { /* best-effort */ })
    }
  } catch { /* não bloqueia o fluxo */ }
}

/**
 * insideSales solicita aprovação para atualizar um PEDIDO do Omie (por número), sem vincular deal.
 * Usado na etapa "Pedido Omie". Dedup por (número + tipo + filial).
 */
export async function requestOrderUpdateApprovalAction(
  order: { orderKind: string; numero: string; branch: 'barueri' | 'es'; dealId?: number },
  reason?: string,
  pendingPatch?: unknown,
) {
  try {
    const user = await getSessionUser()
    if (!user || !user.active) return { success: false as const, error: "Sessão inválida. Recarregue a página." }

    await ensureUpdateRequestColumns()
    const patchJson = pendingPatch ? JSON.stringify(pendingPatch) : null
    const numero = String(order.numero)
    const kind = String(order.orderKind)
    const branch = order.branch

    const [existing] = await sql`
      SELECT id, status FROM update_requests
      WHERE order_numero = ${numero} AND order_kind = ${kind} AND order_branch = ${branch}
        AND status IN ('pending', 'approved') AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1
    `
    if (existing) {
      if (patchJson || reason) {
        await sql`
          UPDATE update_requests
          SET reason = COALESCE(${reason || null}, reason),
              pending_patch = COALESCE(${patchJson}::jsonb, pending_patch)
          WHERE id = ${existing.id}
        `
      }
      return { success: true as const, requestId: existing.id as number, status: existing.status as string, alreadyExists: true }
    }

    const [row] = await sql`
      INSERT INTO update_requests
        (deal_id, requested_by, requested_by_name, reason, status, pending_patch, order_kind, order_numero, order_branch)
      VALUES
        (${order.dealId ?? null}, ${user.bitrixUserId}, ${user.name}, ${reason || null}, ${'pending'},
         ${patchJson}::jsonb, ${kind}, ${numero}, ${branch})
      RETURNING id
    `

    await notifyFinanceirosNewRequest(user.bitrixUserId, user.name, reason || `${kind} nº ${numero}`)

    return { success: true as const, requestId: row.id as number, status: 'pending' as const }
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Erro desconhecido" }
  }
}

/** Aprovação vigente de um PEDIDO (por número), se houver. */
export async function getActiveOrderUpdateApprovalAction(order: { orderKind: string; numero: string; branch: string }) {
  try {
    await ensureUpdateRequestColumns()
    const [row] = await sql`
      SELECT id, status, reason, review_note, requested_by_name, reviewed_by_name, created_at, reviewed_at, pending_patch
      FROM update_requests
      WHERE order_numero = ${String(order.numero)} AND order_kind = ${String(order.orderKind)} AND order_branch = ${order.branch}
        AND consumed_at IS NULL AND status IN ('pending', 'approved')
      ORDER BY created_at DESC LIMIT 1
    `
    if (row && typeof row.pending_patch === 'string') {
      try { row.pending_patch = JSON.parse(row.pending_patch) } catch { /* mantém */ }
    }
    return { success: true as const, request: row ?? null }
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Erro desconhecido", request: null }
  }
}

/** Lista as solicitações de PEDIDO (por número) do usuário atual, pendentes ou aprovadas não consumidas. */
export async function getMyPendingOrderApprovalsAction() {
  try {
    const user = await getSessionUser()
    if (!user) return { success: true as const, requests: [] as any[] }
    await ensureUpdateRequestColumns()
    const rows = await sql`
      SELECT id, status, reason, pending_patch, order_kind, order_numero, order_branch, created_at, reviewed_at, reviewed_by_name
      FROM update_requests
      WHERE requested_by = ${user.bitrixUserId} AND order_numero IS NOT NULL
        AND consumed_at IS NULL AND status IN ('pending', 'approved')
      ORDER BY created_at DESC
    `
    const requests = rows.map((r: any) => {
      let patch = r.pending_patch
      if (typeof patch === 'string') { try { patch = JSON.parse(patch) } catch { patch = null } }
      return { ...r, pending_patch: patch }
    })
    return { success: true as const, requests }
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Erro desconhecido", requests: [] as any[] }
  }
}

/**
 * insideSales solicita aprovação para atualizar um deal já enviado ao Omie.
 * Cria (ou reaproveita) uma solicitação pendente para o deal.
 * `pendingPatch` guarda o rascunho da edição parcial (Pedido Omie) para retomar após a aprovação.
 */
export async function requestUpdateApprovalAction(dealId: number, reason?: string, pendingPatch?: unknown) {
  try {
    const user = await getSessionUser()
    if (!user || !user.active) return { success: false as const, error: "Sessão inválida. Recarregue a página." }

    await ensureUpdateRequestColumns()
    const patchJson = pendingPatch ? JSON.stringify(pendingPatch) : null

    const [existing] = await sql`
      SELECT id, status FROM update_requests
      WHERE deal_id = ${dealId} AND status IN ('pending', 'approved') AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1
    `
    if (existing) {
      // Atualiza o rascunho salvo com a edição mais recente (não sobrescreve com vazio).
      if (patchJson || reason) {
        await sql`
          UPDATE update_requests
          SET reason = COALESCE(${reason || null}, reason),
              pending_patch = COALESCE(${patchJson}::jsonb, pending_patch)
          WHERE id = ${existing.id}
        `
      }
      return { success: true as const, requestId: existing.id as number, status: existing.status as string, alreadyExists: true }
    }

    const [row] = await sql`
      INSERT INTO update_requests (deal_id, requested_by, requested_by_name, reason, status, pending_patch)
      VALUES (${dealId}, ${user.bitrixUserId}, ${user.name}, ${reason || null}, ${'pending'}, ${patchJson}::jsonb)
      RETURNING id
    `

    // Notifica todos os usuários com papel financeiro/admin no Bitrix24
    try {
      const financeiros = await sql`
        SELECT bitrix_user_id FROM app_users
        WHERE role IN ('financeiro', 'admin') AND active = true AND bitrix_user_id != ${user.bitrixUserId}
      `
      const BITRIX_WEBHOOK = 'https://interatell.bitrix24.com.br/rest/189/s00kb52tz12l8xo6'
      const title = reason ? reason.split('·')[0].replace('Proposta:', '').trim() : `Deal #${dealId}`
      for (const fin of financeiros) {
        await fetch(`${BITRIX_WEBHOOK}/im.notify.system.add`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: fin.bitrix_user_id,
            message: `📋 Nova solicitação de atualização\n${user.name} solicitou aprovação para: ${title}\nAcesse o app para revisar.`,
          }),
        }).catch(() => { /* notificação é best-effort */ })
      }
    } catch { /* não bloqueia o fluxo */ }

    return { success: true as const, requestId: row.id as number, status: 'pending' as const }
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Erro desconhecido" }
  }
}

/** Retorna a aprovação vigente (aprovada e não consumida) de um deal, se houver. */
export async function getActiveUpdateApprovalAction(dealId: number) {
  try {
    await ensureUpdateRequestColumns()
    const [row] = await sql`
      SELECT id, status, reason, review_note, requested_by_name, reviewed_by_name, created_at, reviewed_at, pending_patch
      FROM update_requests
      WHERE deal_id = ${dealId} AND consumed_at IS NULL AND status IN ('pending', 'approved')
      ORDER BY created_at DESC LIMIT 1
    `
    if (row && typeof row.pending_patch === 'string') {
      try { row.pending_patch = JSON.parse(row.pending_patch) } catch { /* mantém como está */ }
    }
    return { success: true as const, request: row ?? null }
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Erro desconhecido", request: null }
  }
}

/** Lista solicitações de atualização (para financeiro/admin). */
export async function listUpdateRequestsAction(status?: 'pending' | 'approved' | 'rejected') {
  try {
    const user = await getSessionUser()
    if (!user || !['financeiro', 'admin'].includes(user.role)) {
      return { success: false as const, error: "Acesso negado", requests: [] }
    }
    const rows = status
      ? await sql`
          SELECT ur.*, d.bitrix_deal_id, d.payload
          FROM update_requests ur
          LEFT JOIN deals d ON d.id = ur.deal_id
          WHERE ur.status = ${status}
          ORDER BY ur.created_at DESC`
      : await sql`
          SELECT ur.*, d.bitrix_deal_id, d.payload
          FROM update_requests ur
          LEFT JOIN deals d ON d.id = ur.deal_id
          ORDER BY ur.created_at DESC`
    const requests = rows.map((r: any) => {
      const payload = typeof r.payload === 'string' ? JSON.parse(r.payload) : (r.payload ?? {})
      let pendingPatch = r.pending_patch
      if (typeof pendingPatch === 'string') { try { pendingPatch = JSON.parse(pendingPatch) } catch { pendingPatch = null } }
      const parceiroName = pendingPatch?.parceiroName ?? null
      return {
        id: r.id,
        deal_id: r.deal_id,
        bitrix_deal_id: r.bitrix_deal_id,
        status: r.status,
        reason: r.reason,
        review_note: r.review_note,
        requested_by_name: r.requested_by_name,
        reviewed_by_name: r.reviewed_by_name,
        created_at: r.created_at,
        reviewed_at: r.reviewed_at,
        order_kind: r.order_kind ?? null,
        order_numero: r.order_numero ?? null,
        order_branch: r.order_branch ?? null,
        parceiro_name: parceiroName,
        business_name: payload?.business?.name ?? null,
        proposal: payload?.business?.commercialProposal ?? payload?.bitrixDealId ?? null,
        customer_name: payload?.customers?.[0]?.customer?.name ?? null,
      }
    })
    return { success: true as const, requests }
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Erro desconhecido", requests: [] }
  }
}

/** Financeiro/admin aprova ou recusa uma solicitação de atualização. */
export async function reviewUpdateRequestAction(requestId: number, decision: 'approved' | 'rejected', note?: string) {
  try {
    const user = await getSessionUser()
    if (!user || !['financeiro', 'admin'].includes(user.role)) {
      return { success: false as const, error: "Acesso negado: apenas financeiro/admin" }
    }
    if (!['approved', 'rejected'].includes(decision)) {
      return { success: false as const, error: "Decisão inválida" }
    }
    await sql`
      UPDATE update_requests
      SET status = ${decision}, reviewed_by = ${user.bitrixUserId}, reviewed_by_name = ${user.name},
          review_note = ${note || null}, reviewed_at = NOW()
      WHERE id = ${requestId} AND status = 'pending'
    `
    return { success: true as const }
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Erro desconhecido" }
  }
}

export async function getDealsAction(status?: string) {
  try {
    const rows = status
      ? await sql`SELECT * FROM deals WHERE status = ${status} ORDER BY created_at DESC`
      : await sql`SELECT * FROM deals ORDER BY created_at DESC`
    return { success: true, deals: rows }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Erro desconhecido" }
  }
}

export async function updateDealStatusAction(dealId: number, status: string, extra?: { omie_response?: any; error_message?: string; current_stage_id?: string; current_stage_name?: string }) {
  try {
    await sql`
      UPDATE deals
      SET
        status              = ${status},
        omie_response       = ${extra?.omie_response ? JSON.stringify(extra.omie_response) : null},
        error_message       = ${extra?.error_message || null},
        current_stage_id    = ${extra?.current_stage_id || null},
        current_stage_name  = ${extra?.current_stage_name || null},
        updated_at          = NOW()
      WHERE id = ${dealId}
    `
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Erro desconhecido" }
  }
}

export async function checkDealBitrixApprovalAction(dealId: number) {
  try {
    const [deal] = await sql`SELECT * FROM deals WHERE id = ${dealId}`
    if (!deal) return { success: false, error: "Deal não encontrado" }

    const bitrixDealId = deal.bitrix_deal_id
    if (!bitrixDealId) return { success: false, error: "Deal não tem ID Bitrix" }

    const approval = await BitrixService.isDealApproved(bitrixDealId)
    const newStatus = approval.approved ? "approved" : "pending"

    await sql`
      UPDATE deals
      SET status = ${newStatus}, current_stage_id = ${approval.currentStage || null},
          current_stage_name = ${approval.currentStageName || null}, updated_at = NOW()
      WHERE id = ${dealId}
    `

    return { success: true, ...approval, newStatus }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Erro desconhecido" }
  }
}

export async function deleteDealAction(dealId: number) {
  try {
    await sql`DELETE FROM deals WHERE id = ${dealId}`
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Erro desconhecido" }
  }
}

// Nova action para mover deal no Bitrix para aprovação financeira
export async function moveDealToFinancialApprovalAction(dealId: string) {
  try {
    const result = await BitrixService.moveDealToFinancialApproval(dealId);
    return result;
  } catch (error) {
    console.error('Erro ao mover deal para aprovação financeira:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Erro desconhecido'
    };
  }
}

export async function getDealsHistoryAction(limit = 40, offset = 0) {
  try {
    const [countRow] = await sql`SELECT COUNT(*)::int AS total FROM deals`
    const total: number = countRow?.total ?? 0

    const rows = await sql`
      SELECT id, status, bitrix_deal_id, payload, omie_response, created_at, updated_at
      FROM deals
      ORDER BY updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
    return {
      success: true as const,
      total,
      hasMore: offset + rows.length < total,
      deals: rows.map(r => {
        const payload      = typeof r.payload      === 'string' ? JSON.parse(r.payload)      : (r.payload      ?? {})
        const omieResponse = typeof r.omie_response === 'string' ? JSON.parse(r.omie_response) : (r.omie_response ?? null)
        return {
          id:           r.id as number,
          status:       r.status as string,
          bitrixDealId: r.bitrix_deal_id as string | null,
          payload,
          omieResponse,
          createdAt:    String(r.created_at),
          updatedAt:    String(r.updated_at),
          businessName: payload?.business?.name ?? null,
          proposal:     payload?.business?.commercialProposal ?? payload?.bitrixDealId ?? null,
          supplierName: payload?.supplierGroups?.[0]?.supplier?.name ?? null,
          customerName: payload?.customers?.[0]?.customer?.name ?? null,
        }
      }),
    }
  } catch (error) {
    return { success: false as const, total: 0, hasMore: false, deals: [], error: String(error) }
  }
}

export async function getDraftByBitrixDealIdAction(bitrixDealId: string) {
  try {
    console.log(`[getDraft] buscando bitrix_deal_id="${bitrixDealId}" status=pending`)
    const [deal] = await sql`
      SELECT id, status, payload FROM deals
      WHERE bitrix_deal_id = ${bitrixDealId}
        AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    `
    if (!deal) {
      console.log(`[getDraft] nenhum rascunho encontrado para "${bitrixDealId}"`)
      return { success: false as const, error: 'Nenhum rascunho encontrado' }
    }
    console.log(`[getDraft] encontrado deal #${deal.id}`)
    const payload = typeof deal.payload === 'string' ? JSON.parse(deal.payload) : deal.payload
    return { success: true as const, deal: { id: deal.id as number, payload } }
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'Erro desconhecido' }
  }
}

export async function clearTransactionLogsAction(dealId: number) {
  try {
    unifiedLogService.clearTransactionLogs(dealId)
    await sql`DELETE FROM webhook_logs WHERE transaction_id = ${dealId}`
    await sql`DELETE FROM logs WHERE transaction_id = ${dealId}`.catch(() => {})
    return { success: true as const }
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'Erro desconhecido' }
  }
}

export async function getDealPayloadAction(dealId: number) {
  try {
    const [row] = await sql`SELECT payload, status FROM deals WHERE id = ${dealId}`
    if (!row) return { success: false as const, error: 'Deal não encontrado' }
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload
    return { success: true as const, payload, status: row.status as string }
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'Erro desconhecido' }
  }
}

export async function updateDealPayloadAndStatusAction(dealId: number, status: string, payload: any) {
  try {
    await sql`
      UPDATE deals
      SET status = ${status},
          payload = ${JSON.stringify(payload)},
          updated_at = NOW()
      WHERE id = ${dealId}
    `
    return { success: true as const }
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'Erro desconhecido' }
  }
}

export async function lookupCnpjAction(cnpj: string): Promise<{
  success: boolean
  name?: string
  tradeName?: string
  address?: string
  number?: string
  complement?: string
  neighborhood?: string
  city?: string
  state?: string
  zipCode?: string
  email?: string
  phone?: string
  error?: string
}> {
  const digits = cnpj.replace(/\D/g, '')
  if (digits.length !== 14) return { success: false, error: 'CNPJ deve ter 14 dígitos' }
  try {
    console.log(`[lookupCnpj] Consultando: ${digits}`)
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, {
      cache: 'no-store',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; InsideSales/1.0)',
        'Accept': 'application/json',
      },
    })
    if (!res.ok) {
      let errBody = ''
      try { errBody = await res.text() } catch {}
      console.error(`[lookupCnpj] HTTP ${res.status} para ${digits}: ${errBody}`)
      const msg = `HTTP ${res.status} — ${errBody || 'CNPJ não encontrado'}`
      return { success: false, error: msg }
    }
    const d = await res.json()
    if (d.message) {
      console.error(`[lookupCnpj] API retornou mensagem de erro para ${digits}: ${d.message}`)
      return { success: false, error: d.message }
    }
    console.log(`[lookupCnpj] OK: ${d.razao_social}`)
    return {
      success:      true,
      name:         d.razao_social     || '',
      tradeName:    d.nome_fantasia    || '',
      address:      d.logradouro       || '',
      number:       d.numero           || '',
      complement:   d.complemento      || '',
      neighborhood: d.bairro           || '',
      city:         d.municipio        || '',
      state:        d.uf               || '',
      zipCode:      (d.cep || '').replace(/\D/g, ''),
      email:        d.email            || '',
      phone:        (d.ddd_telefone_1 ? d.ddd_telefone_1.replace(/\D/g, '') : ''),
    }
  } catch (err: any) {
    console.error(`[lookupCnpj] Exceção ao consultar ${digits}:`, err)
    return { success: false, error: err?.message || 'Erro ao consultar CNPJ' }
  }
}
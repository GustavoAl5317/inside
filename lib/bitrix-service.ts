import { formatCNPJ, normalizeCNPJDigits } from './utils'

interface BitrixDeal {
  id: string;
  stageId: string;
  title: string;
  createdTime: string;
  updatedTime: string;
}

export interface BitrixStage {
  STATUS_ID: string;
  NAME: string;
  SORT: number;
  ENTITY_ID: string;
  COLOR?: string;
  CATEGORY_ID?: number;
  SYSTEM?: string;
  SEMANTICS?: string;
}

export interface BitrixInsideSalesItem {
  id: number;
  title: string;
  xmlId?: string | number;
  stageId: string;
  categoryId?: number;
  createdTime?: string;
  updatedTime?: string;
  companyId?: number;    // ID da empresa (negócio) vinculada
  companyName?: string;  // Nome da empresa, preenchido via batch lookup
}

export interface BitrixCRMCompany {
  id: number;
  name: string;
  cnpj?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  address?: string;
  neighborhood?: string;
  number?: string;
  phone?: string;
  email?: string;
  stateRegistration?: string;
}

export interface BitrixUser {
  id: number;
  name: string;
  lastName?: string;
  fullName: string;
  email?: string;
}

export interface BitrixSupplier {
  id: string
  name: string           // DISTRIBUIDOR / FORNECEDOR
  cnpj: string           // CNPJ
  ie: string             // IE
  email: string          // EMAIL
  contato: string        // CONTATO
  telefone1: string      // TELEFONE1
  telefone2: string      // TELEFONE2
  endereco: string       // ENDERECO
  numero: string         // NUMERO
  complemento: string    // COMPLEMENTO
  bairro: string         // BAIRRO
  cidade: string         // CIDADE
  estado: string         // ESTADO
  cep: string            // CEP
  enderecoCompleto: string // ENDERECO_COMPLETO
}

export interface CardDetails {
  item: any;
  clientCompany: BitrixCRMCompany | null;
  assignedUser: BitrixUser | null;
}

interface BitrixApiResponse<T> {
  result: T;
  error?: { error: string; error_description: string };
}

const BITRIX_BASE_URL = 'https://interatell.bitrix24.com.br/rest/189/s00kb52tz12l8xo6';
const ENTITY_TYPE_ID = 129;
const PIPELINE_CATEGORY_ID = 13;
const STAGE_ENTITY_ID = `DYNAMIC_${ENTITY_TYPE_ID}_STAGE_${PIPELINE_CATEGORY_ID}`;
const APPROVAL_STAGE_ID = `DT${ENTITY_TYPE_ID}_${PIPELINE_CATEGORY_ID}:UC_3YHNVC`;
// Nova constante para a etapa "6 - Ag. Aprov. Ger. Financeiro"
const FINANCIAL_APPROVAL_STAGE_ID = `DT${ENTITY_TYPE_ID}_${PIPELINE_CATEGORY_ID}:UC_FINANCIAL`;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Accept': 'application/json' };

const isClosedStage = (s?: string) =>
  !!s && (s.endsWith(':SUCCESS') || s.endsWith(':FAIL'));

function parseStoredCNPJ(value: string): string {
  const digits = normalizeCNPJDigits(value)
  return digits.length === 14 ? formatCNPJ(digits) : value.trim()
}

/**
 * HTTP utils
 */
async function bPost<T = any>(path: string, body: any): Promise<T> {
  const r = await fetch(`${BITRIX_BASE_URL}${path}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`Bitrix POST ${path} → ${r.status} ${r.statusText}`);
  const j = await r.json();
  if (j?.error) throw new Error(j?.error_description || j?.error);
  return j as T;
}

async function bGet<T = any>(path: string): Promise<T> {
  const r = await fetch(`${BITRIX_BASE_URL}${path}`, {
    method: 'GET',
    headers: JSON_HEADERS,
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`Bitrix GET ${path} → ${r.status} ${r.statusText}`);
  const j = await r.json();
  if (j?.error) throw new Error(j?.error_description || j?.error);
  return j as T;
}

/**
 * Resolve por ID interno (seguro): 400/404 => null
 */
async function getItemByInternalIdSafe(id: string) {
  try {
    const j: any = await bGet(
      `/crm.item.get.json?entityTypeId=${ENTITY_TYPE_ID}&id=${encodeURIComponent(id)}`
    );
    return j?.result?.item ?? null;
  } catch (e) {
    if (e instanceof Error && /→ (400|404) /.test(e.message)) return null;
    throw e;
  }
}

/**
 * Resolve por xmlId (variações de filtro)
 */
async function getItemByXmlId(xmlId: string) {
  const tries = [
    { categoryId: PIPELINE_CATEGORY_ID, '=xmlId': xmlId },
    { categoryId: PIPELINE_CATEGORY_ID, 'xmlId': xmlId },
    { categoryId: PIPELINE_CATEGORY_ID, '=XML_ID': xmlId },
    { categoryId: PIPELINE_CATEGORY_ID, 'XML_ID': xmlId },
  ];
  for (const filter of tries) {
    const j: any = await bPost('/crm.item.list.json', {
      entityTypeId: ENTITY_TYPE_ID,
      filter,
      select: ['id', 'title', 'xmlId', 'stageId', 'createdTime', 'updatedTime', 'categoryId'],
      order: { id: 'desc' },
      start: 0,
    });
    const items = Array.isArray(j.result) ? j.result : (j.result?.items || []);
    if (items.length) return items[0];
  }
  return null;
}

/**
 * Normaliza entrada:
 * - "AAAA.NNNN" → xmlId = "NNNN"
 * - "NNNN"      → tenta xmlId primeiro e, se não achar, tenta ID interno
 */
function normalizeInputForLookup(raw: string) {
  const s = String(raw || '').trim();
  if (!s) return { xmlIdCandidate: '', numericId: '' };
  if (s.includes('.')) {
    const parts = s.split('.');
    const xml = parts[1]?.trim() || s;
    return { xmlIdCandidate: xml, numericId: '' };
  }
  if (/^\d+$/.test(s)) {
    return { xmlIdCandidate: s, numericId: s };
  }
  return { xmlIdCandidate: s, numericId: '' };
}

export class BitrixService {
  /**
   * Busca item dinâmico por XML_ID (preferência) ou ID interno
   */
  static async getDeal(dealId: string): Promise<BitrixDeal | null> {
    try {
      const { xmlIdCandidate, numericId } = normalizeInputForLookup(dealId);

      // 1) xmlId primeiro (evita 400 do item.get)
      let item: any = null;
      if (xmlIdCandidate) {
        item = await getItemByXmlId(xmlIdCandidate);
      }

      // 2) fallback: ID interno (seguro)
      if (!item && numericId) {
        item = await getItemByInternalIdSafe(numericId);
      }

      if (!item) return null;

      const deal: BitrixDeal = {
        id: String(item.id ?? item.ID ?? ''),
        stageId: String(item.stageId ?? item.STAGE_ID ?? item.stage_id ?? ''),
        title: String(item.title ?? item.TITLE ?? ''),
        createdTime: String(item.createdTime ?? item.DATE_CREATE ?? ''),
        updatedTime: String(item.updatedTime ?? item.DATE_MODIFY ?? ''),
      };

      if (!deal.stageId) {
        console.warn('Bitrix getDeal: stageId vazio. Item recebido:', item);
      }

      return deal;
    } catch (error) {
      console.error('Erro ao buscar negócio no Bitrix:', error);
      return null;
    }
  }

  /**
   * Atualiza a etapa de um negócio no Bitrix
   */
  static async updateDealStage(dealId: string, newStageId: string): Promise<{
    success: boolean;
    message: string;
    updatedDeal?: BitrixDeal;
  }> {
    try {
      const { xmlIdCandidate, numericId } = normalizeInputForLookup(dealId);
      
      // Primeiro, vamos buscar o deal para obter o ID interno
      const deal = await this.getDeal(dealId);
      if (!deal) {
        return {
          success: false,
          message: 'Negócio não encontrado no Bitrix24'
        };
      }

      // Usar o ID interno do deal para a atualização
      const updateData = {
        entityTypeId: ENTITY_TYPE_ID,
        id: deal.id,
        fields: {
          stageId: newStageId
        }
      };

      console.log('Atualizando deal no Bitrix:', updateData);

      const response: any = await bPost('/crm.item.update.json', updateData);
      
      if (response.result) {
        // Buscar o deal atualizado para confirmar a mudança
        const updatedDeal = await this.getDeal(dealId);
        
        return {
          success: true,
          message: `Negócio movido com sucesso para a nova etapa`,
          updatedDeal: updatedDeal || undefined
        };
      } else {
        return {
          success: false,
          message: 'Falha ao atualizar o negócio no Bitrix24'
        };
      }
    } catch (error) {
      console.error('Erro ao atualizar etapa do negócio:', error);
      return {
        success: false,
        message: `Erro ao mover negócio: ${error instanceof Error ? error.message : 'Erro desconhecido'}`
      };
    }
  }

  /**
   * Move o negócio para a etapa "6 - Ag. Aprov. Ger. Financeiro"
   */
  static async moveDealToFinancialApproval(dealId: string): Promise<{
    success: boolean;
    message: string;
    updatedDeal?: BitrixDeal;
  }> {
    // Primeiro, vamos descobrir qual é o ID correto da etapa "6 - Ag. Aprov. Ger. Financeiro"
    try {
      const stages = await this.getStages();
      const financialStage = stages.find(stage => 
        stage.NAME.includes('Ag. Aprov. Ger. Financeiro') || 
        stage.NAME.includes('6 -') ||
        stage.NAME.toLowerCase().includes('financeiro')
      );

      if (!financialStage) {
        return {
          success: false,
          message: 'Etapa "6 - Ag. Aprov. Ger. Financeiro" não encontrada no funil'
        };
      }

      console.log('Etapa financeira encontrada:', financialStage);

      return await this.updateDealStage(dealId, financialStage.STATUS_ID);
    } catch (error) {
      console.error('Erro ao mover para aprovação financeira:', error);
      return {
        success: false,
        message: `Erro ao mover para aprovação financeira: ${error instanceof Error ? error.message : 'Erro desconhecido'}`
      };
    }
  }

  /**
   * Grava nos campos UF do card Bitrix os números OC/OV/OS gerados no Omie.
   * Usa `crm.item.update` para não alterar outros campos.
   */
  static async updateDealOmieNumbers(
    dealId: string,
    numbers: { oc?: string[]; ov?: string[]; os?: string[] },
  ): Promise<{ success: boolean }> {
    try {
      const deal = await this.getDeal(dealId)
      if (!deal) return { success: false }

      const parts: string[] = []
      if (numbers.oc?.length) parts.push(`OC: ${numbers.oc.join(', ')}`)
      if (numbers.ov?.length) parts.push(`OV: ${numbers.ov.join(', ')}`)
      if (numbers.os?.length) parts.push(`OS: ${numbers.os.join(', ')}`)
      if (!parts.length) return { success: true }

      const obs = parts.join(' | ')

      await bPost('/crm.item.update.json', {
        entityTypeId: ENTITY_TYPE_ID,
        id: deal.id,
        fields: { ufCrm3OmieNumerosOrdens: obs },
      }).catch(() => null)

      return { success: true }
    } catch {
      return { success: false }
    }
  }

  /**
   * Etapas do funil
   */
  static async getStages(): Promise<BitrixStage[]> {
    try {
      const data: BitrixApiResponse<BitrixStage[]> = await bGet(
        `/crm.status.entity.items.json?ENTITY_ID=${encodeURIComponent(STAGE_ENTITY_ID)}`
      );
      return (data.result || []).slice().sort((a, b) => a.SORT - b.SORT);
    } catch (error) {
      console.error('Erro ao buscar etapas do Bitrix:', error);
      return [];
    }
  }

  /**
   * Aprovação (nunca aprova fechado)
   */
  static async isDealApproved(dealId: string): Promise<{
    approved: boolean;
    currentStage?: string;
    currentStageName?: string;
    approvalStage: string;
    message: string;
  }> {
    try {
      const deal = await this.getDeal(dealId);
      if (!deal) {
        return { approved: false, approvalStage: APPROVAL_STAGE_ID, message: 'Negócio não encontrado no Bitrix24' };
      }
      if (!deal.stageId) {
        return {
          approved: false,
          currentStage: '',
          approvalStage: APPROVAL_STAGE_ID,
          message: 'Este negócio não possui stageId na resposta do Bitrix.',
        };
      }

      // bloquear fechados
      if (isClosedStage(deal.stageId)) {
        const closedMsg = deal.stageId.endsWith(':SUCCESS') ? 'ganho' : 'perdido';
        const name = await this.getStageName(deal.stageId);
        return {
          approved: false,
          currentStage: deal.stageId,
          currentStageName: name,
          approvalStage: APPROVAL_STAGE_ID,
          message: `Negócio fechado (${closedMsg}). Etapa: ${name}.`,
        };
      }

      const stages = await this.getStages();
      if (!stages.length) {
        return {
          approved: false,
          currentStage: deal.stageId,
          approvalStage: APPROVAL_STAGE_ID,
          message: 'Não foi possível carregar as etapas do funil',
        };
      }

      const approvalStageIndex = stages.findIndex(s => s.STATUS_ID === APPROVAL_STAGE_ID);
      if (approvalStageIndex === -1) {
        return {
          approved: false,
          currentStage: deal.stageId,
          approvalStage: APPROVAL_STAGE_ID,
          message: 'Etapa de aprovação não encontrada no funil',
        };
      }

      let currentStageIndex = stages.findIndex(s => s.STATUS_ID === deal.stageId);
      if (currentStageIndex === -1) {
        const suffix = deal.stageId.includes(':') ? deal.stageId.split(':')[1] : deal.stageId;
        if (suffix) {
          currentStageIndex = stages.findIndex(
            s => s.STATUS_ID.endsWith(suffix) || s.STATUS_ID.includes(suffix)
          );
        }
      }

      if (currentStageIndex === -1) {
        return {
          approved: false,
          currentStage: deal.stageId,
          approvalStage: APPROVAL_STAGE_ID,
          message: `Etapa atual do negócio não encontrada no funil. ID: ${deal.stageId}.`,
        };
      }

      const currentStageName = stages[currentStageIndex]?.NAME || 'Etapa desconhecida';
      const approved = currentStageIndex > approvalStageIndex; // passou da aprovação

      return {
        approved,
        currentStage: deal.stageId,
        currentStageName,
        approvalStage: APPROVAL_STAGE_ID,
        message: approved
          ? `Negócio aprovado. Etapa atual: ${currentStageName}`
          : `Negócio aguardando aprovação. Etapa atual: ${currentStageName}`,
      };
    } catch (error) {
      console.error('Erro ao verificar aprovação do negócio:', error);
      return {
        approved: false,
        approvalStage: APPROVAL_STAGE_ID,
        message: `Erro ao verificar aprovação: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
      };
    }
  }

  // ─── Detalhes completos de um item de inside sales ───────────────────────────

  /**
   * Retorna o item completo via crm.item.get (todos os campos, incluindo companyId)
   */
  static async getFullInsideSalesItem(id: number): Promise<any | null> {
    try {
      const j: any = await bGet(
        `/crm.item.get.json?entityTypeId=${ENTITY_TYPE_ID}&id=${id}`
      )
      return j?.result?.item ?? null
    } catch (error) {
      console.error('Erro ao buscar detalhes do item:', error)
      return null
    }
  }

  // ─── Empresa CRM por ID ───────────────────────────────────────────────────────

  /**
   * Busca empresa do CRM por ID e extrai CNPJ automaticamente dos campos custom
   */
  static async getCRMCompanyById(id: number): Promise<{
    id: number; name: string; cnpj?: string; city?: string; state?: string;
    zipCode?: string; address?: string; neighborhood?: string; number?: string;
    phone?: string; email?: string; stateRegistration?: string;
  } | null> {
    try {
      const j: any = await bGet(`/crm.company.get.json?id=${id}`)
      const c = j?.result
      if (!c) return null

      // Detecta CNPJ em qualquer campo da resposta
      let cnpj: string | undefined
      for (const val of Object.values(c)) {
        if (typeof val === 'string') {
          const parsed = parseStoredCNPJ(val)
          if (normalizeCNPJDigits(parsed).length === 14) { cnpj = parsed; break }
        }
      }

      const phone = Array.isArray(c.PHONE) ? c.PHONE[0]?.VALUE : undefined
      const email = Array.isArray(c.EMAIL) ? c.EMAIL[0]?.VALUE : undefined

      return {
        id: Number(c.ID),
        name: String(c.TITLE || ''),
        cnpj,
        city: String(c.ADDRESS_CITY || c.CITY || '').trim() || undefined,
        state: String(c.ADDRESS_REGION || c.ADDRESS_PROVINCE || '').replace(/^.+\|/, '').trim() || undefined,
        zipCode: String(c.ADDRESS_POSTAL_CODE || '').trim() || undefined,
        address: String(c.ADDRESS || '').trim() || undefined,
        neighborhood: String(c.ADDRESS_2 || '').trim() || undefined,
        number: undefined,
        phone: phone || undefined,
        email: email || undefined,
        stateRegistration: undefined,
      }
    } catch (error) {
      console.error('Erro ao buscar empresa CRM:', error)
      return null
    }
  }

  // ─── Usuário Bitrix24 ─────────────────────────────────────────────────────────

  /**
   * Retorna os dados de um usuário pelo ID (responsável pelo item)
   */
  static async getBitrixUser(id: number): Promise<BitrixUser | null> {
    try {
      const j: any = await bPost('/user.get.json', { ID: id })
      const u = Array.isArray(j.result) ? j.result[0] : null
      if (!u) return null
      const name = String(u.NAME || '').trim()
      const lastName = String(u.LAST_NAME || '').trim()
      return {
        id: Number(u.ID),
        name,
        lastName,
        fullName: [name, lastName].filter(Boolean).join(' '),
        email: String(u.EMAIL || '').trim() || undefined,
      }
    } catch (error) {
      console.error('Erro ao buscar usuário:', error)
      return null
    }
  }

  /**
   * Busca usuários do Bitrix24 por nome/sobrenome (para o admin conceder acessos).
   */
  static async searchBitrixUsers(query: string): Promise<BitrixUser[]> {
    const q = String(query || '').trim()
    const mapUser = (u: any): BitrixUser => {
      const name = String(u.NAME || '').trim()
      const lastName = String(u.LAST_NAME || '').trim()
      return {
        id: Number(u.ID),
        name,
        lastName,
        fullName: [name, lastName].filter(Boolean).join(' ') || String(u.LOGIN || `Usuário ${u.ID}`),
        email: String(u.EMAIL || '').trim() || undefined,
      }
    }

    try {
      if (!q) {
        const j: any = await bPost('/user.get.json', { FILTER: { ACTIVE: true }, start: 0 })
        const items: any[] = Array.isArray(j.result) ? j.result : []
        return items.map(mapUser)
      }

      // Duas consultas (nome e sobrenome) + merge sem duplicar por ID.
      const [byName, byLastName] = await Promise.all([
        bPost('/user.get.json', { FILTER: { '%NAME': q, ACTIVE: true }, start: 0 }).catch(() => ({ result: [] })),
        bPost('/user.get.json', { FILTER: { '%LAST_NAME': q, ACTIVE: true }, start: 0 }).catch(() => ({ result: [] })),
      ]) as any[]

      const seen = new Set<number>()
      const out: BitrixUser[] = []
      for (const list of [byName?.result, byLastName?.result]) {
        for (const u of (Array.isArray(list) ? list : [])) {
          const id = Number(u.ID)
          if (seen.has(id)) continue
          seen.add(id)
          out.push(mapUser(u))
        }
      }
      return out
    } catch (error) {
      console.error('Erro ao buscar usuários do Bitrix:', error)
      return []
    }
  }

  // ─── CRM Empresas ────────────────────────────────────────────────────────────

  /**
   * Busca empresas do CRM Bitrix24 por nome (sem banco de dados)
   */
  static async searchCRMCompanies(query: string): Promise<Array<{
    id: number; name: string; cnpj?: string; city?: string; state?: string
  }>> {
    try {
      const j: any = await bPost('/crm.company.list.json', {
        filter: { '%TITLE': query },
        select: ['ID', 'TITLE', 'CITY', 'ADDRESS_CITY', 'ADDRESS_REGION'],
        order: { TITLE: 'ASC' },
        start: 0,
      })
      const items: any[] = Array.isArray(j.result) ? j.result : []
      return items.map(i => ({
        id: Number(i.ID),
        name: String(i.TITLE || ''),
        city: String(i.CITY || i.ADDRESS_CITY || '').trim() || undefined,
        state: String(i.ADDRESS_REGION || '').trim() || undefined,
      }))
    } catch (error) {
      console.error('Erro ao buscar empresas no CRM:', error)
      return []
    }
  }

  /** Busca o CNPJ de uma empresa do CRM via requisitos (crm.requisite) */
  static async getCRMCompanyCnpj(companyId: number): Promise<string> {
    const details = await BitrixService.getCRMCompanyFullDetails(companyId)
    return details.cnpj
  }

  /**
   * Busca todos os dados de uma empresa do CRM: nome, telefone, e-mail, CNPJ e
   * endereço completo (via crm.requisite + crm.address vinculado ao requisite).
   */
  static async getCRMCompanyFullDetails(companyId: number): Promise<{
    cnpj: string; name: string; email: string; phone: string;
    address: string; number: string; complement: string; neighborhood: string;
    city: string; state: string; zipCode: string; stateRegistration: string;
  }> {
    const empty = { cnpj: '', name: '', email: '', phone: '', address: '', number: '',
      complement: '', neighborhood: '', city: '', state: '', zipCode: '', stateRegistration: '' }
    try {
      // 1. Dados básicos da empresa (nome, telefone, e-mail, endereço do cadastro)
      const cj: any = await bGet(`/crm.company.get.json?id=${companyId}`)
      const c = cj?.result ?? {}
      const name  = String(c.TITLE || '')
      const phone = Array.isArray(c.PHONE) ? String(c.PHONE[0]?.VALUE ?? '') : ''
      const email = Array.isArray(c.EMAIL) ? String(c.EMAIL[0]?.VALUE ?? '') : ''
      // Endereço do cadastro da empresa (fallback se não tiver no requisite)
      let address      = String(c.ADDRESS              || '')
      let complement   = String(c.ADDRESS_2            || '')
      let neighborhood = ''
      let city         = String(c.ADDRESS_CITY         || '')
      let state        = String(c.ADDRESS_REGION       || '').replace(/^.+\|/, '').trim()
      let zipCode      = String(c.ADDRESS_POSTAL_CODE  || '').replace(/\D/g, '')
      let number       = ''
      let cnpj         = ''
      let stateReg     = ''

      // 2. Requisite para pegar CNPJ e ID do requisite
      const rj: any = await bPost('/crm.requisite.list.json', {
        filter: { ENTITY_TYPE_ID: 4, ENTITY_ID: companyId },
        select: ['ID', 'RQ_INN', 'RQ_KPP'],
        order: { ID: 'ASC' },
      }).catch(() => ({}))
      const requisites: any[] = Array.isArray(rj?.result) ? rj.result : []
      let requisiteId: number | null = null
      for (const r of requisites) {
        const inn = String(r.RQ_INN || '').replace(/\D/g, '')
        if (inn.length >= 12 && inn.length <= 14) {
          cnpj       = formatCNPJ(inn)
          requisiteId = Number(r.ID)
          stateReg   = String(r.RQ_KPP || '')
          break
        }
      }

      // 3. Endereço vinculado ao requisite (crm.address — mais completo que o da empresa)
      if (requisiteId) {
        const aj: any = await bPost('/crm.address.list.json', {
          filter: { ENTITY_TYPE_ID: 8, ENTITY_ID: requisiteId },
          select: ['ADDRESS_1', 'ADDRESS_2', 'CITY', 'REGION', 'POSTAL_CODE'],
        }).catch(() => ({}))
        const addrs: any[] = Array.isArray(aj?.result) ? aj.result : []
        if (addrs.length > 0) {
          const a = addrs[0]
          if (a.ADDRESS_1) address    = String(a.ADDRESS_1)
          if (a.ADDRESS_2) complement = String(a.ADDRESS_2)
          if (a.CITY)      city       = String(a.CITY)
          if (a.REGION)    state      = String(a.REGION)
          if (a.POSTAL_CODE) zipCode  = String(a.POSTAL_CODE).replace(/\D/g, '')
        }
      }

      return { cnpj, name, email, phone, address, number, complement, neighborhood, city, state, zipCode, stateRegistration: stateReg }
    } catch (err) {
      console.error('Erro ao buscar dados completos da empresa CRM:', err)
      return empty
    }
  }

  // ─── Catálogo de Produtos ─────────────────────────────────────────────────────

  /**
   * Busca produtos no catálogo do Bitrix24 por nome ou código (sem banco de dados)
   */
  static async searchCatalogProducts(query: string): Promise<Array<{
    id: number; name: string; code?: string; ncm?: string; cfop?: string; nature?: string
  }>> {
    try {
      // Tenta catalog.product.list (Bitrix24 moderno)
      const j: any = await bPost('/catalog.product.list.json', {
        filter: { '%NAME': query },
        select: ['id', 'name', 'code', 'article'],
        start: 0,
      }).catch(() => null)

      if (j?.result?.products?.length) {
        return j.result.products.map((p: any) => ({
          id: Number(p.id),
          name: String(p.name || ''),
          code: String(p.code || p.article || '').trim() || undefined,
        }))
      }

      // Fallback: crm.product.list
      const j2: any = await bPost('/crm.product.list.json', {
        filter: { '%NAME': query },
        select: ['ID', 'NAME', 'CODE'],
        start: 0,
      }).catch(() => ({ result: [] }))

      const fallbackItems: any[] = Array.isArray(j2.result) ? j2.result : []
      return fallbackItems.map((p: any) => ({
        id: Number(p.ID || p.id),
        name: String(p.NAME || p.name || ''),
        code: String(p.CODE || p.code || '').trim() || undefined,
      }))
    } catch (error) {
      console.error('Erro ao buscar produtos no catálogo:', error)
      return []
    }
  }

  // ─── Listas do Bitrix24 ───────────────────────────────────────────────────────

  /**
   * Busca elementos de uma Lista do Bitrix24 (usado para condições de pagamento, famílias, etc.)
   * O listId deve ser configurado no painel Bitrix24 > Listas.
   */
  static async getListElements(listId: number | string): Promise<Array<{
    id: string; name: string; value?: string
  }>> {
    try {
      const j: any = await bPost('/lists.element.get.json', {
        IBLOCK_TYPE_ID: 'lists',
        IBLOCK_ID: listId,
        FILTER: { ACTIVE: 'Y' },
      })
      const items: any[] = Array.isArray(j.result) ? j.result : Object.values(j.result || {})
      return items.map((el: any) => ({
        id: String(el.ID || el.id || ''),
        name: String(el.NAME || el.name || ''),
        value: String(el.CODE || el.code || el.ID || el.id || ''),
      }))
    } catch (error) {
      console.error(`Erro ao buscar elementos da lista ${listId}:`, error)
      return []
    }
  }

  // ─── Condições de Pagamento (lista #67) ──────────────────────────────────────
  // Cada elemento tem: NAME = "A28 - Para 28 Dias", propriedade TIPO = "Compra" | "Venda"

  // Cache de IDs de propriedades por listId — evita o round-trip de field discovery em toda requisição
  private static _paymentFieldCache = new Map<number, { tipoPropId: string; codePropId: string }>()

  static async getPaymentConditions(listId: number, tipoFilter?: string): Promise<Array<{
    id: string; code: string; name: string; tipo: string
  }>> {
    try {
      // ── 1. Descobre IDs dos campos SEMPRE primeiro (necessário também para o seed) ──
      let { tipoPropId = '', codePropId = '' } = BitrixService._paymentFieldCache.get(listId) ?? {}

      if (!tipoPropId) {
        try {
          const fj: any = await bPost('/lists.field.get.json', {
            IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: listId,
          })
          console.log(`[payment] lists.field.get lista ${listId}:`, JSON.stringify(fj))
          for (const [key, info] of Object.entries(fj as Record<string, any>)) {
            const m = key.match(/^PROPERTY_(\d+)$/)
            if (!m) continue
            const code = String((info as any).CODE || '').toUpperCase().trim()
            const name = String((info as any).NAME || '').toUpperCase().trim()
            if (['TIPO', 'TYPE'].includes(code) || name.includes('TIPO') || name.includes('TYPE'))
              tipoPropId = m[1]
            if (['ID', 'CODIGO', 'CÓDIGO', 'COD', 'CODE'].includes(code) || name === 'ID')
              codePropId = m[1]
          }
          BitrixService._paymentFieldCache.set(listId, { tipoPropId, codePropId })
        } catch (_) {}
      }

      // ── 2. Busca elementos sem filtro ACTIVE (evita listas com itens inativos) ──
      const j: any = await bPost('/lists.element.get.json', {
        IBLOCK_TYPE_ID: 'lists',
        IBLOCK_ID: listId,
      })

      const items: any[] = Array.isArray(j.result) ? j.result : Object.values(j.result || {})
      console.log(`[payment] lista ${listId}: ${items.length} itens, primeiro:`, JSON.stringify(items[0] ?? null))
      if (!items.length) return []

      // Extrai o valor de uma propriedade resiliente a todos os formatos do Bitrix24
      const rp = (el: any, propId: string): string => {
        const raw = el[`PROPERTY_${propId}`]
        if (!raw) return ''
        if (typeof raw === 'object' && !Array.isArray(raw)) {
          const first = Object.values(raw)[0] as any
          if (first && typeof first === 'object') {
            if (first.TEXT  !== undefined) return String(first.TEXT  ?? '')
            if (first.VALUE !== undefined) return String(first.VALUE ?? '')
          }
          return String(first ?? '')
        }
        if (Array.isArray(raw)) return String(raw[0] ?? '')
        return String(raw)
      }

      // Fallback: auto-detecta tipoPropId pelos valores "Compra"/"Venda"
      if (!tipoPropId) {
        const TIPO_VALUES = ['compra', 'venda', 'purchase', 'sale']
        for (const key of Object.keys(items[0])) {
          const m = key.match(/^PROPERTY_(\d+)$/)
          if (!m) continue
          const val = rp(items[0], m[1]).toLowerCase()
          if (TIPO_VALUES.includes(val)) { tipoPropId = m[1]; break }
        }
        BitrixService._paymentFieldCache.set(listId, { tipoPropId, codePropId })
      }

      const all = items.map(el => {
        const desc = String(el.NAME || '')
        let code = codePropId ? rp(el, codePropId).trim() : ''
        if (!code) {
          const fromName = desc.match(/^([A-Za-z0-9]{1,3})\s*-\s+/)
          if (fromName) code = fromName[1]
        }
        if (!code) {
          for (const key of Object.keys(el)) {
            const m = key.match(/^PROPERTY_(\d+)$/)
            if (!m) continue
            const val = rp(el, m[1]).trim()
            if (!val) continue
            const lower = val.toLowerCase()
            if (['compra', 'venda', 'purchase', 'sale'].includes(lower)) continue
            if (/^[A-Za-z0-9]{2,3}$/.test(val)) { code = val; break }
          }
        }
        const label = code && !desc.startsWith(code) ? `${code} - ${desc}` : desc
        return {
          id:   String(el.ID || ''),
          code,
          name: label,
          tipo: tipoPropId ? rp(el, tipoPropId) : '',
        }
      })

      return tipoFilter
        ? all.filter(e => e.tipo.toLowerCase() === tipoFilter.toLowerCase())
        : all
    } catch (error) {
      console.error(`Erro ao buscar condições da lista ${listId}:`, error)
      return []
    }
  }

  // ─── CRUD de condições de pagamento ──────────────────────────────────────────

  private static async _getPaymentFieldIds(listId: number): Promise<{ tipoPropId: string; codePropId: string }> {
    const cached = BitrixService._paymentFieldCache.get(listId)
    if (cached?.tipoPropId) return cached
    await BitrixService.getPaymentConditions(listId) // popula o cache como efeito colateral
    return BitrixService._paymentFieldCache.get(listId) ?? { tipoPropId: '', codePropId: '' }
  }

  static async addPaymentCondition(listId: number, desc: string, code: string, tipo: string): Promise<string> {
    const { tipoPropId, codePropId } = await BitrixService._getPaymentFieldIds(listId)
    const safeCode = `${tipo[0].toLowerCase()}${(code || desc).replace(/[^a-zA-Z0-9]/g, '')}${Date.now()}`

    const newId: any = await bPost('/lists.element.add.json', {
      IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: listId,
      ELEMENT_CODE: safeCode,
      fields: { NAME: desc || code },
    })

    if (newId && (tipoPropId || codePropId)) {
      const props: Record<string, any> = { NAME: desc || code }
      if (codePropId && code) props[`PROPERTY_${codePropId}`] = code
      if (tipoPropId && tipo) props[`PROPERTY_${tipoPropId}`] = tipo
      try {
        await bPost('/lists.element.update.json', {
          IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: listId,
          ELEMENT_ID: String(newId), fields: props,
        })
      } catch (_) {}
    }

    return String(newId)
  }

  static async updatePaymentCondition(listId: number, elementId: string, desc: string, code: string, tipo: string): Promise<void> {
    const { tipoPropId, codePropId } = await BitrixService._getPaymentFieldIds(listId)
    const fields: Record<string, any> = { NAME: desc || code }
    if (codePropId && code) fields[`PROPERTY_${codePropId}`] = code
    if (tipoPropId && tipo) fields[`PROPERTY_${tipoPropId}`] = tipo

    await bPost('/lists.element.update.json', {
      IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: listId,
      ELEMENT_ID: elementId, fields,
    })
  }

  static async deletePaymentCondition(listId: number, elementId: string): Promise<void> {
    await bPost('/lists.element.delete.json', {
      IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: listId,
      ELEMENT_ID: elementId,
    })
  }

  // ─── Lista de Famílias (lista #65) ───────────────────────────────────────────
  // Cada elemento tem: NAME = "Marca - Tipo - CodigoOmie", propriedade LOCAL = "Barueri" | "Espirito Santo"

  static async getFamilyList(listId: number | string): Promise<Array<{
    id: string;
    name: string;
    omieCode: string;   // codigo_familia para o Omie (número extraído do NAME)
    location: string;   // 'barueri' | 'es' — em lowercase para comparação fácil
  }>> {
    // 1) Descobre IDs das propriedades via lists.field.get
    let localPropId = ''
    try {
      const fj: any = await bPost('/lists.field.get.json', {
        IBLOCK_TYPE_ID: 'lists',
        IBLOCK_ID: listId,
      })
      for (const [key, info] of Object.entries(fj as Record<string, any>)) {
        const propMatch = key.match(/^PROPERTY_(\d+)$/)
        if (!propMatch) continue
        const code = String((info as any).CODE || '').toUpperCase().trim()
        // Aceita variações comuns do nome do campo de localidade
        if (['LOCAL', 'LOCALIDADE', 'REGIAO', 'REGIÃO', 'ESTADO', 'LOCALIZACAO'].includes(code)) {
          localPropId = propMatch[1]
        }
      }
    } catch { /* segue sem filtro de local */ }

    const select = ['ID', 'NAME']
    if (localPropId) select.push(`PROPERTY_${localPropId}`)

    // 2) Busca elementos
    const j: any = await bPost('/lists.element.get.json', {
      IBLOCK_TYPE_ID: 'lists',
      IBLOCK_ID: listId,
      FILTER: { ACTIVE: 'Y' },
      SELECT: select,
    })
    const items: any[] = Array.isArray(j.result) ? j.result : Object.values(j.result || {})

    // Helper: lê valor de uma PROPERTY_N
    const readProp = (el: any, propId: string): string => {
      const raw = el[`PROPERTY_${propId}`]
      if (!raw) return ''
      if (typeof raw === 'object' && !Array.isArray(raw)) {
        const first = Object.values(raw)[0] as any
        const val = first?.VALUE ?? first
        if (val && typeof val === 'object') return String(val.TEXT ?? val.VALUE ?? '')
        return String(val ?? '')
      }
      if (Array.isArray(raw)) return String(raw[0] ?? '')
      return String(raw)
    }

    return items.map(el => {
      const fullName = String(el.NAME || '')

      // Extrai codigo_omie: último segmento numérico do NAME ("Aruba - Hardware - 2081927710" → "2081927710")
      const parts = fullName.split(' - ')
      const lastPart = parts[parts.length - 1]?.trim() ?? ''
      const omieCode = /^\d+$/.test(lastPart) ? lastPart : ''

      // Nome limpo: sem o código (ex: "Aruba - Hardware")
      const displayName = omieCode ? parts.slice(0, -1).join(' - ').trim() : fullName

      // Localidade
      const location = (localPropId ? readProp(el, localPropId) : '').toLowerCase()

      return {
        id:       String(el.ID || ''),
        name:     displayName || fullName,
        omieCode,
        location,
      }
    })
  }

  // ─── Gestão de Fornecedores — Lista Bitrix24 #61 ─────────────────────────────
  // Bitrix24 Universal Lists requer SELECT por ID numérico (PROPERTY_329),
  // não por código (PROPERTY_CNPJ). Mapa fixo obtido via lists.field.get.

  /** ID numérico → código da propriedade para lista #61 */
  private static readonly SUPPLIER_PROP_IDS: Record<string, string> = {
    '329': 'CNPJ', '331': 'IE',    '333': 'EMAIL',  '335': 'CONTATO',
    '339': 'TELEFONE2', '341': 'TELEFONE1',
    '343': 'ENDERECO',  '345': 'NUMERO', '347': 'COMPLEMENTO',
    '349': 'BAIRRO',    '351': 'CIDADE', '353': 'ESTADO',
    '355': 'CEP',       '357': 'ENDERECO_COMPLETO',
  }

  /** Extrai valor de PROPERTY_{id} vindo da resposta do lists.element.get */
  private static _readProp(el: any, code: string): string {
    const idEntry = Object.entries(BitrixService.SUPPLIER_PROP_IDS).find(([, c]) => c === code)
    const keys = idEntry ? [`PROPERTY_${idEntry[0]}`, `PROPERTY_${code}`] : [`PROPERTY_${code}`]
    for (const key of keys) {
      const raw = el[key]
      if (raw == null || raw === '') continue
      const extracted = BitrixService._extractPropValue(raw)
      if (extracted) return extracted
    }
    return ''
  }

  /** Extrai o valor textual de qualquer formato de propriedade Bitrix24 */
  private static _extractPropValue(raw: any): string {
    if (typeof raw === 'string' || typeof raw === 'number') return String(raw)
    if (Array.isArray(raw)) return BitrixService._extractPropValue(raw[0])
    if (typeof raw === 'object' && raw !== null) {
      // Formato HTML: { TYPE: "HTML", TEXT: "valor" }
      if (raw.TEXT !== undefined) return String(raw.TEXT)
      if (raw.VALUE !== undefined) return BitrixService._extractPropValue(raw.VALUE)
      // Formato numérico/string com chave interna: { "192199": "valor" } ou { "192199": { TEXT: "..." } }
      const first = Object.values(raw)[0]
      if (first != null) return BitrixService._extractPropValue(first)
    }
    return ''
  }

  /** Constrói o valor de escrita de uma propriedade */
  private static _writeProp(value: string | undefined): any {
    if (!value) return ''
    return { n0: { VALUE: value } }
  }

  /**
   * Retorna todos os fornecedores da lista (paginação automática).
   * Usa SELECT com PROPERTY_CODE — sem precisar de lists.field.get.
   */
  static async getSuppliers(listId: number | string = 61): Promise<BitrixSupplier[]> {
    const select = [
      'ID', 'NAME',
      ...Object.keys(BitrixService.SUPPLIER_PROP_IDS).map(id => `PROPERTY_${id}`),
    ]
    const all: BitrixSupplier[] = []
    let start = 0

    while (true) {
      const j: any = await bPost('/lists.element.get.json', {
        IBLOCK_TYPE_ID: 'lists',
        IBLOCK_ID: listId,
        FILTER: { ACTIVE: 'Y' },
        SELECT: select,
        start,
      })

      const items: any[] = Array.isArray(j.result)
        ? j.result
        : Object.values(j.result || {})

      for (const el of items) {
        const g = (code: string) => BitrixService._readProp(el, code)
        all.push({
          id:               String(el.ID || ''),
          name:             String(el.NAME || ''),
          cnpj:             parseStoredCNPJ(g('CNPJ')),
          ie:               g('IE'),
          email:            g('EMAIL'),
          contato:          g('CONTATO'),
          telefone1:        g('TELEFONE1'),
          telefone2:        g('TELEFONE2'),
          endereco:         g('ENDERECO'),
          numero:           g('NUMERO'),
          complemento:      g('COMPLEMENTO'),
          bairro:           g('BAIRRO'),
          cidade:           g('CIDADE'),
          estado:           g('ESTADO'),
          cep:              g('CEP'),
          enderecoCompleto: g('ENDERECO_COMPLETO'),
        })
      }

      if (!j.next || items.length < 50) break
      start = j.next
    }

    return all
  }

  /**
   * Cria fornecedor na lista usando PROPERTY_CODE diretamente.
   * Retorna o ID do elemento criado.
   */
  static async createSupplier(
    data: Omit<BitrixSupplier, 'id'>,
    listId: number | string = 61
  ): Promise<string> {
    const p = BitrixService._writeProp
    const elementCode = data.cnpj.replace(/\D/g, '') || String(Date.now())

    const j: any = await bPost('/lists.element.add.json', {
      IBLOCK_TYPE_ID: 'lists',
      IBLOCK_ID: listId,
      ELEMENT_CODE: elementCode,
      fields: {
        NAME:                      data.name,
        PROPERTY_CNPJ:             p(data.cnpj),
        PROPERTY_IE:               p(data.ie),
        PROPERTY_EMAIL:            p(data.email),
        PROPERTY_CONTATO:          p(data.contato),
        PROPERTY_TELEFONE1:        p(data.telefone1),
        PROPERTY_TELEFONE2:        p(data.telefone2),
        PROPERTY_ENDERECO:         p(data.endereco),
        PROPERTY_NUMERO:           p(data.numero),
        PROPERTY_COMPLEMENTO:      p(data.complemento),
        PROPERTY_BAIRRO:           p(data.bairro),
        PROPERTY_CIDADE:           p(data.cidade),
        PROPERTY_ESTADO:           p(data.estado),
        PROPERTY_CEP:              p(data.cep),
        PROPERTY_ENDERECO_COMPLETO: p(data.enderecoCompleto),
      },
    })

    return String(j.result || '')
  }

  /**
   * Atualiza fornecedor na lista usando PROPERTY_CODE diretamente.
   */
  static async updateSupplier(
    elementId: string,
    data: Partial<Omit<BitrixSupplier, 'id'>>,
    listId: number | string = 61
  ): Promise<void> {
    const p = BitrixService._writeProp
    const fields: Record<string, any> = {}

    if (data.name             !== undefined) fields.NAME                       = data.name
    if (data.cnpj             !== undefined) fields.PROPERTY_CNPJ              = p(data.cnpj)
    if (data.ie               !== undefined) fields.PROPERTY_IE                = p(data.ie)
    if (data.email            !== undefined) fields.PROPERTY_EMAIL             = p(data.email)
    if (data.contato          !== undefined) fields.PROPERTY_CONTATO           = p(data.contato)
    if (data.telefone1        !== undefined) fields.PROPERTY_TELEFONE1         = p(data.telefone1)
    if (data.telefone2        !== undefined) fields.PROPERTY_TELEFONE2         = p(data.telefone2)
    if (data.endereco         !== undefined) fields.PROPERTY_ENDERECO          = p(data.endereco)
    if (data.numero           !== undefined) fields.PROPERTY_NUMERO            = p(data.numero)
    if (data.complemento      !== undefined) fields.PROPERTY_COMPLEMENTO       = p(data.complemento)
    if (data.bairro           !== undefined) fields.PROPERTY_BAIRRO            = p(data.bairro)
    if (data.cidade           !== undefined) fields.PROPERTY_CIDADE            = p(data.cidade)
    if (data.estado           !== undefined) fields.PROPERTY_ESTADO            = p(data.estado)
    if (data.cep              !== undefined) fields.PROPERTY_CEP               = p(data.cep)
    if (data.enderecoCompleto !== undefined) fields.PROPERTY_ENDERECO_COMPLETO = p(data.enderecoCompleto)

    await bPost('/lists.element.update.json', {
      IBLOCK_TYPE_ID: 'lists',
      IBLOCK_ID: listId,
      ELEMENT_ID: elementId,
      fields,
    })
  }

  /** Remove fornecedor da lista. */
  static async deleteSupplier(
    elementId: string,
    listId: number | string = 61
  ): Promise<void> {
    await bPost('/lists.element.delete.json', {
      IBLOCK_TYPE_ID: 'lists',
      IBLOCK_ID: listId,
      ELEMENT_ID: elementId,
    })
  }

  /**
   * Retorna clientes da lista #63 com descoberta dinâmica dos IDs de propriedade.
   * Funciona para qualquer lista com os mesmos FIELD_NAME/CODE que a lista de fornecedores.
   */
  static async getClients(listId: number | string = 63): Promise<BitrixSupplier[]> {
    // 1. Descobre IDs numéricos das propriedades desta lista
    const fj: any = await bPost('/lists.field.get.json', {
      IBLOCK_TYPE_ID: 'lists',
      IBLOCK_ID: listId,
    }).catch(() => ({}))

    const fields: Record<string, any> = fj?.result ?? {}
    const codeToId: Record<string, string> = {}
    for (const [fieldKey, field] of Object.entries(fields)) {
      const match = fieldKey.match(/^PROPERTY_(\d+)$/)
      if (!match) continue
      const code = String((field as any).FIELD_NAME || (field as any).CODE || '').toUpperCase()
      if (code) codeToId[code] = match[1]
    }

    const KNOWN_CODES = ['CNPJ','IE','EMAIL','CONTATO','TELEFONE1','TELEFONE2',
      'ENDERECO','NUMERO','COMPLEMENTO','BAIRRO','CIDADE','ESTADO','CEP','ENDERECO_COMPLETO']
    const selectProps = KNOWN_CODES.filter(c => codeToId[c]).map(c => `PROPERTY_${codeToId[c]}`)
    const select = ['ID', 'NAME', ...selectProps]

    // 2. Busca elementos com paginação
    const all: BitrixSupplier[] = []
    let start = 0
    while (true) {
      const j: any = await bPost('/lists.element.get.json', {
        IBLOCK_TYPE_ID: 'lists',
        IBLOCK_ID: listId,
        FILTER: { ACTIVE: 'Y' },
        SELECT: select,
        start,
      })
      const items: any[] = Array.isArray(j.result) ? j.result : Object.values(j.result || {})
      for (const el of items) {
        const g = (code: string): string => {
          const propId = codeToId[code]
          if (!propId) return ''
          return BitrixService._extractPropValue(el[`PROPERTY_${propId}`])
        }
        all.push({
          id: String(el.ID || ''), name: String(el.NAME || ''),
          cnpj: parseStoredCNPJ(g('CNPJ')), ie: g('IE'), email: g('EMAIL'), contato: g('CONTATO'),
          telefone1: g('TELEFONE1'), telefone2: g('TELEFONE2'),
          endereco: g('ENDERECO'), numero: g('NUMERO'), complemento: g('COMPLEMENTO'),
          bairro: g('BAIRRO'), cidade: g('CIDADE'), estado: g('ESTADO'),
          cep: g('CEP'), enderecoCompleto: g('ENDERECO_COMPLETO'),
        })
      }
      if (!j.next || items.length < 50) break
      start = j.next
    }
    return all
  }

  /** Cria cliente na lista #63 usando descoberta dinâmica dos IDs de propriedade. */
  static async createClient(
    data: Omit<BitrixSupplier, 'id'>,
    listId: number | string = 63
  ): Promise<string> {
    // Descobre IDs numéricos das propriedades desta lista (igual ao getClients)
    const fj: any = await bPost('/lists.field.get.json', {
      IBLOCK_TYPE_ID: 'lists',
      IBLOCK_ID: listId,
    }).catch(() => ({}))

    const fieldDefs: Record<string, any> = fj?.result ?? {}
    const codeToId: Record<string, string> = {}
    for (const [fieldKey, field] of Object.entries(fieldDefs)) {
      const match = fieldKey.match(/^PROPERTY_(\d+)$/)
      if (!match) continue
      const code = String((field as any).FIELD_NAME || (field as any).CODE || '').toUpperCase()
      if (code) codeToId[code] = match[1]
    }

    const p = BitrixService._writeProp
    const elementCode = data.cnpj.replace(/\D/g, '') || String(Date.now())

    // Monta fields usando IDs numéricos quando disponíveis, senão tenta pelo nome
    const prop = (code: string, value: any) => {
      const id = codeToId[code]
      const key = id ? `PROPERTY_${id}` : `PROPERTY_${code}`
      return { [key]: p(value) }
    }

    const fields = {
      NAME: data.name,
      ...prop('CNPJ', data.cnpj),
      ...prop('IE', data.ie),
      ...prop('EMAIL', data.email),
      ...prop('CONTATO', data.contato),
      ...prop('TELEFONE1', data.telefone1),
      ...prop('TELEFONE2', data.telefone2),
      ...prop('ENDERECO', data.endereco),
      ...prop('NUMERO', data.numero),
      ...prop('COMPLEMENTO', data.complemento),
      ...prop('BAIRRO', data.bairro),
      ...prop('CIDADE', data.cidade),
      ...prop('ESTADO', data.estado),
      ...prop('CEP', data.cep),
      ...prop('ENDERECO_COMPLETO', data.enderecoCompleto),
    }

    const j: any = await bPost('/lists.element.add.json', {
      IBLOCK_TYPE_ID: 'lists',
      IBLOCK_ID: listId,
      ELEMENT_CODE: elementCode,
      fields,
    })

    return String(j.result || '')
  }

  /**
   * Lista todos os itens de inside sales de uma etapa específica (sem banco de dados)
   */
  static async getItemsByStage(stageId: string): Promise<{ items: BitrixInsideSalesItem[]; total: number }> {
    try {
      const j: any = await bPost('/crm.item.list.json', {
        entityTypeId: ENTITY_TYPE_ID,
        filter: {
          categoryId: PIPELINE_CATEGORY_ID,
          '=stageId': stageId,
        },
        select: ['id', 'title', 'xmlId', 'stageId', 'categoryId', 'createdTime', 'updatedTime', 'companyId'],
        order: { id: 'desc' },
        start: 0,
      });

      const raw: any[] = Array.isArray(j.result) ? j.result : (j.result?.items || []);
      const total: number = typeof j.total === 'number' ? j.total : raw.length;

      // Mapeia para BitrixInsideSalesItem
      const items: BitrixInsideSalesItem[] = raw.map(r => ({
        id:          Number(r.id ?? r.ID),
        title:       String(r.title ?? r.TITLE ?? ''),
        xmlId:       r.xmlId ?? r.XML_ID,
        stageId:     String(r.stageId ?? r.STAGE_ID ?? ''),
        categoryId:  r.categoryId ? Number(r.categoryId) : undefined,
        createdTime: r.createdTime ?? r.DATE_CREATE,
        updatedTime: r.updatedTime ?? r.DATE_MODIFY,
        companyId:   r.companyId ? Number(r.companyId) : undefined,
      }))

      // Batch lookup de nomes de empresa para todos os companyIds únicos
      const ids = [...new Set(items.map(i => i.companyId).filter(Boolean))] as number[]
      if (ids.length > 0) {
        try {
          const cj: any = await bPost('/crm.company.list.json', {
            filter: { 'ID': ids },
            select: ['ID', 'TITLE'],
            start: 0,
          })
          const companies: any[] = Array.isArray(cj.result) ? cj.result : []
          const nameMap = new Map(companies.map((c: any) => [Number(c.ID), String(c.TITLE || '')]))
          items.forEach(item => {
            if (item.companyId) item.companyName = nameMap.get(item.companyId) || undefined
          })
        } catch {
          // batch falhou: segue sem nomes
        }
      }

      return { items, total };
    } catch (error) {
      console.error('Erro ao buscar itens por etapa:', error);
      return { items: [], total: 0 };
    }
  }

  /**
   * Nome da etapa
   */
  static async getStageName(stageId: string): Promise<string> {
    try {
      const stages = await this.getStages();
      const stage = stages.find(s => s.STATUS_ID === stageId);
      return stage?.NAME || 'Etapa desconhecida';
    } catch (error) {
      console.error('Erro ao buscar nome da etapa:', error);
      return 'Etapa desconhecida';
    }
  }
}
/**
 * Margem do negócio no funil COMERCIAL (crm.deal), gravada pelo BP "bp-49":
 *   UF_CRM_1652129369867 = Margem %  ·  UF_CRM_1652129349632 = Custo  ·  OPPORTUNITY = Venda
 * O recebimento do Omie referencia o negócio via cNumCtr = "ano.ID" (UF_CRM_1654539371364).
 * Se a margem gravada estiver vazia, recalcula pela fórmula do BP: ((venda−custo)×0,415)/venda×100.
 */
export async function getBitrixDealMarginById(dealId: number): Promise<number | null> {
  try {
    const j: any = await bGet(`/crm.deal.get.json?id=${dealId}`)
    const d = j?.result
    if (!d) return null
    const direct = Number(String(d.UF_CRM_1652129369867 ?? '').replace(',', '.'))
    if (Number.isFinite(direct) && direct !== 0) return direct
    const opp = Number(String(d.OPPORTUNITY ?? '').split('|')[0])
    const cost = Number(String(d.UF_CRM_1652129349632 ?? '').split('|')[0])
    if (opp > 0 && Number.isFinite(cost)) return ((opp - cost) * 0.415) / opp * 100
    return null
  } catch {
    return null
  }
}

/** Extrai o ID do negócio Bitrix a partir do código "ano.ID" (ex.: "2024.7257" → 7257). */
export function parseNumCtrDealId(numCtr: string | null | undefined): number | null {
  const m = /^\s*\d{4}\.(\d+)\s*$/.exec(String(numCtr ?? ''))
  return m ? Number(m[1]) : null
}

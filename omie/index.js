// handler.js
// Versão JSON-first, 100% sem Bitrix e sem Excel.

const Omie = require('./omie.js');

// Buffers de itens (resetados a cada execução)
let CREATE_ITEM_OC = [];
let ITEMS_OV = [];
let ITEMS_OS_SOFT = [];
let ITEMS_OS_LICE = [];
let ITEMS_OS_SERV_TER = [];
let ITEMS_OS_SERV_PRO = [];

/**
 * Espera receber JSON no body com estrutura (aceita aliases):
 * {
 *   "type": "SERVICO" | "PRODUTO-HARDWARE" | "PRODUTO-SOFTWARE",
 *   "fornecedor": { "cnpj_cpf": "..." },
 *   "cliente": { ...campos Omie... },
 *   "distribuidor": { ...campos Omie... },
 *   "produtos": [ { codigo, descricao, natureza, ... } ],
 *   // Qualquer um dos abaixo funciona:
 *   "ordem_compra" | "oc" | "cabecalho_incluir": { dDtPrevisao?: "YYYY-MM-DD|DD/MM/AAAA|...", cNumPedido?: "...", ... }
 *   "ordem_venda"  | "ov": { data_previsao?: "YYYY-MM-DD|DD/MM/AAAA|...", codigo_pedido?: "...", ... }
 * }
 */
exports.handler = async (event) => {
  console.log('handler event:', typeof event === 'string' ? event : JSON.stringify(event));

  // Zera buffers por execução
  CREATE_ITEM_OC = [];
  ITEMS_OV = [];
  ITEMS_OS_SOFT = [];
  ITEMS_OS_LICE = [];
  ITEMS_OS_SERV_TER = [];
  ITEMS_OS_SERV_PRO = [];

  let response = {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ ok: true, detail: 'No params' }),
  };

  try {
    // Lê/normaliza params
    const params = normalizeBody(event);
    if (!params) {
      response.body = JSON.stringify({ ok: false, error: 'Body inválido ou ausente' });
      return response;
    }

    // Validações mínimas
    if (!params.fornecedor?.cnpj_cpf) throw new Error('fornecedor.cnpj_cpf é obrigatório');
    if (!Array.isArray(params.produtos)) throw new Error('produtos deve ser um array');

    const type = String(params.type || 'PRODUTO-SOFTWARE').toUpperCase();

    // 1) Clientes no Omie
    const fornecedorCnpj = params.fornecedor.cnpj_cpf;

    let cliente = {};
    if (params.cliente?.cnpj_cpf) {
      cliente = await ensureClienteExists(fornecedorCnpj, params.cliente);
      console.log('cliente resolvido:', cliente?.codigo_cliente);
    }

    let distribuidor = {};
    if (params.distribuidor?.cnpj_cpf) {
      distribuidor = await ensureClienteExists(fornecedorCnpj, params.distribuidor);
      console.log('distribuidor resolvido:', distribuidor?.codigo_cliente);
    }

    // 2) Produtos/itens
    const produtos = normalizeProdutos(params.produtos);
    splitItensPorNatureza(produtos);

    // 3) OV / OC / OS
    // Aceita aliases do payload: ordem_compra/oc/cabecalho_incluir e ordem_venda/ov
    const rawOC = params.ordem_compra ?? params.oc ?? params.cabecalho_incluir ?? {};
    const rawOV = params.ordem_venda  ?? params.ov ?? {};

    const oc = normalizeOC(rawOC);
    const ov = normalizeOV(rawOV);
    console.log('Datas normalizadas -> OC.dDtPrevisao:', oc.dDtPrevisao, ' | OV.data_previsao:', ov.data_previsao);

// Cria Ordem de Compra (tudo que NÃO é SRV)
if (CREATE_ITEM_OC.length > 0 && distribuidor?.codigo_cliente) {
  const itensOC = await processItems(fornecedorCnpj, CREATE_ITEM_OC); // <<< ADD
  console.log('createOC fornecedor', { ...distribuidor, codigo_cliente: distribuidor.codigo_cliente });
  console.log('createOC produtos', itensOC);
  console.log('createOC oc', oc);

  const createOCResult = await Omie.createOC(fornecedorCnpj, distribuidor, itensOC, oc, 'json-flow');
  console.log('createOCResult', createOCResult);
}

// Cria Ordem de Venda (itens HW)
if (ITEMS_OV.length > 0 && cliente?.codigo_cliente) {
  const itensOV = await processItems(fornecedorCnpj, ITEMS_OV); // <<< ADD
  console.log('createOV cliente', { ...cliente, codigo_cliente: cliente.codigo_cliente });
  console.log('createOV produtosFull', itensOV);

  const createOVResult = await Omie.createOV(fornecedorCnpj, cliente, itensOV, ov, 'json-flow');
  console.log('createOVResult', createOVResult);
}


    // Cria Ordens de Serviço por tipo (SW, LC, ST, SRV), usando dados da OV (para manter consistência)
    await createOSIfAny(fornecedorCnpj, cliente, ITEMS_OS_SOFT, ov, 'SOFT');
    await createOSIfAny(fornecedorCnpj, cliente, ITEMS_OS_LICE, ov, 'LICE');
    await createOSIfAny(fornecedorCnpj, cliente, ITEMS_OS_SERV_TER, ov, 'SERV_TER');
    await createOSIfAny(fornecedorCnpj, cliente, ITEMS_OS_SERV_PRO, ov, 'SERV_PRO');

    response.body = JSON.stringify({
      ok: true,
      type,
      resumo: {
        itensOC: CREATE_ITEM_OC.length,
        itensOV: ITEMS_OV.length,
        itensOS: {
          soft: ITEMS_OS_SOFT.length,
          lice: ITEMS_OS_LICE.length,
          serv_ter: ITEMS_OS_SERV_TER.length,
          serv_pro: ITEMS_OS_SERV_PRO.length,
        },
      },
    });
    return response;
  } catch (err) {
    console.error('Erro geral:', err?.message, err);
    response.statusCode = 500;
    response.body = JSON.stringify({ ok: false, error: err?.message || 'Erro inesperado' });
    return response;
  }
};

/* ----------------- Helpers ----------------- */

function normalizeBody(event) {
  if (!event) return null;
  if (typeof event === 'object' && event.body && typeof event.body === 'string') {
    try { return JSON.parse(event.body); }
    catch (e) { console.error('Body não é JSON válido:', e.message); return null; }
  }
  if (typeof event === 'object' && !event.body) return event; // uso local: handler({ ...json })
  if (typeof event === 'string') {
    try { return JSON.parse(event); }
    catch (e) { console.error('Event string não é JSON válido:', e.message); return null; }
  }
  return null;
}

// ---- Datas: sempre 10 chars (DD/MM/AAAA). Se vazio/ inválido → hoje ----
function toOmieDate10(input) {
  if (!input) return undefined;

  if (input instanceof Date) {
    if (isNaN(input.getTime())) return undefined;
    const d = String(input.getDate()).padStart(2, '0');
    const m = String(input.getMonth() + 1).padStart(2, '0');
    const y = input.getFullYear();
    return `${d}/${m}/${y}`;
  }

  let s = String(input).trim();
  if (!s || s.toLowerCase() === 'invalid date') return undefined;

  // corta hora se vier ISO ou "data hora"
  if (s.includes('T')) s = s.split('T')[0];
  if (s.includes(' ')) s = s.split(' ')[0];

  // yyyy-mm-dd -> dd/mm/yyyy
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; }
  // yyyy/mm/dd -> dd/mm/yyyy
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) { const [y, m, d] = s.split('/'); return `${d}/${m}/${y}`; }
  // dd-mm-yyyy -> dd/mm/yyyy
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) { const [d, m, y] = s.split('-'); return `${d}/${m}/${y}`; }
  // dd/mm/yyyy -> ok
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;

  return undefined;
}
function ensureDateOrToday(input) {
  return toOmieDate10(input) ?? toOmieDate10(new Date());
}

// Normaliza NCM: remove não-dígitos. Se tiver 8 dígitos, retorna; caso contrário, devolve original (ou vazio)
function normalizeNCM(ncm) {
  if (!ncm) return '';
  const digits = String(ncm).replace(/\D+/g, '');
  if (digits.length === 8) return digits;
  // mantém como veio se não puder normalizar (evita quebrar regras internas que você possa ter)
  return String(ncm);
}

async function ensureClienteExists(fornecedorCnpj, dadosCliente) {
  const cnpj = dadosCliente.cnpj_cpf;
  const check = await Omie.checkCliente(fornecedorCnpj, cnpj);
  if (!check?.clientes_cadastro) {
    // Campos bancários default (opcional)
    const payload = {
      ...dadosCliente,
      dadosBancarios: {
        codigo_banco: "001",
        agencia: "0000000001",
        conta_corrente: "0000000001",
      }
    };
    const created = await Omie.createCliente(fornecedorCnpj, payload);
    return { ...dadosCliente, codigo_cliente: created.codigo_cliente_omie };
  }
  const found = check.clientes_cadastro[0];
  return { ...found, codigo_cliente: found.codigo_cliente_omie };
}

// Normaliza natureza para valores esperados: HW | SW | LC | ST | SRV
function normalizeNatureza(raw) {
  const s = String(raw || '').toUpperCase().trim();
  if (['HW','HARDWARE','PRODUTO-HARDWARE','PRODUTO_HW'].includes(s)) return 'HW';
  if (['SW','SOFTWARE','PRODUTO-SOFTWARE','PRODUTO_SW','SOFT'].includes(s)) return 'SW';
  if (['LC','LICENSE','LICENCA','LICENÇA','LICE'].includes(s)) return 'LC';
  if (['ST','SERVICE_TERCEIRO','SERV_TER','SERVICO_TERCEIRO','TERCEIRO'].includes(s)) return 'ST';
  if (['SRV','SERV','SERVICO','SERVIÇO','SERV_PRO','SERVICO_PROPRIO'].includes(s)) return 'SRV';
  return s || 'HW';
}

function normalizeProdutos(produtos) {
  const out = [];
  for (const p of produtos) {
    if (!p?.codigo) continue;

    const natureza = normalizeNatureza(p.natureza);

    const item = {
      unidade: p.unidade || 'UN',
      codigo: String(p.codigo),

      // >>> SKU sempre presente como código de integração
      codigo_produto_integracao: p.codigo_produto_integracao
        ? String(p.codigo_produto_integracao)
        : String(p.codigo),

      // Só mantenha se for numérico (ID Omie). Se vier "teste57", deixa undefined.
      codigo_produto: /^\d+$/.test(String(p.codigo_produto || ''))
        ? Number(p.codigo_produto)
        : undefined,

      descricao: p.descricao,
      local: p.local,
      cfop: p.cfop,
      natureza, // 'HW' | 'SW' | 'LC' | 'ST' | 'SRV'
      codigo_familia: extractCodigoFamilia(p.codigo_familia),
      ncm: normalizeNCM(p.ncm), // mantém sua função
      qtd: Number(p.qtd || 1),
      custo_unit: Number(p.custo_unit || 0),
      valor_unitario: Number(p.valor_unitario || 0),
    };

    out.push(item);
  }
  return out;
}

function extractCodigoFamilia(raw) {
  if (!raw) return '';
  const parts = String(raw).split('-');
  if (parts.length > 2) return parts[2].trim();
  return String(raw).trim();
}

function splitItensPorNatureza(produtos) {
  for (const element of produtos) {
    if (element.natureza !== 'SRV') CREATE_ITEM_OC.push(element);

    switch (element.natureza) {
      case 'HW':
        ITEMS_OV.push(element);
        break;
      case 'SW':
        ITEMS_OS_SOFT.push(element);
        break;
      case 'LC':
        ITEMS_OS_LICE.push(element);
        break;
      case 'ST':
        ITEMS_OS_SERV_TER.push(element);
        break;
      case 'SRV':
        ITEMS_OS_SERV_PRO.push(element);
        break;
    }
  }
  console.log('Resumo itens por natureza:', {
    CREATE_ITEM_OC: CREATE_ITEM_OC.length,
    HW: ITEMS_OV.length,
    SW: ITEMS_OS_SOFT.length,
    LC: ITEMS_OS_LICE.length,
    ST: ITEMS_OS_SERV_TER.length,
    SRV: ITEMS_OS_SERV_PRO.length,
  });
}

function normalizeOC(oc) {
  const out = { ...(oc || {}) };

  // Parcelas: pega apenas código antes do hífen (ex.: "001 - À Vista")
  if (out.cCodParc) out.cCodParc = String(out.cCodParc).split('-')[0].trim();

  // Número do pedido de compra: tenta várias origens
  out.cNumPedido = out.cNumPedido ?? out.cCodIntPed ?? out.codigo_pedido ?? out.codigo_pedido_integracao;
  if (out.cNumPedido != null) out.cNumPedido = String(out.cNumPedido);

  // Data previsão: sempre válida em 10 chars
  out.dDtPrevisao = ensureDateOrToday(out.dDtPrevisao);

  // Código do fornecedor pode vir como número/ string → não alteramos aqui
  return out;
}

function normalizeOV(ov) {
  const out = { ...(ov || {}) };

  if (out.codigo_parcela) out.codigo_parcela = String(out.codigo_parcela).split('-')[0].trim();

  // Código/integração do pedido: tenta popular se vier apenas um deles
  out.codigo_pedido = out.codigo_pedido ?? out.numero_pedido ?? out.cNumPedido ?? out.cCodIntPed;
  if (out.codigo_pedido != null) out.codigo_pedido = String(out.codigo_pedido);
  if (out.codigo_pedido_integracao == null && out.codigo_pedido != null) {
    out.codigo_pedido_integracao = String(out.codigo_pedido);
  }

  // Data previsão: sempre válida em 10 chars
  out.data_previsao = ensureDateOrToday(out.data_previsao);

  // etapa, categoria etc podem ser definidos dentro de Omie.createOV se necessário
  return out;
}

async function createOSIfAny(fornecedorCnpj, cliente, itens, ov, label) {
  if (itens.length === 0) return;
  const itensResolvidos = await processItems(fornecedorCnpj, itens);
  const res = await Omie.createOS(fornecedorCnpj, cliente, itensResolvidos, ov, `json-flow-${label}`);
  console.log(`createOSResult[${label}]`, res);
}

// Resolve código de produto no Omie (não cria para SRV)
async function processItems(fornecedorCnpj, items) {
  console.log('processItems items', items.length);
  for (let i = 0; i < items.length; i++) {
    const element = items[i];
    if (!element?.codigo) continue;

    if (element.natureza === 'SRV') continue; // serviço não é produto

    // >>> use sempre o SKU (código de integração)
    const sku = element.codigo_produto_integracao || element.codigo;

    const checkProdutoResult = await Omie.checkProduto(fornecedorCnpj, sku);
    console.log('checkProdutoResult', checkProdutoResult);

    if (!checkProdutoResult?.codigo_produto) {
      const createProdutoResult = await Omie.createProduto(fornecedorCnpj, element);
      console.log('createProdutoResult', createProdutoResult);
      items[i].codigo_produto = createProdutoResult.codigo_produto; // numérico do Omie
    } else {
      items[i].codigo_produto = checkProdutoResult.codigo_produto; // numérico do Omie
    }
  }
  return items;
}


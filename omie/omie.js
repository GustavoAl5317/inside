// omie.js
// Versão limpa: sem Bitrix, sem Excel. Compatível com o handler JSON-first.

const omieApi = require('./omie_api.js');

const CLIENTES = "https://app.omie.com.br/api/v1/geral/clientes/";
const PRODUTOS = "https://app.omie.com.br/api/v1/geral/produtos/";
const PEDIDOS_VENDA = "https://app.omie.com.br/api/v1/produtos/pedido/";
const PEDIDOS_COMPRA = "https://app.omie.com.br/api/v1/produtos/pedidocompra/";
const ORDEM_SERVICO = "https://app.omie.com.br/api/v1/servicos/os/";
const SERVICOS = "https://app.omie.com.br/api/v1/servicos/servico/";

/* =========================
   HELPERS (datas / strings)
   ========================= */
function toDDMMYYYY_fromString10(s) {
  if (!s) return null;
  // já está dd/mm/yyyy?
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  // yyyy-mm-dd -> dd/mm/yyyy
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-");
    return `${d}/${m}/${y}`;
  }
  // yyyy/mm/dd -> dd/mm/yyyy
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) {
    const [y, m, d] = s.split("/");
    return `${d}/${m}/${y}`;
  }
  // dd-mm-yyyy -> dd/mm/yyyy
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
    const [d, m, y] = s.split("-");
    return `${d}/${m}/${y}`;
  }
  return null;
}
function todayDDMMYYYY() {
  const dt = new Date();
  const d = String(dt.getDate()).padStart(2, '0');
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const y = dt.getFullYear();
  return `${d}/${m}/${y}`;
}
/** Nunca use new Date()/Date.parse em 'DD/MM/AAAA'. Aceita Date | string | vazio. */
function pickOmieDate10(input) {
  if (input instanceof Date) {
    if (!isNaN(input.getTime())) {
      const y = input.getFullYear();
      const m = String(input.getMonth() + 1).padStart(2, '0');
      const d = String(input.getDate()).padStart(2, '0');
      return `${d}/${m}/${y}`;
    }
    return todayDDMMYYYY();
  }
  let raw = (input ?? '').toString().trim();
  if (!raw || raw.toLowerCase() === 'invalid date') return todayDDMMYYYY();
  // corta hora se vier ISO/space
  if (raw.includes('T')) raw = raw.split('T')[0];
  if (raw.includes(' ')) raw = raw.split(' ')[0];
  const conv = toDDMMYYYY_fromString10(raw);
  return conv || todayDDMMYYYY();
}
function str(v) {
  if (v === undefined || v === null || v === false) return undefined;
  return String(v);
}
function onlyDigits(v) {
  return String(v || '').replace(/\D+/g, '');
}
function onlyCode(codeOrLabel) {
  if (!codeOrLabel) return undefined;
  return String(codeOrLabel).split('-')[0].trim();
}

/* =========================
   CLIENTE
   ========================= */
async function checkCliente(EMPRESA, cnpj) {
  console.log("checkCliente cnpj", cnpj);

  const method = "ListarClientes";
  const params = {
    "pagina": 1,
    "registros_por_pagina": 5,
    "apenas_importado_api": "N",
    "clientesFiltro": { "cnpj_cpf": cnpj }
  };

  console.log("checkCliente params", params);
  const result = await omieApi.requestOmie(EMPRESA, CLIENTES, method, params);
  console.log("checkCliente result", result);
  return result;
}

async function createCliente(EMPRESA, parameters) {
  console.log("createCliente payload (raw)", parameters);

  // Garante numero, se vier embutido no endereço
  let numero = "S/N";
  if (!parameters.endereco_numero && parameters.endereco) {
    const idx = parameters.endereco.lastIndexOf(",");
    if (idx !== -1) {
      numero = parameters.endereco.substring(idx + 1).trim();
    }
  }
  parameters["endereco_numero"] = parameters.endereco_numero || numero;

  const method = "IncluirCliente";
  const params = parameters;

  console.log("createCliente params", params);
  const result = await omieApi.requestOmie(EMPRESA, CLIENTES, method, params);
  console.log("createCliente result", result);
  return result;
}

/* =========================
   PRODUTO
   ========================= */
async function checkProduto(EMPRESA, codigo_produto) {
  console.log("checkProduto EMPRESA", EMPRESA);
  console.log("checkProduto codigo_produto|integracao", codigo_produto);

  const method = "ConsultarProduto";
  let params = { "codigo": codigo_produto };

  console.log("checkProduto params (try codigo)", params);
  let result = await omieApi.requestOmie(EMPRESA, PRODUTOS, method, params);
  console.log("checkProduto result try codigo", result);

  if (result?.faultstring && String(result.faultstring).includes('Produto não cadastrado')) {
    params = { "codigo_produto": codigo_produto };
    console.log("checkProduto params (try codigo_produto)", params);
    result = await omieApi.requestOmie(EMPRESA, PRODUTOS, method, params);
    console.log("checkProduto result try codigo_produto", result);
  }
  return result;
}

async function createProduto(EMPRESA, parameters) {
  console.log("createProduto payload (raw)", parameters);

  // Só envia campos aceitos pelo IncluirProduto
  const params = { ...parameters };
  delete params.codigo_produto;
  delete params.natureza;
  delete params.local;
  delete params.qtd;
  delete params.custo_unit;
  // delete params.valor_unitario; // normalmente fica no item de OV/OC/OS

  const method = "IncluirProduto";

  console.log("createProduto params", params);
  const result = await omieApi.requestOmie(EMPRESA, PRODUTOS, method, params);
  console.log("createProduto result", result);
  return result;
}

/* =========================
   SERVIÇO (cadastro)
   ========================= */
async function checkServico(EMPRESA, codigo_servico) {
  console.log("checkServico codigo_servico", codigo_servico);

  const method = "ListarCadastroServico";
  const params = { "cCodigo": codigo_servico, "nPagina": 1, "nRegPorPagina": 20 };

  console.log("checkServico params", params);
  const result = await omieApi.requestOmie(EMPRESA, SERVICOS, method, params);
  console.log("checkServico result", result);

  if (result?.cadastros?.length > 0) {
    return result.cadastros[0].cabecalho;
  }
  return false;
}

async function createServico(EMPRESA, parameters) {
  console.log("createServico payload (raw)", parameters);

  const method = "IncluirCadastroServico";
  const params = {
    "intIncluir": { "cCodIntServ": parameters.codigo_produto },
    "descricao": { "cDescrCompleta": parameters.descricao },
    "cabecalho": {
      "cDescricao": parameters.descricao,
      "cCodigo": parameters.codigo_produto,
      "cIdTrib": "",
      "cCodServMun": "",
      "cCodLC116": "",
      "nIdNBS": "",
      "cCodCateg": ""
    },
    "impostos": {
      "nAliqISS": 0, "cRetISS": "N",
      "nAliqPIS": 0, "cRetPIS": "N",
      "nAliqCOFINS": 0, "cRetCOFINS": "N",
      "nAliqCSLL": 0, "cRetCSLL": "N",
      "nAliqIR": 0, "cRetIR": "N",
      "nAliqINSS": 0, "cRetINSS": "N",
      "nRedBaseINSS": 0, "nRedBaseCOFINS": 0, "nRedBasePIS": 0,
      "lDeduzISS": false
    }
  };

  console.log("createServico params", params);
  const result = await omieApi.requestOmie(EMPRESA, SERVICOS, method, params);
  console.log("createServico result", result);
  return result;
}

/* =========================
   ORDEM DE VENDA (OV)
   ========================= */
async function createOV(EMPRESA, cliente, produtosFull, ov /*, sourceTag */) {
  console.log("createOV cliente", cliente);
  console.log("createOV produtosFull", produtosFull);

  // filtra NCM inválido, mantendo sua regra original
  const produtos = (produtosFull || []).filter(p => p.ncm !== '00.0000.00');
  console.log("createOV produtos (após filtro)", produtos);
  if (produtos.length < 1) return [];

  // *** CORREÇÃO DE DATA ***
  const data_previsao = pickOmieDate10(ov.data_previsao);

  // regra de conta corrente por empresa
  let codigo_conta_corrente = "1807556622"; // barueri
  const empDigits = onlyDigits(EMPRESA);
  if (empDigits === '03969530000211') {
    codigo_conta_corrente = "5097263320"; // es
  }

  const parameters = {
    "cabecalho": {
      "codigo_cliente": cliente.codigo_cliente || cliente.codigo_cliente_omie,
      "codigo_pedido_integracao": str(ov.codigo_pedido_integracao || ov.codigo_pedido),
      "data_previsao": data_previsao,
      "etapa": "10",
      "numero_pedido": str(ov.codigo_pedido),
      "codigo_parcela": str(ov.codigo_parcela),
      "quantidade_itens": produtos.length
    },
    "observacoes": {
      // sem URL do Bitrix; usa apenas o que vier do OV
      "obs_venda": `${ov.obs || ''}\n${ov.ObsInt || ''}`.trim()
    },
    "informacoes_adicionais": {
      "codigo_categoria": "1.01.03",
      "codigo_conta_corrente": codigo_conta_corrente,
      "consumidor_final": "S",
      "enviar_email": "N",
      "numero_pedido_cliente": str(ov.codigo_pedido_integracao || ov.codigo_pedido)
    },
    "det": []
  };

  for (let i = 0; i < produtos.length; i++) {
    const e = produtos[i];
    parameters.det.push({
      "ide": { "codigo_item_integracao": String(i + 1) },
      "produto": {
        "cfop": e.cfop,
        "codigo_produto": e.codigo_produto,
        "descricao": e.descricao,
        "ncm": e.ncm,
        "quantidade": e.qtd,
        "tipo_desconto": "V",
        "unidade": e.unidade || "UN",
        "valor_desconto": 0,
        "valor_unitario": e.valor_unitario
      }
    });
  }

  console.log("createOV params", parameters);
  const method = "IncluirPedido";
  const result = await omieApi.requestOmie(EMPRESA, PEDIDOS_VENDA, method, parameters);
  console.log("createOV result", result);
  return result;
}

/* =========================
   ORDEM DE COMPRA (OC)
   ========================= */
async function createOC(EMPRESA, fornecedor, produtos, oc /*, sourceTag */) {
  console.log("createOC fornecedor", fornecedor);
  console.log("createOC produtos", produtos);
  console.log("createOC oc", oc);

  // *** CORREÇÃO DE DATA ***
  const data_previsao = pickOmieDate10(oc.dDtPrevisao);

  const parameters = {
    "cabecalho_incluir": {
      "cCodIntPed": str(oc.cCodIntPed || oc.cNumPedido || oc.codigo_pedido || oc.codigo_pedido_integracao),
      "dDtPrevisao": data_previsao, // <- SEM Date.parse/new Date
      "cCodParc": onlyCode(oc.cCodParc),
      "nCodCompr": Number(oc.nCodCompr || 0),
      "cNumPedido": str(oc.cNumPedido || oc.cCodIntPed || oc.codigo_pedido || oc.codigo_pedido_integracao),
      // sem URL do Bitrix; apenas textos das observações
      "cObs": str(oc.cObs) || "",
      "cObsInt": str(oc.cObsInt) || ""
    },
    "produtos_incluir": []
  };

  // Preferência por código de integração; senão usa código Omie
  if (fornecedor.codigo_cliente_integracao) {
    parameters.cabecalho_incluir["cCodIntFor"] = fornecedor.codigo_cliente_integracao;
  } else if (fornecedor.codigo_cliente || fornecedor.codigo_cliente_omie) {
    parameters.cabecalho_incluir["nCodFor"] = fornecedor.codigo_cliente || fornecedor.codigo_cliente_omie;
  }

  for (let i = 0; i < (produtos || []).length; i++) {
    const e = produtos[i];
    const isHW = e.natureza === "HW";
    parameters.produtos_incluir.push({
      "cCodIntItem": str(e.codigo_produto_integracao || i + 1) || "",
      "cCodIntProd": isHW ? (str(e.codigo_produto_integracao) || "") : "",
      "nCodProd": "",
      "cProduto": e.natureza === 'SRV' ? (str(e.codigo_produto_integracao) || "") : "",
      "cDescricao": str(e.descricao) || "",
      "cNCM": isHW ? (str(e.ncm) || "") : "00.0000.00",
      "cUnidade": e.unidade || "UN",
      "nPesoLiq": 0,
      "nPesoBruto": 0,
      "nQtde": Number(e.qtd || 0),
      "nValUnit": Number(e.custo_unit || 0)
    });
  }

  console.log("createOC params", parameters);
  const method = "IncluirPedCompra";
  const result = await omieApi.requestOmie(EMPRESA, PEDIDOS_COMPRA, method, parameters);
  console.log("createOC result", result);
  return result;
}

/* =========================
   ORDEM DE SERVIÇO (OS)
   ========================= */
async function createOS(EMPRESA, cliente, produtosFull, os /*, sourceTag */) {
  console.log("createOS cliente", cliente);
  console.log("createOS os", os);
  console.log("createOS produtosFull", produtosFull);

  const produtos = produtosFull || [];
  if (produtos.length < 1) return [];

  // mapeia natureza -> serviço padrão
  let sufixo = null;

  for (let i = 0; i < produtos.length; i++) {
    const e = produtos[i];
    let codigo_servico = null;

    switch (e.natureza) {
      case "SW":  codigo_servico = "SRV00016"; sufixo = "SW"; break;
      case "LC":  codigo_servico = "SRV00007"; sufixo = "LC"; break;
      case "ST":  codigo_servico = "SRV00016"; sufixo = "ST"; break;
      case "SRV": codigo_servico = "SRV00001"; sufixo = "SP"; break;
      default:    codigo_servico = e.codigo_produto;        break;
    }

    produtos[i]["codigo_servico"] = codigo_servico;

    if (codigo_servico) {
      const check = await checkServico(EMPRESA, codigo_servico);
      console.log("checkServico retorno", check);

      if (check) {
        produtos[i]["cCodigo"] = check.cCodigo;
        produtos[i]["cCodLC116"] = check.cCodLC116;
        produtos[i]["cCodCateg"] = check.cCodCateg;
        produtos[i]["cCodServMun"] = check.cCodServMun;
        produtos[i]["cDescricao"] = check.cDescricao;
        produtos[i]["cIdTrib"] = check.cIdTrib;
      } else {
        console.log("Serviço não encontrado no Omie (não criando automaticamente).");
      }
    }
  }

  // *** CORREÇÃO DE DATA ***
  const data_previsao = pickOmieDate10(os.data_previsao);

  // regra de conta corrente por empresa
  let codigo_conta_corrente = "1807556622";
  const empDigits = onlyDigits(EMPRESA);
  if (empDigits === '03969530000211') {
    codigo_conta_corrente = "5097263320";
  }

  const parameters = {
    "Cabecalho": {
      "cCodIntOS": `${str(os.codigo_pedido_integracao || os.codigo_pedido) || ''}_${sufixo || ''}`,
      "cCodParc": str(os.codigo_parcela),
      "cEtapa": "20",
      "dDtPrevisao": data_previsao, // <- SEM Date.parse/new Date
      "nCodCli": cliente.codigo_cliente || cliente.codigo_cliente_omie,
      "nQtdeParc": 1
    },
    "Departamentos": [],
    "Email": {
      "cEnvBoleto": "N",
      "cEnvLink": "N",
      "cEnviarPara": cliente.email
    },
    "observacoes": {
      "cObsOS": `${os.obs || ''}\n${os.ObsInt || ''}`.trim()
    },
    "InformacoesAdicionais": {
      "cNumPedido": `${str(os.codigo_pedido_integracao || os.codigo_pedido) || ''}_${sufixo || ''}`,
      "cCidPrestServ": cliente.cidade,
      "cCodCateg": "1.01.02",
      "cDadosAdicNF": os.obs || "",
      "nCodCC": codigo_conta_corrente
    },
    "ServicosPrestados": [],
    "produtosUtilizados": {
      "cAcaoProdUtilizados": "EST", // EST = baixa de estoque | REM = não movimenta
      "cCodCategRem": "",
      "produtoUtilizado": []
    }
  };

  for (const e of produtos) {
    parameters.ServicosPrestados.push({
      "nCodServico": e.codigo_servico,
      "cCodServLC116": e.cCodLC116,
      "cCodServMun": e.cCodServMun,
      "cDadosAdicItem": e.descricao,
      "cDescServ": e.cDescricao,
      "cRetemISS": "N",
      "cTribServ": e.cIdTrib,
      "nQtde": e.qtd,
      "nValUnit": e.valor_unitario
    });

    parameters.produtosUtilizados.produtoUtilizado.push({
      "cAcaoItemPU": "I",
      "nCodProdutoPU": e.codigo_produto,
      "nQtdePU": e.qtd
    });
  }

  console.log("createOS params", parameters);
  const method = "IncluirOS";
  const result = await omieApi.requestOmie(EMPRESA, ORDEM_SERVICO, method, parameters);
  console.log("createOS result", result);
  return result;
}

/* =========================
   Exports
   ========================= */
module.exports.checkCliente = checkCliente;
module.exports.createCliente = createCliente;
module.exports.checkProduto = checkProduto;
module.exports.createProduto = createProduto;
module.exports.checkServico = checkServico;
module.exports.createServico = createServico;
module.exports.createOC = createOC;
module.exports.createOV = createOV;
module.exports.createOS = createOS;

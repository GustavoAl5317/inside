#!/usr/bin/env node
/**
 * SONDAGEM — descobre se AlteraPedCompra REMOVE item omitido (substitui a lista)
 * ou apenas atualiza/insere (merge). Roda contra UMA OC DESCARTÁVEL de teste.
 *
 * O QUE FAZ:
 *   1. Consulta a OC informada.
 *   2. Monta produtos_alterar = todos os itens MENOS o último (preservando
 *      cCodIntItem / nCodItem / nCodProd — sem criar/alterar produto).
 *   3. Chama AlteraPedCompra.
 *   4. Reconsulta e compara a quantidade de itens antes/depois.
 *
 * NÃO cria produto, NÃO troca part number, NÃO mexe em outra OC. Só remove
 * (tenta) o último item de UMA OC. Use um pedido de compra de TESTE/DESCARTÁVEL.
 *
 * USO (na raiz do projeto, com o .env do app disponível):
 *   node scripts/omie-oc-delete-probe.mjs <barueri|es> <numeroDaOC>
 *   ex.: node scripts/omie-oc-delete-probe.mjs barueri 2602010295
 *
 * Credenciais: lê OMIE_APP_KEY_1/OMIE_APP_SECRET_1 (barueri) e _2 (es) do
 * ambiente; se não estiverem no shell, tenta carregar de um arquivo .env.
 */

import { readFileSync } from 'node:fs'

// ── carrega .env se as variáveis não vierem do shell ───────────────────────
function loadDotEnv() {
  if (process.env.OMIE_APP_KEY_1 || process.env.OMIE_APP_KEY_2) return
  try {
    const txt = readFileSync(new URL('../.env', import.meta.url), 'utf8')
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      let v = m[2].trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      if (!(m[1] in process.env)) process.env[m[1]] = v
    }
    console.log('(.env carregado)')
  } catch {
    console.log('(sem .env — usando variáveis do ambiente)')
  }
}

const PEDIDOS_COMPRA = 'https://app.omie.com.br/api/v1/produtos/pedidocompra/'

function creds(branch) {
  return branch === 'es'
    ? { app_key: process.env.OMIE_APP_KEY_2, app_secret: process.env.OMIE_APP_SECRET_2 }
    : { app_key: process.env.OMIE_APP_KEY_1, app_secret: process.env.OMIE_APP_SECRET_1 }
}

async function call(branch, method, param) {
  const { app_key, app_secret } = creds(branch)
  if (!app_key || !app_secret) throw new Error(`Credenciais Omie ausentes para a filial "${branch}". Defina OMIE_APP_KEY_*/OMIE_APP_SECRET_*.`)
  const body = { call: method, app_key, app_secret, param: [param] }
  await new Promise(r => setTimeout(r, 600)) // respeita o rate-limit do Omie
  const resp = await fetch(PEDIDOS_COMPRA, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await resp.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { faultstring: `Resposta não-JSON (HTTP ${resp.status}): ${text.slice(0, 200)}` } }
  return { httpStatus: resp.status, data }
}

async function consult(branch, numero) {
  const n = String(numero).replace(/\D/g, '')
  for (const param of [{ cNumero: String(numero) }, { nCodPed: Number(n) }]) {
    const { data } = await call(branch, 'ConsultarPedCompra', param)
    if (data && !data.faultstring) {
      const wrapped = Array.isArray(data.pedidos_pesquisa) ? data.pedidos_pesquisa[0] : undefined
      const cab = data.cabecalho_consulta ?? data.cabecalho ?? wrapped?.cabecalho_consulta
      const produtos = data.produtos_consulta ?? wrapped?.produtos_consulta ?? []
      if (cab?.nCodPed) return { cab, produtos }
    } else if (data?.faultstring) {
      console.log('  consulta faltou:', data.faultstring)
    }
  }
  return null
}

function itemLine(p, i) {
  return `    [${i}] cCodIntItem=${JSON.stringify(p.cCodIntItem)} nCodItem=${p.nCodItem} nCodProd=${p.nCodProd} qtd=${p.nQtde} desc="${String(p.cDescricao ?? '').slice(0, 40)}"`
}

async function main() {
  loadDotEnv()
  const [, , branchArg, numero] = process.argv
  const branch = branchArg === 'es' ? 'es' : 'barueri'
  if (!numero) {
    console.error('Uso: node scripts/omie-oc-delete-probe.mjs <barueri|es> <numeroDaOC>')
    process.exit(1)
  }

  console.log(`\n=== SONDAGEM AlteraPedCompra — filial ${branch}, OC ${numero} ===`)
  console.log('⚠️  Use apenas uma OC de TESTE/DESCARTÁVEL — este script tenta remover o último item.\n')

  const before = await consult(branch, numero)
  if (!before) { console.error('OC não encontrada.'); process.exit(1) }
  console.log(`ANTES: ${before.produtos.length} itens`)
  before.produtos.forEach((p, i) => console.log(itemLine(p, i)))

  if (before.produtos.length < 2) {
    console.error('\nA OC precisa ter ao menos 2 itens para testar a remoção de 1. Aborte.')
    process.exit(1)
  }

  // Mantém todos menos o ÚLTIMO, preservando a identidade de cada item.
  const kept = before.produtos.slice(0, -1)
  const removed = before.produtos[before.produtos.length - 1]
  console.log(`\nVou tentar remover (omitindo da lista) o item:\n${itemLine(removed, before.produtos.length - 1)}`)

  const cab = before.cab
  const produtos_alterar = kept.map(p => ({
    cCodIntItem: p.cCodIntItem,
    ...(p.nCodItem ? { nCodItem: p.nCodItem } : {}),
    nCodProd: p.nCodProd,
    cDescricao: p.cDescricao,
    cNCM: p.cNCM,
    cUnidade: p.cUnidade ?? 'UN',
    nQtde: Number(p.nQtde ?? 1),
    nValUnit: Number(p.nValUnit ?? 0),
    nPesoLiq: p.nPesoLiq ?? 0,
    nPesoBruto: p.nPesoBruto ?? 0,
  }))

  // Payload do AlteraPedCompra. Se a estrutura estiver errada, o faultstring do
  // Omie abaixo dirá exatamente qual tag/nome ele espera.
  const param = {
    cabecalho: {
      nCodPed: cab.nCodPed,
      cCodIntPed: cab.cCodIntPed,
      cNumero: cab.cNumero,
      nCodFor: cab.nCodFor,
      cCodParc: cab.cCodParc,
      dDtPrevisao: cab.dDtPrevisao,
    },
    produtos_alterar,
  }

  console.log('\n--- AlteraPedCompra REQUEST (param) ---')
  console.log(JSON.stringify(param, null, 2))
  const { httpStatus, data } = await call(branch, 'AlteraPedCompra', param)
  console.log(`\n--- AlteraPedCompra RESPONSE (HTTP ${httpStatus}) ---`)
  console.log(JSON.stringify(data, null, 2))

  // Reconsulta pra ver o efeito real.
  await new Promise(r => setTimeout(r, 1200))
  const after = await consult(branch, numero)
  if (!after) { console.error('\nNão consegui reconsultar a OC depois.'); process.exit(1) }
  console.log(`\nDEPOIS: ${after.produtos.length} itens`)
  after.produtos.forEach((p, i) => console.log(itemLine(p, i)))

  console.log('\n=== CONCLUSÃO ===')
  if (data?.faultstring) {
    console.log(`AlteraPedCompra retornou ERRO: ${data.faultstring}`)
    console.log('→ Ajustar o formato do payload conforme a mensagem acima (nome da tag do cabeçalho/produtos).')
  } else if (after.produtos.length < before.produtos.length) {
    console.log('✅ AlteraPedCompra SUBSTITUI a lista — o item omitido foi REMOVIDO.')
    console.log('   Dá pra usar isso no app pra excluir item de OC.')
  } else if (after.produtos.length === before.produtos.length) {
    console.log('❌ AlteraPedCompra fez MERGE — o item omitido PERMANECEU.')
    console.log('   Não há caminho de exclusão de item por API para OC; usar a tela do Omie.')
  } else {
    console.log('⚠️  A OC ficou com MAIS itens que antes — comportamento inesperado (possível duplicação). Revisar o raw acima.')
  }
}

main().catch(err => { console.error('ERRO:', err?.message ?? err); process.exit(1) })

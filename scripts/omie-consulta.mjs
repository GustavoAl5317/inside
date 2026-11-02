#!/usr/bin/env node
// Consulta de leitura na API do Omie, com as chaves do .env.
//
// O Omie não tem servidor MCP oficial. Este script é o jeito combinado de
// consultar o ERP fora do app (por uma pessoa ou pelo Claude): só aceita
// métodos de leitura, então não cria, altera nem exclui nada.
//
// Uso:
//   node scripts/omie-consulta.mjs <filial> <caminho> <metodo> '<param em JSON>'
//
// Exemplos:
//   node scripts/omie-consulta.mjs barueri produtos/pedidocompra ConsultarPedCompra '{"cNumero":"2601010477"}'
//   node scripts/omie-consulta.mjs es geral/clientes ListarClientes '{"pagina":1,"registros_por_pagina":5}'
//
// filial: barueri (OMIE_APP_KEY_1/OMIE_APP_SECRET_1) ou es (OMIE_APP_KEY_2/OMIE_APP_SECRET_2)
// caminho: o trecho depois de /api/v1/ na URL do serviço, como na documentação do Omie.

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const LEITURA = /^(Listar|Consultar|Pesquisar|Obter)/

/** Lê o .env da raiz sem depender de biblioteca. Não sobrescreve o ambiente. */
function carregaEnv() {
  const arquivo = resolve(process.cwd(), '.env')
  if (!existsSync(arquivo)) return
  for (const linha of readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linha)
    if (!m || linha.trimStart().startsWith('#')) continue
    const valor = m[2].replace(/^(['"])(.*)\1$/, '$2')
    if (process.env[m[1]] === undefined) process.env[m[1]] = valor
  }
}

function sai(mensagem) {
  console.error(mensagem)
  process.exit(1)
}

carregaEnv()

const [filial, caminho, metodo, paramJson = '{}'] = process.argv.slice(2)
if (!filial || !caminho || !metodo) {
  sai("Uso: node scripts/omie-consulta.mjs <barueri|es> <caminho> <metodo> '<param JSON>'")
}

const sufixo = { barueri: '1', es: '2' }[filial.toLowerCase()]
if (!sufixo) sai('Filial deve ser "barueri" ou "es".')

if (!LEITURA.test(metodo)) {
  sai(`"${metodo}" não é método de leitura. Este script só aceita Listar*, Consultar*, Pesquisar* e Obter*.\n` +
      'Gravação no Omie é feita só pelo app (envio ao Omie), nunca por fora.')
}

const appKey = process.env[`OMIE_APP_KEY_${sufixo}`]
const appSecret = process.env[`OMIE_APP_SECRET_${sufixo}`]
if (!appKey || !appSecret) sai(`Faltam OMIE_APP_KEY_${sufixo} e OMIE_APP_SECRET_${sufixo} no .env.`)

let param
try {
  param = JSON.parse(paramJson)
} catch {
  sai('O parâmetro precisa ser um JSON válido, entre aspas simples.')
}

const url = `https://app.omie.com.br/api/v1/${caminho.replace(/^\/+|\/+$/g, '')}/`
const resp = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ call: metodo, app_key: appKey, app_secret: appSecret, param: [param] }),
})
const texto = await resp.text()
try {
  console.log(JSON.stringify(JSON.parse(texto), null, 2))
} catch {
  console.log(texto)
}
if (!resp.ok) process.exit(1)

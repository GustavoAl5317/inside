# Conexões do Claude com o Bitrix24 e o Omie

Como ligar o Claude Code a este projeto para consultar o Bitrix24 e o Omie
durante o desenvolvimento. Verificado em 02/11/2026.

| Sistema | Como o Claude acessa | Login |
| --- | --- | --- |
| Bitrix24 (dados do CRM) | MCP oficial `bitrix24` | OAuth, com a conta de cada pessoa |
| Bitrix24 (documentação da API) | MCP oficial `bitrix24-docs` | nenhum |
| Omie | Não existe MCP oficial. Script de leitura `scripts/omie-consulta.mjs` | chaves do `.env` |

Isto é só para o Claude e para quem desenvolve. O app em produção não usa MCP:
ele fala direto com as APIs REST (webhook do Bitrix e chaves do Omie).

## Bitrix24

Os dois servidores já estão declarados em [`.mcp.json`](../.mcp.json), na raiz
do repositório:

```json
{
  "mcpServers": {
    "bitrix24-docs": { "type": "http", "url": "https://mcp-dev.bitrix24.com/mcp" },
    "bitrix24":      { "type": "http", "url": "https://mcp.bitrix24.com/mcp/" }
  }
}
```

### Primeira conexão

1. Abra o Claude Code na pasta do projeto. Na primeira vez ele pergunta se
   aprova os servidores MCP do `.mcp.json`: aprove os dois.
2. O `bitrix24-docs` já funciona, sem login.
3. Para o `bitrix24`, rode `/mcp`, escolha **bitrix24** e **Authenticate**.
4. O navegador abre o `mcp.bitrix24.com`. Entre no portal
   **interatell.bitrix24.com.br** com a sua conta e autorize.
5. Volte ao Claude Code. Em `/mcp`, o `bitrix24` aparece como conectado.

### Como a autenticação funciona

O servidor responde `401` sem token e publica os metadados OAuth em
`https://mcp.bitrix24.com/.well-known/oauth-authorization-server`:

- fluxo *authorization code* com PKCE (`S256`) e *refresh token*;
- registro dinâmico de cliente (`/oauth/register/mcp/`): o Claude Code se
  cadastra sozinho, não é preciso criar app no Bitrix;
- escopos `auth` e `profile`.

O token fica guardado na máquina de quem autorizou, pelo Claude Code, e nunca
vai para o git. Cada pessoa autoriza com a própria conta, e o MCP enxerga só o
que essa conta enxerga no Bitrix.

### Fora desta pasta

Para ter o MCP do Bitrix em qualquer projeto, cadastre no escopo do usuário:

```bash
claude mcp add --transport http --scope user bitrix24 https://mcp.bitrix24.com/mcp/
```

Depois, `/mcp` e **Authenticate**, como acima.

### Quando parar de funcionar

- "requires authentication" ou `401`: rode `/mcp`, escolha **bitrix24** e
  autentique de novo. O token renova sozinho, mas expira se ficar muito tempo
  sem uso ou se a autorização for revogada no Bitrix.
- O servidor não aparece em `/mcp`: confira se o Claude Code foi aberto na
  raiz do repositório, onde está o `.mcp.json`, e se os servidores do projeto
  foram aprovados.

## Omie

### Não há MCP oficial

O Omie não publica servidor MCP. O que existe são projetos de terceiros (o
pacote npm `@codespar/mcp-omie`, o `omie-mcp` da comunidade e o serviço
hospedado da Vinkius). **Não use as chaves de produção neles sem revisar o
código.** O `app_key` e o `app_secret` dão acesso total ao ERP, inclusive para
criar e excluir pedidos, e um serviço hospedado passaria a guardar essas chaves.

### Como consultar: `scripts/omie-consulta.mjs`

Script de leitura que usa as mesmas chaves do app, lidas do `.env`:

```bash
node scripts/omie-consulta.mjs <barueri|es> <caminho> <metodo> '<param JSON>'
```

```bash
node scripts/omie-consulta.mjs barueri produtos/pedidocompra ConsultarPedCompra '{"cNumero":"2601010477"}'
node scripts/omie-consulta.mjs es geral/clientes ListarClientes '{"pagina":1,"registros_por_pagina":5}'
```

- `barueri` usa `OMIE_APP_KEY_1` e `OMIE_APP_SECRET_1`; `es` usa
  `OMIE_APP_KEY_2` e `OMIE_APP_SECRET_2`.
- `caminho` é o trecho depois de `/api/v1/` na URL do serviço, como na
  documentação do Omie (`geral/clientes`, `produtos/pedido`,
  `produtos/pedidocompra`, `servicos/os`, `produtos/nfconsultar`...).
- Só aceita métodos que começam com `Listar`, `Consultar`, `Pesquisar` ou
  `Obter`. Gravação no Omie é feita só pelo app, pelo envio ao Omie.
- Rode da raiz do projeto, onde está o `.env`. As chaves nunca aparecem na
  saída.

### Cuidado com o limite de consumo

O Omie bloqueia a chave por 30 minutos depois de 10 respostas com erro para o
mesmo IP, chave e método, e cada nova chamada durante o bloqueio prorroga o
bloqueio. "Não existem registros" conta como erro. Duas chamadas ao mesmo
método ao mesmo tempo também dão erro ("Já existe uma requisição desse método
sendo executada"). Por isso:

- faça uma consulta de cada vez, nunca em paralelo;
- pare ao primeiro bloqueio e espere: insistir prorroga;
- a chave é a mesma do app em produção, então um bloqueio causado numa
  consulta também trava os envios ao Omie.

## Onde ficam as credenciais

| O quê | Onde | No git? |
| --- | --- | --- |
| Token OAuth do MCP do Bitrix | Claude Code, na máquina de cada pessoa | não |
| Chaves do Omie | `.env` (modelo em `.env.example`) | não |
| Webhook REST do Bitrix usado pelo app | hoje fixo no código (`lib/actions.ts`, `lib/bitrix-service.ts`) | sim, pendente mover para o `.env` |

Nunca coloque chave, token ou URL de webhook no `.mcp.json`: ele é versionado.

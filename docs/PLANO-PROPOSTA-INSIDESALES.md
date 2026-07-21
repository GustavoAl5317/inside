# Plano — Unificar Proposta + Inside Sales

> Documento de arquitetura. Nada implementado ainda.
> Última revisão: 20/07/2026

---

## 1. Objetivo

Trazer o gerador de propostas (hoje projeto separado em `proposta/`) para dentro do
Inside Sales (Next.js), de forma que:

- O **AM** faça a proposta no mesmo sistema, com o mesmo login.
- Quando o negócio for **ganho**, os dados da proposta aceita **alimentem sozinhos**
  o card do Inside Sales, que nasce em **Backlog**.
- O **Inside Sales confirme** qual proposta foi aceita, **veja os dados** que serão
  usados, e possa **alterar** o que precisar.

## 2. Princípios (não negociáveis)

1. **O manual é caminho de primeira classe.** Nem todo card vem de proposta. O Inside
   Sales precisa continuar criando e preenchendo do zero, sem nenhum atrito extra.
   A proposta é um **atalho opcional**, nunca uma dependência.
2. **Nada entra sem confirmação humana.** Dados da proposta ficam preparados, mas só
   são aplicados quando o Inside Sales confirma.
3. **Histórico do que foi aceito é imutável.** É dele que sai preço, prazo e margem.
4. **Idempotência.** O gatilho de "ganho" pode disparar várias vezes sem duplicar card
   nem atropelar edição já feita.

---

## 3. Situação atual

| | `proposta/` | Inside Sales |
|---|---|---|
| Stack | JS puro + Express (:3001) | Next.js 14 + Neon Postgres |
| Banco | SQLite ou Supabase | Neon |
| Login | chave de painel | sessão por cookie + Bitrix |
| Papéis | — | `insidesales`, `financeiro`, `admin`, `am` |
| Âncora | `dealId` do Bitrix | `bitrix_deal_id` |
| Documento | docxtemplater + PDF (LibreOffice) | — |

**Os dois já giram em torno do mesmo negócio do Bitrix.** É a ponte natural.

Pipeline real (Bitrix SPA DT129):
`Backlog` (`DT129_13:NEW`, "Elaboração de OC") → `Processamento no Omie`

---

## 4. A descoberta que define o de-para

O payload do deal no Inside Sales tem **dois lados**:

```
groups[].products[]               → { partnumber, description, quantity, unitCost, nature }
                                    o que se COMPRA do fornecedor  → gera OC

customers[].productAllocations[]  → { quantity, unitSale }
                                    o que se VENDE ao cliente      → gera OV / OS
```

A **proposta só conhece o lado da venda** (`unitPrice`).

| Dado | Vem da proposta? | Quem preenche |
|---|---|---|
| Cliente (nome, CNPJ, contato, endereços) | ✅ | proposta |
| Itens: partnumber, descrição, quantidade | ✅ | proposta |
| `nature` (HW/SW/LC/ST/SRV) | ✅ *(se capturarmos — ver §8)* | proposta |
| `unitSale` (preço de venda) | ✅ | proposta |
| **`unitCost` (custo)** | ❌ | **Inside Sales** (cotação) |
| **Fornecedor / grupos** | ❌ | **Inside Sales** |

> **Conclusão:** a proposta preenche ~70% do formulário — todo o lado do cliente.
> O **custo e o fornecedor continuam sendo o trabalho do Inside Sales**, que é onde
> ela agrega valor. E é isso que fecha a margem (`unitSale − unitCost`) que alimenta
> a comissão.

Isso é bom: não estamos tirando trabalho de ninguém, estamos tirando **redigitação**.

---

## 5. Modelo de dados (Neon)

```sql
-- Uma proposta ("quote") de um negócio
CREATE TABLE IF NOT EXISTS proposals (
  id                  SERIAL PRIMARY KEY,
  bitrix_deal_id      TEXT NOT NULL,
  quote_id            TEXT,
  am_bitrix_user_id   TEXT NOT NULL,
  title               TEXT,                    -- "Opção A — 10 licenças"
  status              TEXT NOT NULL DEFAULT 'rascunho',
                      -- rascunho | enviada | aceita | recusada | substituida
  draft_payload       JSONB,                   -- autosave, SOBRESCREVE livremente
  accepted_version_id INTEGER,                 -- qual versão o cliente aceitou
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Histórico imutável: cada envio ao cliente congela uma versão
CREATE TABLE IF NOT EXISTS proposal_versions (
  id             SERIAL PRIMARY KEY,
  proposal_id    INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  version        TEXT NOT NULL,                -- "1.0", "1.1"
  version_change TEXT,
  payload        JSONB NOT NULL,               -- snapshot congelado
  created_by     TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Vínculo proposta → card do Inside Sales (o portão de confirmação)
CREATE TABLE IF NOT EXISTS proposal_links (
  id                 SERIAL PRIMARY KEY,
  bitrix_deal_id     TEXT NOT NULL,
  proposal_id        INTEGER REFERENCES proposals(id),
  version_id         INTEGER REFERENCES proposal_versions(id),
  status             TEXT NOT NULL DEFAULT 'pendente',
                     -- pendente | confirmada | dispensada (Inside optou por manual)
  confirmed_by       TEXT,
  confirmed_at       TIMESTAMPTZ,
  divergences        JSONB,                    -- campos alterados vs. proposta
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
```

**Ciclo de vida:**

```
RASCUNHO  ──────────►  ENVIADA (v1.0, v1.1…)  ──────────►  ACEITA
autosave                congela snapshot                    aponta 1 versão
sobrescreve             imutável                            alimenta o Backlog
```

---

## 6. Permissões

Estender o `ROLE_ACCESS` em `components/current-user-provider.tsx`:

```ts
proposta:       ['am', 'insidesales', 'admin'],  // AM cria/edita; IS lê p/ confirmar
proposta_admin: ['admin'],                        // templates, regras, numeração
```

- O **AM enxerga só as propostas dele** (filtro por `am_bitrix_user_id`) — mesmo padrão
  já usado em comissões.
- **Financeiro** não precisa de acesso de edição; vê pelo card/comissão.

---

## 7. Os fluxos

### 7.1 Com proposta (o caminho novo)

```
[AM] cria proposta → autosave (sobrescreve)
     └─ gera documento → congela versão v1.0 → envia ao cliente
     └─ ajusta → v1.1 → reenvia

[Bitrix] negócio vai a GANHO
     └─ webhook → cria/garante card em Backlog
     └─ cria proposal_link (status: pendente)

[Inside Sales] abre o card
     ┌─────────────────────────────────────────────────┐
     │ Este card veio da Proposta PROP-2026-014 v1.2   │
     │ aceita em 18/07 · AM: Renato Ferraro            │
     │                                                 │
     │ [dados que serão preenchidos: cliente, itens,   │
     │  qtd, preço de venda, prazo, pagamento]         │
     │                                                 │
     │ [Confirmar e preencher] [Outra proposta] [Manual]│
     └─────────────────────────────────────────────────┘
     └─ confirma → saveDraft() aplica → edita à vontade
     └─ preenche CUSTO e FORNECEDOR (trabalho dela)
     └─ Processamento → Omie
```

### 7.2 Manual (o caminho que continua igual)

```
[Inside Sales] cria/abre card → formulário em branco → preenche tudo → Omie
```

Sem nenhuma etapa nova. Se não houver proposta vinculada, **o painel de confirmação
nem aparece**. Se houver e ela quiser ignorar, clica em "Preencher do zero"
(`proposal_links.status = 'dispensada'`) e segue como sempre.

### 7.3 Várias propostas no mesmo negócio

Se o AM mandou mais de uma (ex.: "Opção A" e "Opção B"), o painel **lista todas** e o
Inside Sales escolhe qual foi aceita. O sistema **não adivinha** — melhor travar e
perguntar do que subir a proposta errada pro Omie.

---

## 8. `nature` — o ponto que dói se ignorar

O envio ao Omie separa por **natureza** (`app/api/omie/send/route.ts`:
*1 OS por cliente × natureza (SW | LC | ST | SRV)*). No app o campo é `nature`,
default `"HW"`.

A proposta hoje só separa `products` vs `services` — granularidade insuficiente
(não distingue SW de LC de ST de SRV).

**Ação:** capturar `nature` por item já no wizard da proposta. Sem isso, o Inside Sales
reclassifica item a item na mão e o ganho evapora.

---

## 9. Divergências (bônus de alto valor)

Depois de confirmar, se o Inside Sales **alterar** algo que veio da proposta, registrar
em `proposal_links.divergences` e exibir:

> ⚠️ 2 campos diferem da proposta aceita: *valor de venda do item 3*, *prazo de entrega*

**Por que importa:** a comissão sai da margem. Se o preço de venda mudou entre a
proposta aceita e o que foi ao Omie, o financeiro precisa enxergar — hoje essa
diferença é invisível. Já existe `lib/deal-payload-diff.ts` para reaproveitar.

---

## 10. Fases de execução

Ordenadas para **entregar valor antes** da migração pesada do wizard.

### Fase 0 — Pré-requisito (bloqueia tudo)
- Resolver a divergência do git: `main` local (`b20e4fe`) × `origin/main` (`efc9b9e`).
  Os dois implementam "obs obrigatória" e vão conflitar.

### Fase 1 — Fundação de dados (sem mexer no wizard)
- Criar as 3 tabelas (`ensureProposalSchema()`, no padrão de `lib/commission/schema.ts`).
- Server actions de CRUD de proposta + versões.
- `ROLE_ACCESS.proposta`.

### Fase 2 — A ponte (o valor real, mais cedo)
- Webhook/gatilho de **ganho** → cria card em Backlog + `proposal_link` pendente.
- **Painel de confirmação** no formulário + `saveDraft()` no confirmar.
- Mapper `payload da proposta → payload do deal` (§4).
- ✅ Neste ponto já funciona **mesmo com a proposta ainda rodando no Express**,
  desde que ela grave nas tabelas novas.

### Fase 3 — Migrar o wizard para o Next
- Telas: cliente → produtos/serviços → versões → revisão.
- Reaproveitar componentes já existentes (`products-tab`, `customers-tab`…).
- Capturar `nature` por item (§8).
- Maior esforço: `js/docs.js` tem 4.662 linhas.

### Fase 4 — Gerador de documento
- Portar `docxtemplater` + `pizzip` para uma rota API (`runtime = 'nodejs'`).
- PDF: manter LibreOffice no servidor.
- Migrar versionamento SQLite/Supabase → Neon.

### Fase 5 — Desligar o Express
- Remover `proposta/backend`, consolidar deploy e Apache.

---

## 11. Riscos e decisões em aberto

| Risco | Mitigação |
|---|---|
| `js/docs.js` (4.662 linhas) com regra de negócio escondida | Fases 1–2 entregam valor sem tocar nele; migrar por tela |
| Geração de PDF depende de LibreOffice no servidor | Já é assim hoje; manter o binário no deploy |
| Numeração de proposta (`PROP-2026-XXX`) precisa ser única | Sequence no Postgres |
| Proposta aceita mudar depois do card criado | Versão é imutável; nova versão → novo `proposal_link` pendente |

**Em aberto:**
1. A numeração da proposta deve seguir algum padrão existente da Interatell?
2. O AM pode editar proposta depois de ganha, ou trava?
3. `proposta/` vira parte deste repo ou continua repo separado até a Fase 5?

-- ─────────────────────────────────────────────────────────────────────────────
-- Módulo de Comissionamento (Omie → AM)
--
-- Modelo: a TAXA vem da faixa de margem (margem sobre a venda total, herdada do
-- processo bp-49 do Bitrix). A BASE de pagamento é o que o cliente pagou no mês
-- (recebimentos do Omie, financas/mf, natureza R). Comissão = taxa × recebido.
--
-- Rodar via: node scripts/run-migrations.js  (as tabelas também são criadas sob
-- demanda por lib/commission/schema.ts → ensureCommissionSchema()).
-- ─────────────────────────────────────────────────────────────────────────────

-- Novo papel "am" (Account Manager) no controle de acesso
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
ALTER TABLE app_users ADD  CONSTRAINT app_users_role_check
  CHECK (role IN ('insidesales', 'financeiro', 'admin', 'am'));

-- Faixas de margem → taxa de comissão (editável pelo admin)
CREATE TABLE IF NOT EXISTS commission_tiers (
  id          SERIAL PRIMARY KEY,
  min_margin  NUMERIC(7,3) NOT NULL,          -- inclusive
  max_margin  NUMERIC(7,3),                   -- inclusive; NULL = sem teto
  rate        NUMERIC(9,5) NOT NULL,          -- 0.027 = 2,7%
  label       VARCHAR(80)  NOT NULL,
  sort        INT          NOT NULL DEFAULT 0,
  active      BOOLEAN      NOT NULL DEFAULT TRUE
);

-- Configuração geral (linha única id = 1)
CREATE TABLE IF NOT EXISTS commission_settings (
  id               INT PRIMARY KEY DEFAULT 1,
  base_mode        VARCHAR(20)  NOT NULL DEFAULT 'received',  -- received | invoiced
  min_margin_gate  NUMERIC(7,3) NOT NULL DEFAULT 10,          -- portão "margem > X" (bp-49)
  default_margin   NUMERIC(7,3) NOT NULL DEFAULT 0,           -- fallback sem negócio vinculado
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_by       VARCHAR(50),
  CONSTRAINT commission_settings_singleton CHECK (id = 1)
);

-- De-para: código de vendedor no Omie → AM do app (junta duplicados)
CREATE TABLE IF NOT EXISTS commission_vendors (
  id                  SERIAL PRIMARY KEY,
  omie_vendor_code    VARCHAR(30)  NOT NULL UNIQUE,
  omie_vendor_name    VARCHAR(255),
  branch              VARCHAR(20),                 -- barueri | es (informativo)
  app_user_bitrix_id  VARCHAR(50),                 -- AM que recebe (NULL até mapear)
  canonical_name      VARCHAR(255),                -- nome consolidado
  active              BOOLEAN      NOT NULL DEFAULT TRUE,
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_commission_vendors_am ON commission_vendors(app_user_bitrix_id);

-- Período de apuração (mês)
CREATE TABLE IF NOT EXISTS commission_periods (
  id           SERIAL PRIMARY KEY,
  year         INT NOT NULL,
  month        INT NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'open',   -- open | closed | approved
  synced_at    TIMESTAMPTZ,
  closed_at    TIMESTAMPTZ,
  closed_by    VARCHAR(50),
  approved_at  TIMESTAMPTZ,
  approved_by  VARCHAR(50),
  totals       JSONB,
  UNIQUE (year, month)
);

-- Recebimentos sincronizados + comissão calculada (1 linha por parcela paga)
CREATE TABLE IF NOT EXISTS commission_receipts (
  id                  SERIAL PRIMARY KEY,
  period_id           INT NOT NULL REFERENCES commission_periods(id) ON DELETE CASCADE,
  omie_key            VARCHAR(90) NOT NULL,        -- nCodTitulo:parcela:branch (idempotência)
  branch              VARCHAR(20),
  omie_vendor_code    VARCHAR(30),
  omie_vendor_name    VARCHAR(255),
  app_user_bitrix_id  VARCHAR(50),
  client_name         VARCHAR(255),
  client_cnpj         VARCHAR(30),
  nf                  VARCHAR(40),
  pedido              VARCHAR(40),
  parcela             VARCHAR(20),
  paid_at             DATE,
  paid_value          NUMERIC(14,2) NOT NULL DEFAULT 0,
  margin              NUMERIC(7,3),
  rate                NUMERIC(9,5),
  commission_value    NUMERIC(14,2) NOT NULL DEFAULT 0,
  deal_id             INT,
  UNIQUE (period_id, omie_key)
);
CREATE INDEX IF NOT EXISTS idx_commission_receipts_period ON commission_receipts(period_id);
CREATE INDEX IF NOT EXISTS idx_commission_receipts_am ON commission_receipts(app_user_bitrix_id);

-- Trilha de auditoria (histórico de sync / fechamento / aprovação)
CREATE TABLE IF NOT EXISTS commission_audit (
  id          SERIAL PRIMARY KEY,
  period_id   INT REFERENCES commission_periods(id) ON DELETE CASCADE,
  action      VARCHAR(40) NOT NULL,   -- synced | closed | reopened | approved | config
  actor       VARCHAR(50),
  actor_name  VARCHAR(255),
  detail      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_commission_audit_period ON commission_audit(period_id, created_at DESC);

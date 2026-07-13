-- Tabelas de autenticação/permissões e de solicitações de atualização.
-- Papéis: 'insidesales' | 'financeiro' | 'admin'

CREATE TABLE IF NOT EXISTS app_users (
  id              SERIAL PRIMARY KEY,
  bitrix_user_id  VARCHAR(50) NOT NULL UNIQUE,
  name            VARCHAR(255) NOT NULL,
  email           VARCHAR(255),
  role            VARCHAR(20)  NOT NULL DEFAULT 'insidesales'
                    CHECK (role IN ('insidesales', 'financeiro', 'admin')),
  active          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_by      VARCHAR(50)
);

CREATE INDEX IF NOT EXISTS idx_app_users_bitrix_user_id ON app_users(bitrix_user_id);
CREATE INDEX IF NOT EXISTS idx_app_users_role           ON app_users(role);

-- Solicitações de aprovação para ATUALIZAR um deal já enviado ao Omie.
-- Fluxo: insideSales cria (pending) -> financeiro aprova/recusa -> insideSales
-- atualiza (a aprovação é "consumida" ao concluir a atualização).
CREATE TABLE IF NOT EXISTS update_requests (
  id                 SERIAL PRIMARY KEY,
  deal_id            INTEGER REFERENCES deals(id) ON DELETE CASCADE,
  requested_by       VARCHAR(50),
  requested_by_name  VARCHAR(255),
  status             VARCHAR(20) NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'approved', 'rejected')),
  reason             TEXT,
  reviewed_by        VARCHAR(50),
  reviewed_by_name   VARCHAR(255),
  review_note        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at        TIMESTAMPTZ,
  consumed_at        TIMESTAMPTZ,
  pending_patch      JSONB,
  order_kind         VARCHAR(10),
  order_numero       VARCHAR(50),
  order_branch       VARCHAR(20)
);

ALTER TABLE update_requests ADD COLUMN IF NOT EXISTS pending_patch JSONB;
-- Aprovação da etapa "Pedido Omie" é por número, sem exigir deal vinculado
ALTER TABLE update_requests ALTER COLUMN deal_id DROP NOT NULL;
ALTER TABLE update_requests ADD COLUMN IF NOT EXISTS order_kind VARCHAR(10);
ALTER TABLE update_requests ADD COLUMN IF NOT EXISTS order_numero VARCHAR(50);
ALTER TABLE update_requests ADD COLUMN IF NOT EXISTS order_branch VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_update_requests_deal_id ON update_requests(deal_id);
CREATE INDEX IF NOT EXISTS idx_update_requests_status  ON update_requests(status);
CREATE INDEX IF NOT EXISTS idx_update_requests_created_at ON update_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_update_requests_order_numero ON update_requests(order_numero);

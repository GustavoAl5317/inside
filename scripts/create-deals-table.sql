-- Tabela principal de deals (um deal = um formulário completo)
-- Armazena o payload completo: grupos de fornecedores + clientes/filiais
CREATE TABLE IF NOT EXISTS deals (
  id                  SERIAL PRIMARY KEY,
  bitrix_deal_id      VARCHAR(100),
  status              VARCHAR(50)  NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'sent', 'failed')),
  payload             JSONB        NOT NULL,
  current_stage_id    VARCHAR(200),
  current_stage_name  VARCHAR(500),
  omie_response       JSONB,
  error_message       TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deals_bitrix_deal_id ON deals(bitrix_deal_id);
CREATE INDEX IF NOT EXISTS idx_deals_status          ON deals(status);
CREATE INDEX IF NOT EXISTS idx_deals_created_at      ON deals(created_at DESC);

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS deals_set_updated_at ON deals;
CREATE TRIGGER deals_set_updated_at
  BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Estrutura esperada do JSONB payload:
-- {
--   "bitrixDealId": "2024.1082",
--   "business": {
--     "name": "...",
--     "purchaseOrderDate": "YYYY-MM-DD",
--     "deliveryDeadline": "YYYY-MM-DD",
--     "purchasePaymentCondition": "001",
--     "expectedBillingDate": "YYYY-MM-DD",
--     "salePaymentCondition": "001"
--   },
--   "interatell": { "cnpj": "...", "name": "...", ... },
--   "supplierGroups": [
--     {
--       "localId": "uuid",
--       "supplier": { "cnpj": "...", "name": "...", ... },
--       "products": [
--         { "id": 1, "partnumber": "...", "description": "...",
--           "quantity": 2, "unitCost": 100, "unitSale": 150,
--           "cfop": "...", "nature": "HW", "ncm": "..." }
--       ]
--     }
--   ],
--   "customers": [
--     {
--       "localId": "uuid",
--       "customer": { "cnpj": "...", "name": "...", ... },
--       "assignedGroupIds": ["uuid-do-grupo-a", "uuid-do-grupo-b"]
--     }
--   ],
--   "notes": { "internalNotes": "...", "externalNotes": "..." }
-- }

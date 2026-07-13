-- Criar tabela para histórico de processos
CREATE TABLE IF NOT EXISTS process_history (
  id SERIAL PRIMARY KEY,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  bitrix_deal_id VARCHAR(50),
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'approved', 'sent', 'failed')),
  current_stage_id VARCHAR(100),
  current_stage_name VARCHAR(255),
  approval_check_result JSONB,
  omie_response JSONB,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMP WITH TIME ZONE,
  
  -- Índices para melhor performance
  INDEX idx_process_history_transaction_id (transaction_id),
  INDEX idx_process_history_status (status),
  INDEX idx_process_history_bitrix_deal_id (bitrix_deal_id),
  INDEX idx_process_history_created_at (created_at)
);

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_process_history_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_process_history_updated_at
  BEFORE UPDATE ON process_history
  FOR EACH ROW
  EXECUTE FUNCTION update_process_history_updated_at();

-- Adicionar campo bitrix_deal_id na tabela transactions se não existir
ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS bitrix_deal_id VARCHAR(50);

-- Criar índice para o novo campo
CREATE INDEX IF NOT EXISTS idx_transactions_bitrix_deal_id ON transactions(bitrix_deal_id);
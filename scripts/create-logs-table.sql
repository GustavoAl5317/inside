-- Migration para criar tabela de logs persistentes
CREATE TABLE IF NOT EXISTS logs (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL,
  level VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  source VARCHAR(50) NOT NULL,
  transaction_id VARCHAR(100),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_logs_transaction_id ON logs(transaction_id);
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);

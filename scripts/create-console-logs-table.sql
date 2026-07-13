CREATE TABLE IF NOT EXISTS console_logs (
  id SERIAL PRIMARY KEY,
  message TEXT NOT NULL,
  level TEXT NOT NULL,
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source TEXT,
  transaction_id INTEGER,
  additional_data JSONB
);

CREATE INDEX IF NOT EXISTS console_logs_timestamp_idx ON console_logs (timestamp);
CREATE INDEX IF NOT EXISTS console_logs_transaction_id_idx ON console_logs (transaction_id);
CREATE INDEX IF NOT EXISTS console_logs_source_idx ON console_logs (source);
CREATE INDEX IF NOT EXISTS console_logs_level_idx ON console_logs (level);

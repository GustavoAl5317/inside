-- Adicionar coluna state à tabela transaction_items
ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS state VARCHAR(10);
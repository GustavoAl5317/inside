-- Adicionar coluna notes à tabela transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS notes TEXT;
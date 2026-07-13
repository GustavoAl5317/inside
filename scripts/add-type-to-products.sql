-- Adiciona a coluna 'type' à tabela 'products' se ela não existir
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'products' AND column_name = 'type'
    ) THEN
        ALTER TABLE products ADD COLUMN type VARCHAR(10);
    END IF;
END $$;

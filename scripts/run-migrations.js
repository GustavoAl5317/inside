const { neon } = require('@neondatabase/serverless');
require('dotenv').config();

const sql = neon(process.env.DATABASE_URL);

async function runMigrations() {
  try {
    console.log('🚀 Iniciando migrações do banco de dados...');

    // Criar tabela process_history
    console.log('📋 Criando tabela process_history...');
    await sql`
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
        sent_at TIMESTAMP WITH TIME ZONE
      )
    `;

    // Criar índices
    console.log('📊 Criando índices...');
    await sql`CREATE INDEX IF NOT EXISTS idx_process_history_transaction_id ON process_history(transaction_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_process_history_status ON process_history(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_process_history_bitrix_deal_id ON process_history(bitrix_deal_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_process_history_created_at ON process_history(created_at)`;

    // Criar função para atualizar updated_at
    console.log('⚙️ Criando função de trigger...');
    await sql`
      CREATE OR REPLACE FUNCTION update_process_history_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `;

    // Criar trigger
    console.log('🔄 Criando trigger...');
    await sql`
      DROP TRIGGER IF EXISTS trigger_update_process_history_updated_at ON process_history
    `;
    await sql`
      CREATE TRIGGER trigger_update_process_history_updated_at
        BEFORE UPDATE ON process_history
        FOR EACH ROW
        EXECUTE FUNCTION update_process_history_updated_at()
    `;

    // Adicionar campo bitrix_deal_id na tabela transactions
    console.log('🔧 Adicionando campo bitrix_deal_id na tabela transactions...');
    await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS bitrix_deal_id VARCHAR(50)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_transactions_bitrix_deal_id ON transactions(bitrix_deal_id)`;

    // Adicionar coluna payload_json na tabela transactions para armazenar o payload completo
    console.log('🔧 Adicionando coluna payload_json na tabela transactions...');
    await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payload_json JSONB`;

    // Tabelas de autenticação / permissões
    console.log('🔐 Criando tabelas de autenticação (app_users, update_requests)...');
    await sql`
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
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_app_users_bitrix_user_id ON app_users(bitrix_user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_app_users_role ON app_users(role)`;

    await sql`
      CREATE TABLE IF NOT EXISTS update_requests (
        id                 SERIAL PRIMARY KEY,
        deal_id            INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
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
        consumed_at        TIMESTAMPTZ
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_update_requests_deal_id ON update_requests(deal_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_update_requests_status ON update_requests(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_update_requests_created_at ON update_requests(created_at DESC)`;

    // Rascunho da edição parcial (Pedido Omie) para retomar após aprovação
    await sql`ALTER TABLE update_requests ADD COLUMN IF NOT EXISTS pending_patch JSONB`;

    // Aprovação da etapa "Pedido Omie" é por número, sem exigir deal vinculado
    await sql`ALTER TABLE update_requests ALTER COLUMN deal_id DROP NOT NULL`;
    await sql`ALTER TABLE update_requests ADD COLUMN IF NOT EXISTS order_kind VARCHAR(10)`;
    await sql`ALTER TABLE update_requests ADD COLUMN IF NOT EXISTS order_numero VARCHAR(50)`;
    await sql`ALTER TABLE update_requests ADD COLUMN IF NOT EXISTS order_branch VARCHAR(20)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_update_requests_order_numero ON update_requests(order_numero)`;

    console.log('✅ Migrações concluídas com sucesso!');

    // Verificar se as tabelas foram criadas
    console.log('🔍 Verificando estrutura das tabelas...');

    const processHistoryColumns = await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'process_history'
      ORDER BY ordinal_position
    `;

    console.log('📋 Colunas da tabela process_history:');
    processHistoryColumns.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
    });

    const transactionColumns = await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'transactions' AND column_name IN ('bitrix_deal_id', 'payload_json')
    `;

    if (transactionColumns.some(col => col.column_name === 'bitrix_deal_id')) {
      console.log('✅ Campo bitrix_deal_id adicionado à tabela transactions');
    } else {
      console.log('❌ Campo bitrix_deal_id não foi adicionado à tabela transactions');
    }

    if (transactionColumns.some(col => col.column_name === 'payload_json')) {
      console.log('✅ Campo payload_json adicionado à tabela transactions');
    } else {
      console.log('❌ Campo payload_json não foi adicionado à tabela transactions');
    }

  } catch (error) {
    console.error('❌ Erro durante as migrações:', error);
    process.exit(1);
  }
}

runMigrations();
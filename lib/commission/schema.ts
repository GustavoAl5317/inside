import 'server-only'
import { sql } from '@/lib/db'

/**
 * Cria (idempotente) as tabelas do módulo de comissionamento e semeia as faixas
 * de margem padrão herdadas do processo bp-49 do Bitrix. Chamada sob demanda pelas
 * server actions, então o módulo funciona sem rodar migração manual.
 */
let ensured = false

export async function ensureCommissionSchema(): Promise<void> {
  if (ensured) return

  // Novo papel "am" no CHECK de app_users (ignora se a tabela ainda não existe)
  try {
    await sql`ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check`
    await sql`ALTER TABLE app_users ADD CONSTRAINT app_users_role_check
      CHECK (role IN ('insidesales', 'financeiro', 'admin', 'am'))`
  } catch { /* app_users pode não existir em ambiente novo */ }

  await sql`
    CREATE TABLE IF NOT EXISTS commission_tiers (
      id SERIAL PRIMARY KEY,
      min_margin NUMERIC(7,3) NOT NULL,
      max_margin NUMERIC(7,3),
      rate NUMERIC(9,5) NOT NULL,
      label VARCHAR(80) NOT NULL,
      sort INT NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE
    )`

  await sql`
    CREATE TABLE IF NOT EXISTS commission_settings (
      id INT PRIMARY KEY DEFAULT 1,
      base_mode VARCHAR(20) NOT NULL DEFAULT 'received',
      min_margin_gate NUMERIC(7,3) NOT NULL DEFAULT 10,
      default_margin NUMERIC(7,3) NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by VARCHAR(50),
      CONSTRAINT commission_settings_singleton CHECK (id = 1)
    )`

  await sql`
    CREATE TABLE IF NOT EXISTS commission_vendors (
      id SERIAL PRIMARY KEY,
      omie_vendor_code VARCHAR(30) NOT NULL UNIQUE,
      omie_vendor_name VARCHAR(255),
      branch VARCHAR(20),
      app_user_bitrix_id VARCHAR(50),
      canonical_name VARCHAR(255),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  await sql`CREATE INDEX IF NOT EXISTS idx_commission_vendors_am ON commission_vendors(app_user_bitrix_id)`

  await sql`
    CREATE TABLE IF NOT EXISTS commission_periods (
      id SERIAL PRIMARY KEY,
      year INT NOT NULL,
      month INT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      synced_at TIMESTAMPTZ,
      closed_at TIMESTAMPTZ,
      closed_by VARCHAR(50),
      approved_at TIMESTAMPTZ,
      approved_by VARCHAR(50),
      totals JSONB,
      UNIQUE (year, month)
    )`

  await sql`
    CREATE TABLE IF NOT EXISTS commission_receipts (
      id SERIAL PRIMARY KEY,
      period_id INT NOT NULL REFERENCES commission_periods(id) ON DELETE CASCADE,
      omie_key VARCHAR(90) NOT NULL,
      branch VARCHAR(20),
      omie_vendor_code VARCHAR(30),
      omie_vendor_name VARCHAR(255),
      app_user_bitrix_id VARCHAR(50),
      client_name VARCHAR(255),
      client_cnpj VARCHAR(30),
      nf VARCHAR(40),
      pedido VARCHAR(40),
      parcela VARCHAR(20),
      paid_at DATE,
      paid_value NUMERIC(14,2) NOT NULL DEFAULT 0,
      margin NUMERIC(7,3),
      rate NUMERIC(9,5),
      commission_value NUMERIC(14,2) NOT NULL DEFAULT 0,
      deal_id INT,
      UNIQUE (period_id, omie_key)
    )`
  await sql`CREATE INDEX IF NOT EXISTS idx_commission_receipts_period ON commission_receipts(period_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_commission_receipts_am ON commission_receipts(app_user_bitrix_id)`

  await sql`
    CREATE TABLE IF NOT EXISTS commission_audit (
      id SERIAL PRIMARY KEY,
      period_id INT REFERENCES commission_periods(id) ON DELETE CASCADE,
      action VARCHAR(40) NOT NULL,
      actor VARCHAR(50),
      actor_name VARCHAR(255),
      detail TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  await sql`CREATE INDEX IF NOT EXISTS idx_commission_audit_period ON commission_audit(period_id, created_at DESC)`

  // Colunas adicionadas após a 1ª versão (idempotente)
  await sql`ALTER TABLE commission_settings ADD COLUMN IF NOT EXISTS use_bitrix_margin BOOLEAN NOT NULL DEFAULT TRUE`
  await sql`ALTER TABLE commission_settings ADD COLUMN IF NOT EXISTS ignore_unmapped BOOLEAN NOT NULL DEFAULT FALSE`
  await sql`ALTER TABLE commission_receipts ADD COLUMN IF NOT EXISTS margin_source VARCHAR(16)`
  await sql`ALTER TABLE commission_receipts ADD COLUMN IF NOT EXISTS num_ctr VARCHAR(40)`

  // Settings default (linha única)
  await sql`INSERT INTO commission_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`

  // Faixas padrão (bp-49) — só semeia se estiver vazio
  const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM commission_tiers`
  if (Number(count) === 0) {
    const seed: Array<[number, number | null, number, string]> = [
      [0, 5.999, 0, 'Abaixo de 6%'],
      [6, 6.999, 0.002, '6% a 6,99%'],
      [7, 7.999, 0.005, '7% a 7,99%'],
      [8, 12.999, 0.007, '8% a 12,99%'],
      [13, 13.999, 0.015, '13% a 13,99%'],
      [14, 14.999, 0.021, '14% a 14,99%'],
      [15, 16.999, 0.024, '15% a 16,99%'],
      [17, null, 0.027, 'Acima de 17%'],
    ]
    for (let i = 0; i < seed.length; i++) {
      const [mn, mx, rate, label] = seed[i]
      await sql`
        INSERT INTO commission_tiers (min_margin, max_margin, rate, label, sort)
        VALUES (${mn}, ${mx}, ${rate}, ${label}, ${i})`
    }
  }

  ensured = true
}

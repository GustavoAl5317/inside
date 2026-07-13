const { neon } = require('@neondatabase/serverless');
require('dotenv').config();

const sql = neon(process.env.DATABASE_URL);

const PURCHASE = [
  { code: 'A28', name: 'Para 28 Dias' },
  { code: 'A30', name: 'Para 30 Dias' },
  { code: 'A45', name: 'Para 45 Dias' },
  { code: 'A60', name: 'Para 60 Dias' },
  { code: 'A74', name: 'Para 75 Dias' },
  { code: 'A90', name: 'Para 90 Dias' },
  { code: 'B20', name: 'Para 120 Dias' },
  { code: 'B50', name: 'Para 150 Dias' },
  { code: 'S07', name: '30/45/60 Dias' },
  { code: 'S30', name: '30/60/90 Dias' },
  { code: 'S53', name: 'Para 30/60/90/120' },
  { code: 'S75', name: 'Para 1/30/60/90' },
  { code: '000', name: 'Para A Vista' },
  { code: '001', name: 'Para 1 parcela' },
  { code: '002', name: 'Para 2 parcelas' },
  { code: '003', name: 'Para 3 parcelas' },
  { code: '004', name: 'Para 4 parcelas' },
  { code: '005', name: 'Para 5 parcelas' },
  { code: '006', name: 'Para 6 parcelas' },
  { code: '007', name: 'Para 7 parcelas' },
  { code: '008', name: 'Para 8 parcelas' },
  { code: '009', name: 'Para 9 parcelas' },
  { code: '010', name: 'Para 10 parcelas' },
  { code: '012', name: 'Para 12 parcelas' },
  { code: '024', name: 'Para 24 parcelas' },
  { code: '036', name: 'Para 36 parcelas' },
  { code: '048', name: 'Para 48 parcelas' },
];

const SALE = [
  { code: 'A28', name: 'Para 28 Dias' },
  { code: 'T54', name: 'Para 30 Dias' },
  { code: 'A45', name: 'Para 45 Dias' },
  { code: 'A60', name: 'Para 60 Dias' },
  { code: 'A74', name: 'Para 75 Dias' },
  { code: 'A90', name: 'Para 90 Dias' },
  { code: 'B20', name: 'Para 120 Dias' },
  { code: 'B50', name: 'Para 150 Dias' },
  { code: 'S23', name: '30/45/60 Dias' },
  { code: 'S18', name: '30/60/90 Dias' },
  { code: 'S25', name: 'Para 30/60/90/120' },
  { code: 'P66', name: 'Para 1/30/60/90' },
  { code: '000', name: 'Para A Vista' },
  { code: '001', name: 'Para 1 parcela' },
  { code: '002', name: 'Para 2 parcelas' },
  { code: '003', name: 'Para 3 parcelas' },
  { code: '004', name: 'Para 4 parcelas' },
  { code: '005', name: 'Para 5 parcelas' },
  { code: '006', name: 'Para 6 parcelas' },
  { code: '007', name: 'Para 7 parcelas' },
  { code: '008', name: 'Para 8 parcelas' },
  { code: '009', name: 'Para 9 parcelas' },
  { code: '010', name: 'Para 10 parcelas' },
  { code: '012', name: 'Para 12 parcelas' },
  { code: '024', name: 'Para 24 parcelas' },
  { code: '036', name: 'Para 36 parcelas' },
  { code: '048', name: 'Para 48 parcelas' },
];

async function seed() {
  console.log('🚀 Iniciando seed de condições de pagamento...');
  let inserted = 0, updated = 0;

  const upsert = async (entries, type) => {
    for (const e of entries) {
      const existing = await sql`
        SELECT id FROM payment_conditions WHERE code = ${e.code} AND type = ${type}
      `;
      if (existing.length > 0) {
        await sql`
          UPDATE payment_conditions SET name = ${e.name}, updated_at = CURRENT_TIMESTAMP
          WHERE code = ${e.code} AND type = ${type}
        `;
        updated++;
      } else {
        await sql`
          INSERT INTO payment_conditions (code, name, days, type)
          VALUES (${e.code}, ${e.name}, ${''}, ${type})
        `;
        inserted++;
      }
    }
  };

  await upsert(PURCHASE, 'purchase');
  console.log(`  ✅ Compra: ${PURCHASE.length} processadas`);

  await upsert(SALE, 'sale');
  console.log(`  ✅ Venda: ${SALE.length} processadas`);

  console.log(`\n🎉 Concluído! ${inserted} inseridas, ${updated} atualizadas.`);
}

seed().catch(e => { console.error('❌', e); process.exit(1); });

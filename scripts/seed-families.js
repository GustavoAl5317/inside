const { neon } = require('@neondatabase/serverless');
require('dotenv').config();

const sql = neon(process.env.DATABASE_URL);

const FAMILIES = [
  // ── BARUERI (SP) ──────────────────────────────────────────────────────────
  { name: 'Aruba - Hardware',      omie_code: '2081927710', state: 'SP' },
  { name: 'Aruba - Licença',       omie_code: '2081927725', state: 'SP' },
  { name: 'Aruba - Software',      omie_code: '2081927797', state: 'SP' },
  { name: 'Checkpoint - Hardware', omie_code: '2081928362', state: 'SP' },
  { name: 'Checkpoint - Licença',  omie_code: '2081928392', state: 'SP' },
  { name: 'Checkpoint - Software', omie_code: '2081928423', state: 'SP' },
  { name: 'Cisco - Hardware',      omie_code: '2081928474', state: 'SP' },
  { name: 'Cisco - Licença',       omie_code: '2081928489', state: 'SP' },
  { name: 'Cisco - Software',      omie_code: '2081928499', state: 'SP' },
  { name: 'Fortinet - Hardware',   omie_code: '2081928508', state: 'SP' },
  { name: 'Fortinet - Licença',    omie_code: '2081928516', state: 'SP' },
  { name: 'Fortinet - Software',   omie_code: '2081928547', state: 'SP' },
  { name: 'Furukawa - Hardware',   omie_code: '2101313207', state: 'SP' },
  { name: 'Furukawa - Licença',    omie_code: '2101313397', state: 'SP' },
  { name: 'Furukawa - Software',   omie_code: '2101314357', state: 'SP' },
  { name: 'HP - Hardware',         omie_code: '2081928554', state: 'SP' },
  { name: 'HP - Licença',          omie_code: '2081928561', state: 'SP' },
  { name: 'HP - Software',         omie_code: '2081928580', state: 'SP' },
  { name: 'HPE - Hardware',        omie_code: '2163576450', state: 'SP' },
  { name: 'HPE - Licença',         omie_code: '2163576529', state: 'SP' },
  { name: 'HPE - Software',        omie_code: '2163576959', state: 'SP' },
  { name: 'Intelbras - Hardware',  omie_code: '2101375261', state: 'SP' },
  { name: 'Intelbras - Licença',   omie_code: '2101375369', state: 'SP' },
  { name: 'Intelbras - Software',  omie_code: '2101375342', state: 'SP' },
  { name: 'Logitech - Hardware',   omie_code: '2081928583', state: 'SP' },
  { name: 'Logitech - Licença',    omie_code: '2081928600', state: 'SP' },
  { name: 'Logitech - Software',   omie_code: '2081928624', state: 'SP' },
  { name: 'Microsoft - Hardware',  omie_code: '2081928639', state: 'SP' },
  { name: 'Microsoft - Licença',   omie_code: '2081928677', state: 'SP' },
  { name: 'Microsoft - Software',  omie_code: '2081928701', state: 'SP' },
  { name: 'Outros - Fami',         omie_code: '2164790403', state: 'SP' },
  { name: 'Palo Alto - Hardware',  omie_code: '2081928719', state: 'SP' },
  { name: 'Palo Alto - Licença',   omie_code: '2081928724', state: 'SP' },
  { name: 'Palo Alto - Software',  omie_code: '2081928739', state: 'SP' },
  { name: 'Poly - Hardware',       omie_code: '2081928825', state: 'SP' },
  { name: 'Poly - Serviços',       omie_code: '2081928836', state: 'SP' },
  { name: 'Poly - Software',       omie_code: '2081928847', state: 'SP' },
  { name: 'Vmware - Software',     omie_code: '2093070670', state: 'SP' },
  { name: 'Yealink - Hardware',    omie_code: '2101377412', state: 'SP' },
  { name: 'Yealink - Licença',     omie_code: '2101377485', state: 'SP' },
  { name: 'Yealink - Software',    omie_code: '2101377471', state: 'SP' },

  // ── ESPIRITO SANTO (ES) ───────────────────────────────────────────────────
  { name: 'Aruba - Hardware',      omie_code: '5193041599', state: 'ES' },
  { name: 'Checkpoint - Hardware', omie_code: '5193055171', state: 'ES' },
  { name: 'Cisco - Hardware',      omie_code: '5193055403', state: 'ES' },
  { name: 'Fortinet - Hardware',   omie_code: '5193055497', state: 'ES' },
  { name: 'Furukawa - Hardware',   omie_code: '5226919005', state: 'ES' },
  { name: 'HP - Hardware',         omie_code: '5193056281', state: 'ES' },
  { name: 'HPE - Hardware',        omie_code: '5409033867', state: 'ES' },
  { name: 'Intelbras - Hardware',  omie_code: '5227063785', state: 'ES' },
  { name: 'Logitech - Hardware',   omie_code: '5193056425', state: 'ES' },
  { name: 'Microsoft - Hardware',  omie_code: '5407897042', state: 'ES' },
  { name: 'Outros - Fami',         omie_code: '5411396394', state: 'ES' },
  { name: 'Poly - Hardware',       omie_code: '5193057202', state: 'ES' },
  { name: 'Yealink - Hardware',    omie_code: '5227091521', state: 'ES' },
];

async function seedFamilies() {
  try {
    console.log('🚀 Iniciando migração e seed de famílias...');

    // 1. Adicionar coluna omie_code se não existir
    console.log('🔧 Adicionando coluna omie_code na tabela families...');
    await sql`ALTER TABLE families ADD COLUMN IF NOT EXISTS omie_code VARCHAR(20)`;
    console.log('✅ Coluna omie_code OK');

    // 2. Inserir famílias (upsert por name + state)
    console.log(`📥 Inserindo ${FAMILIES.length} famílias...`);
    let inserted = 0, updated = 0;

    for (const f of FAMILIES) {
      const existing = await sql`
        SELECT id FROM families WHERE name = ${f.name} AND state = ${f.state}
      `;
      if (existing.length > 0) {
        await sql`
          UPDATE families SET omie_code = ${f.omie_code}, updated_at = CURRENT_TIMESTAMP
          WHERE name = ${f.name} AND state = ${f.state}
        `;
        updated++;
      } else {
        await sql`
          INSERT INTO families (name, state, omie_code) VALUES (${f.name}, ${f.state}, ${f.omie_code})
        `;
        inserted++;
      }
    }

    console.log(`✅ ${inserted} famílias inseridas, ${updated} atualizadas`);
    console.log('🎉 Seed concluído com sucesso!');

  } catch (error) {
    console.error('❌ Erro durante o seed:', error);
    process.exit(1);
  }
}

seedFamilies();

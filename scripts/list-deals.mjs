import 'dotenv/config'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL)
const rows = await sql`
  SELECT
    id,
    status,
    bitrix_deal_id,
    payload->'business'->>'name' AS negocio,
    payload->'business'->>'commercialProposal' AS proposta,
    omie_response
  FROM deals
  ORDER BY id
`

for (const r of rows) {
  const omie = typeof r.omie_response === 'string' ? JSON.parse(r.omie_response) : r.omie_response
  const resumo = omie?.resumo
  const oc = resumo?.oc?.map((x) => x.numero).filter(Boolean).join(', ') || '—'
  const ov = resumo?.ov?.map((x) => x.numero).filter(Boolean).join(', ') || '—'
  console.log(
    `#${r.id} | ${r.status} | Bitrix: ${r.bitrix_deal_id ?? '—'} | ${r.negocio ?? '—'} | Proposta: ${r.proposta ?? '—'} | OC: ${oc} | OV: ${ov}`,
  )
}
console.log(`\nTotal: ${rows.length} card(s)`)

import { NextResponse } from "next/server"
import { sql } from "@/lib/db"

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const logs = await sql`
      SELECT 
        wl.*,
        t.status as transaction_status,
        b.name as business_name
      FROM webhook_logs wl
      JOIN transactions t ON wl.transaction_id = t.id
      JOIN businesses b ON t.business_id = b.id
      ORDER BY wl.created_at DESC
    `

    return NextResponse.json({
      success: true,
      logs,
    })
  } catch (error) {
    console.error("Erro ao buscar logs de webhook:", error)
    return NextResponse.json(
      {
        error: "Erro ao buscar logs de webhook",
        details: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 500 },
    )
  }
}

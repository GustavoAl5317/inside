import { NextResponse } from "next/server"
import { sql } from "@/lib/db"

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const transactionId = searchParams.get("transactionId")

    if (!transactionId) {
      return NextResponse.json({ error: "ID da transação não fornecido" }, { status: 400 })
    }

    const logs = await sql`
      SELECT 
        wl.*,
        t.status as transaction_status,
        b.name as business_name
      FROM webhook_logs wl
      JOIN transactions t ON wl.transaction_id = t.id
      JOIN businesses b ON t.business_id = b.id
      WHERE wl.transaction_id = ${transactionId}
      ORDER BY wl.created_at DESC
    `

    return NextResponse.json({
      success: true,
      logs,
    })
  } catch (error) {
    console.error("Erro ao buscar logs de webhook por transação:", error)
    return NextResponse.json(
      {
        error: "Erro ao buscar logs de webhook",
        details: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 500 },
    )
  }
}

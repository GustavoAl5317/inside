import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"

export async function POST(request: NextRequest) {
  try {
    const { transactionId, data } = await request.json()

    if (!transactionId) {
      return NextResponse.json({ error: "ID da transação não fornecido" }, { status: 400 })
    }

    // Verificar se a transação existe
    const transactions = await sql`
      SELECT id FROM transactions WHERE id = ${transactionId}
    `

    if (transactions.length === 0) {
      return NextResponse.json({ error: "Transação não encontrada" }, { status: 404 })
    }

    // Registrar a tentativa de webhook no banco de dados
    const [webhookLog] = await sql`
      INSERT INTO webhook_logs (
        transaction_id, 
        payload, 
        status, 
        created_at
      ) VALUES (
        ${transactionId},
        ${JSON.stringify(data)},
        ${"pending"},
        CURRENT_TIMESTAMP
      ) RETURNING id
    `

    // Em um ambiente real, aqui você enviaria os dados para um serviço externo
    console.log(`Webhook para transação ${transactionId} recebido e enfileirado para processamento`)

    // Retornar resposta de sucesso
    return NextResponse.json({
      success: true,
      message: "Dados recebidos e enfileirados para processamento via webhook",
      transactionId,
      webhookLogId: webhookLog.id,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Erro ao processar webhook:", error)
    return NextResponse.json(
      {
        error: "Erro ao processar webhook",
        details: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 500 },
    )
  }
}

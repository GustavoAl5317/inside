import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"

export async function POST(request: NextRequest) {
  try {
    const { transactionId, targetUrl } = await request.json()

    if (!transactionId) {
      return NextResponse.json({ error: "ID da transação não fornecido" }, { status: 400 })
    }

    if (!targetUrl) {
      return NextResponse.json({ error: "URL de destino não fornecida" }, { status: 400 })
    }

    // Verificar se a transação existe
    const transactions = await sql`
      SELECT * FROM transactions WHERE id = ${transactionId}
    `

    if (transactions.length === 0) {
      return NextResponse.json({ error: "Transação não encontrada" }, { status: 404 })
    }

    const transaction = transactions[0]

    // Buscar dados relacionados
    const [business] = await sql`
      SELECT * FROM businesses WHERE id = ${transaction.business_id}
    `

    const [supplier] = await sql`
      SELECT * FROM companies WHERE id = ${transaction.supplier_id}
    `

    const [customer] = await sql`
      SELECT * FROM companies WHERE id = ${transaction.customer_id}
    `

    const [interatell] = await sql`
      SELECT * FROM companies WHERE id = ${transaction.interatell_id}
    `

    const products = await sql`
      SELECT ti.*, p.partnumber, p.description, p.cfop, p.nature, p.ncm
      FROM transaction_items ti
      JOIN products p ON ti.product_id = p.id
      WHERE ti.transaction_id = ${transaction.id}
    `

    // Montar objeto de dados completo
    const webhookData = {
      transaction,
      business,
      companies: {
        supplier,
        customer,
        interatell,
      },
      products,
      meta: {
        sentAt: new Date().toISOString(),
        source: "inside-sales-system",
      },
    }

    // Em um ambiente real, você enviaria os dados para o URL de destino
    // Simulando o envio do webhook
    console.log(`Simulando envio de webhook para ${targetUrl}`)

    // Registrar o envio no banco de dados
    await sql`
      UPDATE webhook_logs 
      SET 
        status = ${"sent"},
        target_url = ${targetUrl},
        sent_at = CURRENT_TIMESTAMP,
        response = ${'{"success": true, "message": "Webhook simulado com sucesso"}'}
      WHERE transaction_id = ${transactionId}
      AND status = ${"pending"}
    `

    // Retornar resposta de sucesso
    return NextResponse.json({
      success: true,
      message: `Webhook para transação ${transactionId} enviado com sucesso para ${targetUrl}`,
      timestamp: new Date().toISOString(),
      dataSize: JSON.stringify(webhookData).length,
    })
  } catch (error) {
    console.error("Erro ao enviar webhook:", error)
    return NextResponse.json(
      {
        error: "Erro ao enviar webhook",
        details: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 500 },
    )
  }
}

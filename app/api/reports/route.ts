import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const transactionId = searchParams.get("id")

    if (!transactionId) {
      return NextResponse.json({ error: "ID da transação não fornecido" }, { status: 400 })
    }

    // Buscar dados da transação
    const [transaction] = await sql`
      SELECT * FROM transactions WHERE id = ${transactionId}
    `

    if (!transaction) {
      return NextResponse.json({ error: "Transação não encontrada" }, { status: 404 })
    }

    // Buscar dados relacionados
    const business = await sql`
      SELECT * FROM businesses WHERE id = ${transaction.business_id}
    `

    const supplier = await sql`
      SELECT * FROM companies WHERE id = ${transaction.supplier_id}
    `

    const customer = await sql`
      SELECT * FROM companies WHERE id = ${transaction.customer_id}
    `

    const interatell = await sql`
      SELECT * FROM companies WHERE id = ${transaction.interatell_id}
    `

    const products = await sql`
      SELECT ti.*, p.partnumber, p.description, p.cfop, p.nature, p.ncm
      FROM transaction_items ti
      JOIN products p ON ti.product_id = p.id
      WHERE ti.transaction_id = ${transaction.id}
    `

    // Montar objeto de resposta
    const response = {
      transaction,
      business: business[0] || null,
      companies: {
        supplier: supplier[0] || null,
        customer: customer[0] || null,
        interatell: interatell[0] || null,
      },
      products,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error("Erro ao buscar dados da transação:", error)
    return NextResponse.json({ error: "Erro ao buscar dados da transação" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const data = await request.json()

    // Aqui você pode salvar os dados em um formato específico
    // ou processá-los para gerar um relatório

    // Simulando processamento
    await new Promise((resolve) => setTimeout(resolve, 1000))

    return NextResponse.json({
      success: true,
      message: "Dados recebidos com sucesso",
      timestamp: new Date().toISOString(),
      dataSize: JSON.stringify(data).length,
    })
  } catch (error) {
    console.error("Erro ao processar dados:", error)
    return NextResponse.json({ error: "Erro ao processar dados" }, { status: 500 })
  }
}

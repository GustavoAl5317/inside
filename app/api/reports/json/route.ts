import { type NextRequest, NextResponse } from "next/server"

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const data = await request.json()

    // Aqui você pode processar os dados JSON conforme necessário
    // Por exemplo, salvar em um banco de dados, enviar para outro serviço, etc.

    // Simulando processamento
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Retornar os dados processados
    return NextResponse.json({
      success: true,
      message: "Dados JSON processados com sucesso",
      timestamp: new Date().toISOString(),
      data: data,
    })
  } catch (error) {
    console.error("Erro ao processar JSON:", error)
    return NextResponse.json({ error: "Erro ao processar JSON" }, { status: 500 })
  }
}

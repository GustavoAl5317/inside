import { type NextRequest, NextResponse } from "next/server"

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const transactionId = searchParams.get("id")

    if (!transactionId) {
      return NextResponse.json({ error: "ID da transação não fornecido" }, { status: 400 })
    }

    // Em um ambiente real, você geraria um arquivo Excel aqui
    // Por exemplo, usando uma biblioteca como ExcelJS ou xlsx

    // Simulando a geração de um arquivo Excel
    await new Promise((resolve) => setTimeout(resolve, 1500))

    // Retornar uma resposta simulada
    // Em um ambiente real, você retornaria o arquivo Excel
    return new NextResponse(
      JSON.stringify({
        success: true,
        message: "Excel gerado com sucesso",
        downloadUrl: `/api/download/excel/${transactionId}`,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    )
  } catch (error) {
    console.error("Erro ao gerar Excel:", error)
    return NextResponse.json({ error: "Erro ao gerar Excel" }, { status: 500 })
  }
}

import { type NextRequest, NextResponse } from "next/server"

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const transactionId = searchParams.get("id")

    if (!transactionId) {
      return NextResponse.json({ error: "ID da transação não fornecido" }, { status: 400 })
    }

    // Em um ambiente real, você geraria um PDF aqui
    // Por exemplo, usando uma biblioteca como PDFKit ou jsPDF

    // Simulando a geração de um PDF
    await new Promise((resolve) => setTimeout(resolve, 1500))

    // Retornar uma resposta simulada
    // Em um ambiente real, você retornaria o arquivo PDF
    return new NextResponse(
      JSON.stringify({
        success: true,
        message: "PDF gerado com sucesso",
        downloadUrl: `/api/download/pdf/${transactionId}`,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    )
  } catch (error) {
    console.error("Erro ao gerar PDF:", error)
    return NextResponse.json({ error: "Erro ao gerar PDF" }, { status: 500 })
  }
}

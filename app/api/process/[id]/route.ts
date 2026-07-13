// Criar nova API em app/api/process/[id]/route.ts para buscar dados completos do processo
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const processId = parseInt(params.id, 10);
  if (isNaN(processId)) {
    return NextResponse.json({ success: false, error: 'ID inválido' }, { status: 400 });
  }

  try {
    // Buscar dados do processo, transação, empresas, produtos, notas
    const process = await sql`
      SELECT ph.*, t.*, b.*, cs.*, cc.*
      FROM process_history ph
      JOIN transactions t ON ph.transaction_id = t.id
      JOIN businesses b ON t.business_id = b.id
      LEFT JOIN companies cs ON t.supplier_id = cs.id
      LEFT JOIN companies cc ON t.customer_id = cc.id
      WHERE ph.id = ${processId}
      LIMIT 1
    `;

    if (process.length === 0) {
      return NextResponse.json({ success: false, error: 'Processo não encontrado' }, { status: 404 });
    }

    // Buscar itens da transação
    const items = await sql`
      SELECT ti.*, p.*
      FROM transaction_items ti
      JOIN products p ON ti.product_id = p.id
      WHERE ti.transaction_id = ${process[0].transaction_id}
    `;

    return NextResponse.json({ success: true, process: process[0], items });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' }, { status: 500 });
  }
}

// ... existing code ...

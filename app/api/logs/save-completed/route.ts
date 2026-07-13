import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface SaveLogsRequest {
  transactionId: number;
  logs: any[];
  completedAt: string;
  status: 'success' | 'error';
}

export async function POST(request: NextRequest) {
  try {
    const body: SaveLogsRequest = await request.json();
    const { transactionId, logs, completedAt, status } = body;

    if (!transactionId || !logs || !Array.isArray(logs)) {
      return NextResponse.json(
        { error: 'transactionId e logs são obrigatórios' },
        { status: 400 }
      );
    }

    // Salvar os logs na tabela de logs salvos
    await sql`
      INSERT INTO saved_omie_logs (
        transaction_id,
        logs_data,
        completed_at,
        status,
        created_at
      ) VALUES (
        ${transactionId},
        ${JSON.stringify(logs)},
        ${completedAt},
        ${status},
        NOW()
      )
      ON CONFLICT (transaction_id) 
      DO UPDATE SET
        logs_data = ${JSON.stringify(logs)},
        completed_at = ${completedAt},
        status = ${status},
        updated_at = NOW()
    `;

    return NextResponse.json({ 
      success: true, 
      message: 'Logs salvos com sucesso',
      transactionId 
    });

  } catch (error) {
    console.error('Erro ao salvar logs:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const transactionId = searchParams.get('transactionId');

    if (!transactionId) {
      return NextResponse.json(
        { error: 'transactionId é obrigatório' },
        { status: 400 }
      );
    }

    // Buscar logs salvos para a transação
    const result = await sql`
      SELECT 
        transaction_id,
        logs_data,
        completed_at,
        status,
        created_at,
        updated_at
      FROM saved_omie_logs 
      WHERE transaction_id = ${transactionId}
    `;

    if (result.length === 0) {
      return NextResponse.json(
        { error: 'Logs não encontrados para esta transação' },
        { status: 404 }
      );
    }

    const savedLogs = result[0];
    
    return NextResponse.json({
      success: true,
      data: {
        transactionId: savedLogs.transaction_id,
        logs: savedLogs.logs_data,
        completedAt: savedLogs.completed_at,
        status: savedLogs.status,
        createdAt: savedLogs.created_at,
        updatedAt: savedLogs.updated_at
      }
    });

  } catch (error) {
    console.error('Erro ao buscar logs salvos:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}
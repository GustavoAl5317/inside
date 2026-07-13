import { NextRequest, NextResponse } from 'next/server';
import { BitrixService } from '@/lib/bitrix-service';

export async function POST(request: NextRequest) {
  try {
    const { dealId } = await request.json();
    
    if (!dealId) {
      return NextResponse.json(
        { success: false, message: 'Deal ID é obrigatório' },
        { status: 400 }
      );
    }

    const result = await BitrixService.moveDealToFinancialApproval(dealId);
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Erro ao mover deal:', error);
    return NextResponse.json(
      { 
        success: false, 
        message: error instanceof Error ? error.message : 'Erro desconhecido' 
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dealId = searchParams.get('dealId');
    
    if (!dealId) {
      return NextResponse.json(
        { success: false, message: 'Deal ID é obrigatório' },
        { status: 400 }
      );
    }

    // Buscar as etapas para debug
    const stages = await BitrixService.getStages();
    const deal = await BitrixService.getDeal(dealId);
    
    return NextResponse.json({
      success: true,
      deal,
      stages: stages.map(stage => ({
        id: stage.STATUS_ID,
        name: stage.NAME,
        sort: stage.SORT
      }))
    });
  } catch (error) {
    console.error('Erro ao buscar informações do deal:', error);
    return NextResponse.json(
      { 
        success: false, 
        message: error instanceof Error ? error.message : 'Erro desconhecido' 
      },
      { status: 500 }
    );
  }
}
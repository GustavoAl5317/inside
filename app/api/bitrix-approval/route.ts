import { NextRequest, NextResponse } from 'next/server';
import { 
  checkBitrixApprovalAction,
  getBitrixDealInfoAction,
  getBitrixStagesAction,
  checkPendingApprovalsAction
} from '@/lib/actions';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const dealId = searchParams.get('dealId');

  try {
    switch (action) {
      case 'check-approval':
        if (!dealId) {
          return NextResponse.json(
            { success: false, error: 'Deal ID é obrigatório' },
            { status: 400 }
          );
        }
        const approvalResult = await checkBitrixApprovalAction(dealId);
        return NextResponse.json(approvalResult);

      case 'get-deal':
        if (!dealId) {
          return NextResponse.json(
            { success: false, error: 'Deal ID é obrigatório' },
            { status: 400 }
          );
        }
        const dealResult = await getBitrixDealInfoAction(dealId);
        return NextResponse.json(dealResult);

      case 'get-stages':
        const stagesResult = await getBitrixStagesAction();
        return NextResponse.json(stagesResult);

      case 'check-pending':
        const pendingResult = await checkPendingApprovalsAction();
        return NextResponse.json(pendingResult);

      default:
        return NextResponse.json(
          { success: false, error: 'Ação não reconhecida' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Erro na API de aprovações Bitrix:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Erro interno do servidor' 
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, dealId } = body;

    switch (action) {
      case 'check-approval':
        if (!dealId) {
          return NextResponse.json(
            { success: false, error: 'Deal ID é obrigatório' },
            { status: 400 }
          );
        }
        const approvalResult = await checkBitrixApprovalAction(dealId);
        return NextResponse.json(approvalResult);

      case 'check-pending':
        const pendingResult = await checkPendingApprovalsAction();
        return NextResponse.json(pendingResult);

      default:
        return NextResponse.json(
          { success: false, error: 'Ação não reconhecida' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Erro na API de aprovações Bitrix:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Erro interno do servidor' 
      },
      { status: 500 }
    );
  }
}
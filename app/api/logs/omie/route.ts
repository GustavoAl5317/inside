import { NextRequest, NextResponse } from 'next/server';
import { logCaptureService } from '@/lib/log-capture';

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const transactionId = searchParams.get('transactionId');
    
    if (!transactionId) {
      return NextResponse.json(
        { success: false, message: 'Transaction ID é obrigatório' },
        { status: 400 }
      );
    }

    // Buscar logs específicos do Omie de diferentes fontes
    const systemLogs = logCaptureService.getLogs("system");
    const transactionLogs = logCaptureService.getLogs("transaction");
    const awsLambdaLogs = logCaptureService.getLogs("aws-lambda");
    
    // Combinar todos os logs
    const allLogs = [...systemLogs, ...transactionLogs, ...awsLambdaLogs];
    
    // Filtrar logs do Omie para esta transação
    const omieLogs = allLogs.filter(log => {
      // Verificar se é da transação correta
      const isCorrectTransaction = log.metadata?.transactionId?.toString() === transactionId ||
                                   log.message.includes(`transactionId: ${transactionId}`) ||
                                   log.message.includes(`Transaction #${transactionId}`) ||
                                   log.message.includes(`transactionId,${transactionId}`) ||
                                   (log.metadata && JSON.stringify(log.metadata).includes(transactionId));
      
      if (!isCorrectTransaction) return false;
      
      // Filtrar apenas logs específicos do Omie
      const message = log.message.toLowerCase();
      return message.includes('checkcliente') ||
             message.includes('createcliente') ||
             message.includes('checkproduto') ||
             message.includes('createprodutoresult') ||
             message.includes('createoc') ||
             message.includes('createosresult') ||
             message.includes('checkservico') ||
             message.includes('result');
    });

    // Ordenar por timestamp
    omieLogs.sort((a, b) => {
      const timeA = typeof a.timestamp === 'number' ? a.timestamp : new Date(a.timestamp).getTime();
      const timeB = typeof b.timestamp === 'number' ? b.timestamp : new Date(b.timestamp).getTime();
      return timeA - timeB;
    });

    // Mapear para o formato esperado pelo modal
    const formattedLogs = omieLogs.map((log, index) => ({
      id: `omie-${index}`,
      timestamp: typeof log.timestamp === 'number' ? new Date(log.timestamp).toISOString() : log.timestamp,
      level: determineLogLevel(log.message),
      message: log.message,
      type: determineLogType(log.message),
      data: log.metadata
    }));

    return NextResponse.json({
      success: true,
      logs: formattedLogs,
      total: formattedLogs.length,
      transactionId,
      debug: {
        systemLogsCount: systemLogs.length,
        transactionLogsCount: transactionLogs.length,
        awsLambdaLogsCount: awsLambdaLogs.length,
        totalLogsFound: allLogs.length,
        filteredOmieLogs: omieLogs.length
      }
    });

  } catch (error) {
    console.error('Erro ao buscar logs do Omie:', error);
    return NextResponse.json(
      { 
        success: false, 
        message: error instanceof Error ? error.message : 'Erro desconhecido' 
      },
      { status: 500 }
    );
  }
}

function determineLogLevel(message: string): 'info' | 'error' | 'success' | 'warning' {
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('erro') || lowerMessage.includes('error') || lowerMessage.includes('falha')) {
    return 'error';
  }
  
  if (lowerMessage.includes('sucesso') || lowerMessage.includes('success') || lowerMessage.includes('criado') || lowerMessage.includes('created')) {
    return 'success';
  }
  
  if (lowerMessage.includes('aviso') || lowerMessage.includes('warning') || lowerMessage.includes('atenção')) {
    return 'warning';
  }
  
  return 'info';
}

function determineLogType(message: string): 'checkCliente' | 'createCliente' | 'checkProduto' | 'createProdutoResult' | 'createOC' | 'createOSResult' | 'checkServico' | 'result' {
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('checkcliente')) return 'checkCliente';
  if (lowerMessage.includes('createcliente')) return 'createCliente';
  if (lowerMessage.includes('checkproduto')) return 'checkProduto';
  if (lowerMessage.includes('createprodutoresult')) return 'createProdutoResult';
  if (lowerMessage.includes('createoc')) return 'createOC';
  if (lowerMessage.includes('createosresult')) return 'createOSResult';
  if (lowerMessage.includes('checkservico')) return 'checkServico';
  if (lowerMessage.includes('result')) return 'result';
  
  return 'result'; // default
}
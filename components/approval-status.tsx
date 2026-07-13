"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { RefreshCw, CheckCircle, Clock, XCircle, AlertTriangle } from "lucide-react"
import { checkBitrixApprovalAction } from "@/lib/actions"

interface ApprovalStatusProps {
  bitrixDealId?: string;
  onApprovalChange?: (approved: boolean) => void;
}

export function ApprovalStatus({ bitrixDealId, onApprovalChange }: ApprovalStatusProps) {
  const [approvalStatus, setApprovalStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkApproval = async () => {
    if (!bitrixDealId) {
      setApprovalStatus(null);
      setError("ID do negócio Bitrix não informado");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await checkBitrixApprovalAction(bitrixDealId);

      if (result.success) {
        setApprovalStatus(result);
        if ('approved' in result) {
          onApprovalChange?.(result.approved);
        }
      } else {
        setError(result.error || "Erro ao verificar aprovação");
        setApprovalStatus(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
      setApprovalStatus(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (bitrixDealId) {
      checkApproval();
    } else {
      setApprovalStatus(null);
      setError(null);
    }
  }, [bitrixDealId]);

  const getStatusIcon = () => {
    if (loading) return <RefreshCw className="w-4 h-4 animate-spin" />;
    if (error) return <XCircle className="w-4 h-4 text-red-500" />;
    if (!approvalStatus) return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
    
    return approvalStatus.approved 
      ? <CheckCircle className="w-4 h-4 text-green-500" />
      : <Clock className="w-4 h-4 text-yellow-500" />;
  };

  const getStatusBadge = () => {
    if (loading) return <Badge variant="outline">Verificando...</Badge>;
    if (error) return <Badge variant="destructive">Erro</Badge>;
    if (!approvalStatus) return <Badge variant="outline">Não verificado</Badge>;
    
    return approvalStatus.approved 
      ? <Badge variant="default" className="bg-green-600">Aprovado</Badge>
      : <Badge variant="outline" className="text-yellow-600">Pendente</Badge>;
  };

  if (!bitrixDealId) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex items-center justify-center h-24">
          <p className="text-sm text-muted-foreground">
            Informe o ID do negócio Bitrix para verificar aprovação
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getStatusIcon()}
            <CardTitle className="text-sm">Status de Aprovação</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {getStatusBadge()}
            <Button
              variant="outline"
              size="sm"
              onClick={checkApproval}
              disabled={loading}
            >
              <RefreshCw className={`w-3 h-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
          </div>
        </div>
        <CardDescription>
          Negócio #{bitrixDealId} no Bitrix24
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {error ? (
          <div className="text-sm text-red-600 bg-red-50 p-3 rounded-md">
            {error}
          </div>
        ) : approvalStatus ? (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Etapa Atual:</span>
              <span className="font-medium">{approvalStatus.currentStageName || 'N/A'}</span>
            </div>
            <div className="text-sm text-muted-foreground bg-muted p-3 rounded-md">
              {approvalStatus.message}
            </div>
            {!approvalStatus.approved && (
              <div className="text-sm text-amber-700 bg-amber-50 p-3 rounded-md border border-amber-200">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  <span className="font-medium">Aguardando Aprovação</span>
                </div>
                <p className="mt-1">
                  O envio ao Omie será liberado automaticamente quando o negócio avançar para uma etapa posterior à aprovação do Diretor Comercial.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            Clique em "Atualizar" para verificar o status de aprovação
          </div>
        )}
      </CardContent>
    </Card>
  );
}
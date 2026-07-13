"use client"

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AlertTriangle, Info } from "lucide-react"

export function PreviewModeNotice() {
  return (
    <Card className="w-full">
      <CardHeader className="bg-amber-50 border-b border-amber-100">
        <CardTitle className="flex items-center text-amber-700">
          <AlertTriangle className="h-5 w-5 mr-2" />
          Modo de Preview
        </CardTitle>
        <CardDescription className="text-amber-600">
          Algumas funcionalidades têm limitações no ambiente de preview
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="space-y-4">
          <p>
            O ambiente de preview do Vercel tem algumas limitações que podem afetar a funcionalidade de logs do
            CloudWatch:
          </p>

          <ul className="list-disc pl-5 space-y-2">
            <li>Acesso limitado a APIs externas devido a restrições de CORS</li>
            <li>Limitações no acesso ao sistema de arquivos</li>
            <li>Timeouts mais curtos para requisições</li>
          </ul>

          <div className="bg-blue-50 p-4 rounded-md border border-blue-100">
            <div className="flex">
              <Info className="h-5 w-5 text-blue-500 mr-2 flex-shrink-0 mt-0.5" />
              <div className="text-blue-700">
                <p className="font-medium">Recomendação</p>
                <p className="mt-1">Para testar completamente a funcionalidade de logs do CloudWatch, recomendamos:</p>
                <ul className="list-disc pl-5 mt-2">
                  <li>Testar em um ambiente de produção</li>
                  <li>Usar a versão implantada da aplicação</li>
                  <li>Verificar se todas as variáveis de ambiente estão configuradas corretamente</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter className="border-t bg-gray-50 flex justify-between">
        <Button variant="outline" onClick={() => window.history.back()}>
          Voltar
        </Button>
        <Button variant="default" onClick={() => window.location.reload()}>
          Tentar Novamente
        </Button>
      </CardFooter>
    </Card>
  )
}

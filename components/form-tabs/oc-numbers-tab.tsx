"use client"

import { useState } from "react"
import type { UseFormReturn } from "react-hook-form"
import { toast } from "sonner"
import { Hash, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { generateOcNumbersAction } from "@/lib/actions"
import { observacaoOc, OBSERVACAO_OS_SERVICO } from "@/lib/oc-numbers"

interface OcNumbersTabProps {
  form: UseFormReturn<any>
}

/**
 * Número de Ordem de Compra de cada OC do negócio (lista #35 do Bitrix).
 *
 * Um número por fornecedor e um por cliente de serviço Interatell. Pode ser
 * gerado aqui, já no backlog, ou digitado quando já foi criado à mão na lista.
 * O que ficar em branco é criado automaticamente no envio ao Omie.
 */
export function OcNumbersTab({ form }: OcNumbersTabProps) {
  const [gerando, setGerando] = useState(false)
  const grupos: any[] = form.watch("supplierGroups") || []
  const servicos: any[] = form.watch("serviceCustomers") || []

  const linhas = [
    ...grupos.map((g, i) => ({
      path: `supplierGroups.${i}`,
      titulo: g?.supplier?.name || `Fornecedor ${i + 1}`,
      observacao: observacaoOc(g),
      numero: String(g?.ocNumber ?? ""),
      semItens: !(g?.products ?? []).length,
    })),
    ...servicos.map((s, i) => ({
      path: `serviceCustomers.${i}`,
      titulo: s?.customer?.name || `Cliente de serviço ${i + 1}`,
      observacao: OBSERVACAO_OS_SERVICO,
      numero: String(s?.ocNumber ?? ""),
      semItens: !(s?.items ?? []).length,
    })),
  ]
  const faltando = linhas.filter(l => !l.semItens && !l.numero.trim()).length

  const aplica = (prefixo: "supplierGroups" | "serviceCustomers", lista: any[] | undefined) => {
    lista?.forEach((item, i) => {
      if (!item?.ocNumber || item.ocNumber === form.getValues(`${prefixo}.${i}.ocNumber`)) return
      form.setValue(`${prefixo}.${i}.ocNumber`, item.ocNumber, { shouldDirty: true })
      form.setValue(`${prefixo}.${i}.ocElementId`, item.ocElementId, { shouldDirty: true })
    })
  }

  const gerar = async () => {
    setGerando(true)
    try {
      const r = await generateOcNumbersAction(form.getValues())
      // Aplica mesmo em falha parcial: o que já foi criado na lista não pode se perder.
      aplica("supplierGroups", r.supplierGroups)
      aplica("serviceCustomers", r.serviceCustomers)
      if (!r.success) {
        toast.error(`Erro ao criar número na lista do Bitrix: ${r.error}`)
      } else if (r.criados) {
        toast.success(`${r.criados} número(s) criado(s) na lista do Bitrix. Salve o rascunho para gravar no negócio.`)
      } else {
        toast.success("Todas as OCs já têm número.")
      }
    } catch (err: any) {
      toast.error(`Erro ao criar número na lista do Bitrix: ${err?.message || err}`)
    } finally {
      setGerando(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Número de Ordem de Compra</h2>
        <p className="text-sm text-gray-500 mt-1">
          Um número por Ordem de Compra (fornecedor) e por OS de serviço Interatell, criado na
          lista de Números de Ordem de Compra do Bitrix. O que ficar em branco é criado
          automaticamente no envio ao Omie.
        </p>
      </div>

      {linhas.length === 0 ? (
        <p className="text-sm text-gray-400 border rounded-lg p-6 text-center">
          Adicione fornecedores ou clientes de serviço para gerar os números.
        </p>
      ) : (
        <div className="border rounded-xl divide-y">
          {linhas.map(l => (
            <div key={l.path} className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm truncate" title={l.titulo}>{l.titulo}</p>
                <p className="text-xs text-gray-500 mt-0.5">{l.observacao}</p>
              </div>
              <div className="flex items-center gap-2 sm:w-44">
                <span className="text-sm text-gray-500 shrink-0">OC</span>
                <Input
                  value={l.numero}
                  placeholder={l.semItens ? "sem itens" : "ex: 9178/26"}
                  disabled={l.semItens}
                  onChange={e => {
                    form.setValue(`${l.path}.ocNumber`, e.target.value, { shouldDirty: true })
                    // Número digitado à mão não é mais o item que o app criou.
                    form.setValue(`${l.path}.ocElementId`, undefined, { shouldDirty: true })
                  }}
                  className="h-9"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500">
          {faltando ? `${faltando} sem número` : linhas.length ? "Todas com número" : ""}
        </p>
        <Button type="button" variant="outline" onClick={gerar} disabled={gerando || !faltando}>
          {gerando
            ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            : <Hash className="w-4 h-4 mr-1.5" />}
          Gerar números que faltam
        </Button>
      </div>
    </div>
  )
}

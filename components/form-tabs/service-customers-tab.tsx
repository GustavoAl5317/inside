"use client"

import { useState } from "react"
import { useFieldArray, type UseFormReturn } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CurrencyInput } from "@/components/ui/currency-input"
import { Badge } from "@/components/ui/badge"
import { Trash2, Plus, Wrench, Building2, Pencil } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { CustomerDialog } from "./customers-tab"
import { toast } from "sonner"

interface ServiceCustomersTabProps {
  form: UseFormReturn<any>
}

const newLocalId = () => `srv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

/**
 * Serviço Interatell (natureza SRV).
 *
 * Diferente dos demais steps, aqui não existe fornecedor: o serviço é próprio,
 * vendido direto ao cliente. Por isso os itens são digitados na hora (descrição,
 * quantidade e valor de venda) — não há custo nem alocação vinda de grupo de compra.
 * O código do serviço no Omie é fixo pela natureza (SRV → SRV00001).
 */
export function ServiceCustomersTab({ form }: ServiceCustomersTabProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)

  const { fields, append, remove, update } = useFieldArray({
    control: form.control,
    name: "serviceCustomers",
  })

  const entries = form.watch("serviceCustomers") || []

  const handleConfirmCustomer = (company: any) => {
    if (editingIdx !== null) {
      const current = entries[editingIdx] ?? {}
      update(editingIdx, { ...current, customer: { ...current.customer, ...company } })
      setEditingIdx(null)
    } else {
      append({
        localId: newLocalId(),
        branch: "barueri",
        customer: company,
        items: [],
      })
    }
    setDialogOpen(false)
  }

  const addItem = (idx: number) => {
    const path = `serviceCustomers.${idx}.items`
    const items = form.getValues(path) || []
    form.setValue(path, [
      ...items,
      { localId: newLocalId(), description: "", quantity: 1, unitSale: 0, totalSale: 0 },
    ], { shouldDirty: true })
  }

  const removeItem = (idx: number, itemIdx: number) => {
    const path = `serviceCustomers.${idx}.items`
    const items = [...(form.getValues(path) || [])]
    items.splice(itemIdx, 1)
    form.setValue(path, items, { shouldDirty: true })
  }

  /** Recalcula o total da linha sempre que quantidade ou valor muda. */
  const updateItem = (idx: number, itemIdx: number, field: string, value: string | number) => {
    const path = `serviceCustomers.${idx}.items.${itemIdx}`
    const item = { ...(form.getValues(path) || {}), [field]: value }
    item.totalSale = Number(item.quantity ?? 0) * Number(item.unitSale ?? 0)
    form.setValue(path, item, { shouldDirty: true })
  }

  const totalGeral = entries.reduce(
    (acc: number, e: any) =>
      acc + (e.items ?? []).reduce((s: number, i: any) => s + Number(i.totalSale ?? 0), 0),
    0,
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Wrench className="w-5 h-5 text-teal-600" />
            Cliente Serviço (Interatell)
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Serviço próprio, sem fornecedor. Adicione o cliente e digite os serviços —
            eles geram uma <strong>OS de natureza SRV</strong> e um <strong>PDF separado</strong>.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => { setEditingIdx(null); setDialogOpen(true) }}
          className="bg-teal-600 hover:bg-teal-700 shrink-0"
        >
          <Plus className="w-4 h-4 mr-1" /> Adicionar cliente
        </Button>
      </div>

      {fields.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-gray-200 p-8 text-center">
          <Wrench className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">Nenhum cliente de serviço adicionado.</p>
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            onClick={() => { setEditingIdx(null); setDialogOpen(true) }}
          >
            <Plus className="w-4 h-4 mr-1" /> Adicionar cliente
          </Button>
        </div>
      )}

      {fields.map((field, idx) => {
        const entry: any = entries[idx] ?? {}
        const items: any[] = entry.items ?? []
        const subtotal = items.reduce((s, i) => s + Number(i.totalSale ?? 0), 0)

        return (
          <div key={field.id} className="rounded-xl border border-gray-200 overflow-hidden">
            {/* Cabeçalho do cliente */}
            <div className="bg-gradient-to-r from-teal-50 to-cyan-50 px-4 py-3 border-b border-teal-100">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-teal-600 shrink-0" />
                    <p className="font-semibold text-gray-800 truncate">
                      {entry.customer?.name || "Cliente sem nome"}
                    </p>
                  </div>
                  <p className="text-xs text-gray-500 font-mono mt-0.5">
                    {entry.customer?.cnpj || "—"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className="text-[11px]">
                    {subtotal > 0 ? formatCurrency(subtotal) : "sem serviços"}
                  </Badge>
                  <Button
                    type="button" size="icon" variant="ghost" className="h-8 w-8"
                    onClick={() => { setEditingIdx(idx); setDialogOpen(true) }}
                    title="Editar cliente"
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    type="button" size="icon" variant="ghost"
                    className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={() => remove(idx)}
                    title="Remover cliente"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Filial de faturamento deste cliente */}
              <div className="flex items-center gap-4 mt-2">
                <span className="text-xs font-medium text-gray-600">Filial:</span>
                {(["barueri", "es"] as const).map(b => (
                  <label key={b} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input
                      type="radio"
                      className="accent-teal-600"
                      checked={(entry.branch ?? "barueri") === b}
                      onChange={() => form.setValue(`serviceCustomers.${idx}.branch`, b, { shouldDirty: true })}
                    />
                    {b === "barueri" ? "Barueri (SP)" : "Filial ES"}
                  </label>
                ))}
              </div>
            </div>

            {/* Itens de serviço */}
            <div className="p-4 space-y-2">
              {items.length > 0 && (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="text-left p-2">Descrição do serviço</th>
                        <th className="text-center p-2 w-20">Qtd</th>
                        <th className="text-right p-2 w-32">Valor unit.</th>
                        <th className="text-right p-2 w-32">Total</th>
                        <th className="p-2 w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, itemIdx) => (
                        <tr key={item.localId ?? itemIdx} className="border-t">
                          <td className="p-2">
                            <Input
                              className="h-8 text-xs"
                              placeholder="Ex.: Instalação e configuração de rede"
                              value={item.description ?? ""}
                              onChange={e => updateItem(idx, itemIdx, "description", e.target.value)}
                            />
                          </td>
                          <td className="p-2">
                            <Input
                              className="h-8 text-xs text-center"
                              type="number" min={1} step="any"
                              value={item.quantity ?? 1}
                              onChange={e => updateItem(idx, itemIdx, "quantity", Number(e.target.value))}
                            />
                          </td>
                          <td className="p-2">
                            <CurrencyInput
                              className="h-8 text-xs text-right"
                              value={item.unitSale ?? 0}
                              resetKey={`${entry.localId}:${item.localId}`}
                              onChange={v => updateItem(idx, itemIdx, "unitSale", v)}
                            />
                          </td>
                          <td className="p-2 text-right font-semibold text-gray-700">
                            {formatCurrency(Number(item.totalSale ?? 0))}
                          </td>
                          <td className="p-2 text-center">
                            <Button
                              type="button" size="icon" variant="ghost"
                              className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                              onClick={() => removeItem(idx, itemIdx)}
                              title="Remover serviço"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <Button type="button" size="sm" variant="outline" onClick={() => addItem(idx)}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Adicionar serviço
              </Button>

              {items.length === 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                  Adicione pelo menos um serviço para este cliente.
                </p>
              )}
            </div>
          </div>
        )
      })}

      {totalGeral > 0 && (
        <div className="flex justify-end">
          <div className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-2">
            <span className="text-xs text-teal-700 font-medium">Total em serviços Interatell: </span>
            <span className="text-sm font-bold text-teal-900">{formatCurrency(totalGeral)}</span>
          </div>
        </div>
      )}

      <CustomerDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditingIdx(null) }}
        onConfirm={handleConfirmCustomer}
        initialData={editingIdx !== null ? entries[editingIdx]?.customer : undefined}
        isEdit={editingIdx !== null}
      />
    </div>
  )
}

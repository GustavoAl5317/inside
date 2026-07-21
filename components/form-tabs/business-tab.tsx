"use client"

import { useState, useEffect } from "react"
import type { UseFormReturn } from "react-hook-form"
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getBitrixAllPaymentConditionsAction } from "@/lib/actions"

interface BusinessTabProps {
  form: UseFormReturn<any>
}

export function BusinessTab({ form }: BusinessTabProps) {
  const [purchaseConditions, setPurchaseConditions] = useState<any[]>([])
  const [saleConditions, setSaleConditions] = useState<any[]>([])
  const [isLoadingConditions, setIsLoadingConditions] = useState(true)
  // false = BX24 disponível, true = fora do Bitrix24 (digitar manualmente)
  const [manualMode, setManualMode] = useState(false)

  useEffect(() => {
    const load = async () => {
      setIsLoadingConditions(true)
      try {
        const res = await getBitrixAllPaymentConditionsAction()
        if (res.success) {
          setPurchaseConditions(res.purchase)
          setSaleConditions(res.sale)
        } else {
          setManualMode(true)
        }
      } catch {
        setManualMode(true)
      } finally {
        setIsLoadingConditions(false)
      }
    }
    load()
  }, [])

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Informações do Negócio</h2>

      <div className="space-y-4">

        <FormField
          control={form.control}
          name="business.name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome do Negócio</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Nome do negócio" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="business.commercialProposal"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Número da Proposta Comercial</FormLabel>
              <FormControl>
                <Input placeholder="Número da proposta comercial" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="business.purchaseOrderDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Data da Criação da OC</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="business.deliveryDeadline"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Data de Prazo de Entrega</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="business.purchasePaymentCondition"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Condição de Pagamento de Compra</FormLabel>
                {manualMode ? (
                  <FormControl>
                    <Input placeholder="Ex: A28 - Para 28 Dias" {...field} />
                  </FormControl>
                ) : (
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={isLoadingConditions ? "Carregando..." : "Selecione uma condição"} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {isLoadingConditions ? (
                        <SelectItem value="__loading__" disabled>Carregando...</SelectItem>
                      ) : purchaseConditions.length > 0 ? (
                        purchaseConditions.map((c) => (
                          <SelectItem key={c.id} value={c.code || c.name}>{c.name}</SelectItem>
                        ))
                      ) : (
                        <SelectItem value="__none__" disabled>Nenhuma condição cadastrada</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="business.expectedBillingDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Data de Previsão de Faturamento</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="business.salePaymentCondition"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Condição de Pagamento de Venda</FormLabel>
              {manualMode ? (
                <FormControl>
                  <Input placeholder="Ex: T54 - Para 30 Dias" {...field} />
                </FormControl>
              ) : (
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={isLoadingConditions ? "Carregando..." : "Selecione uma condição"} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {isLoadingConditions ? (
                      <SelectItem value="__loading__" disabled>Carregando...</SelectItem>
                    ) : saleConditions.length > 0 ? (
                      saleConditions.map((c) => (
                        <SelectItem key={c.id} value={c.code || c.name}>{c.name}</SelectItem>
                      ))
                    ) : (
                      <SelectItem value="__none__" disabled>Nenhuma condição cadastrada</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              )}
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Serviço Interatell (SRV): não passa por fornecedor, é vendido direto
            ao cliente — por isso abre um step próprio e gera um PDF separado. */}
        <FormField
          control={form.control}
          name="business.hasInteratellService"
          render={({ field }) => (
            <FormItem className="md:col-span-2">
              <div className="flex items-start gap-3 rounded-xl border-2 border-teal-200 bg-teal-50/60 p-4">
                <FormControl>
                  <input
                    type="checkbox"
                    checked={!!field.value}
                    onChange={e => field.onChange(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-teal-600 cursor-pointer"
                  />
                </FormControl>
                <div className="min-w-0">
                  <FormLabel className="text-sm font-bold text-teal-900 cursor-pointer">
                    Este negócio tem serviço Interatell
                  </FormLabel>
                  <p className="text-xs text-teal-700 mt-1">
                    Serviço próprio (natureza SRV) não passa por fornecedor. Ao marcar, abre o
                    step <strong>Cliente Serviço</strong> e o serviço vai em um PDF separado.
                  </p>
                </div>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  )
}

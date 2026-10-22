"use client"

import { useState, useEffect } from "react"
import type { UseFormReturn } from "react-hook-form"
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"

interface BusinessTabProps {
  form: UseFormReturn<any>
}

export function BusinessTab({ form }: BusinessTabProps) {

  // Negócio só de serviço Interatell: sem fornecedor e sem compra.
  const onlyService = !!form.watch("business.onlyInteratellService")

  // Número da proposta comercial sempre com o prefixo "2026." e travado.
  const commercialProposal = form.watch("business.commercialProposal")
  useEffect(() => {
    const v = String(commercialProposal ?? "").trim()
    if (v && !v.startsWith("2026.")) {
      form.setValue("business.commercialProposal", `2026.${v}`)
    }
  }, [commercialProposal, form])

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
                <Input {...field} placeholder="Nome do negócio" readOnly className="bg-gray-100 cursor-not-allowed" />
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
                <Input placeholder="Número da proposta comercial" {...field} readOnly className="bg-gray-100 cursor-not-allowed" />
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
                <FormLabel>Criação da OC</FormLabel>
                <FormControl>
                  <Input type="date" {...field} disabled className="bg-gray-100 cursor-not-allowed" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* O prazo de entrega saiu daqui: cada fornecedor entrega numa data,
              então o campo vive no card do fornecedor, na etapa seguinte. */}
          <FormField
            control={form.control}
            name="business.expectedBillingDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Previsão de Faturamento</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>


        {/* Serviço Interatell (SRV): não passa por fornecedor, é vendido direto
            ao cliente — por isso abre um step próprio e gera uma planilha separada. */}
        <FormField
          control={form.control}
          name="business.hasInteratellService"
          render={({ field }) => (
            <FormItem className="md:col-span-2">
              <div className="flex items-start gap-3 rounded-xl border-2 border-teal-200 bg-teal-50/60 p-4">
                <FormControl>
                  <input
                    type="checkbox"
                    checked={!!field.value || onlyService}
                    disabled={onlyService}
                    onChange={e => field.onChange(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-teal-600 cursor-pointer disabled:cursor-not-allowed"
                  />
                </FormControl>
                <div className="min-w-0">
                  <FormLabel className="text-sm font-bold text-teal-900 cursor-pointer">
                    Este negócio tem serviço Interatell
                  </FormLabel>
                  <p className="text-xs text-teal-700 mt-1">
                    Serviço próprio (natureza SRV) não passa por fornecedor. Ao marcar, abre o
                    step <strong>Cliente Serviço</strong> e o serviço vai em uma planilha separada.
                  </p>
                </div>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Negócio só de serviço Interatell: não tem fornecedor nem produto. Pula
            Fornecedores/Produtos e Clientes e gera só a OS do cliente. */}
        <FormField
          control={form.control}
          name="business.onlyInteratellService"
          render={({ field }) => (
            <FormItem className="md:col-span-2">
              <div className="flex items-start gap-3 rounded-xl border-2 border-amber-200 bg-amber-50/60 p-4">
                <FormControl>
                  <input
                    type="checkbox"
                    checked={!!field.value}
                    onChange={e => {
                      field.onChange(e.target.checked)
                      if (e.target.checked) form.setValue("business.hasInteratellService", true)
                    }}
                    className="mt-0.5 h-4 w-4 accent-amber-600 cursor-pointer"
                  />
                </FormControl>
                <div className="min-w-0">
                  <FormLabel className="text-sm font-bold text-amber-900 cursor-pointer">
                    Somente serviço Interatell (sem fornecedor)
                  </FormLabel>
                  <p className="text-xs text-amber-800 mt-1">
                    Serviço da Interatell direto para o cliente, sem compra. Pula as etapas
                    de <strong>Fornecedores/Produtos</strong> e <strong>Clientes</strong>, vai
                    direto para <strong>Cliente Serviço</strong> e gera só a OS no Omie.
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

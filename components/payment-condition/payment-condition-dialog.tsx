"use client"

import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createPaymentConditionAction, updatePaymentConditionAction } from "@/lib/actions"

// Schema de validação para o formulário
const paymentConditionSchema = z.object({
  id: z.number().optional(),
  code: z.string().min(1, "Código é obrigatório"),
  name: z.string().min(1, "Nome é obrigatório"),
  days: z.string().min(1, "Dias é obrigatório"),
  type: z.string().min(1, "Tipo é obrigatório"),
})

type PaymentConditionFormValues = z.infer<typeof paymentConditionSchema>

interface PaymentConditionDialogProps {
  open: boolean
  onOpenChange: (reloadData: boolean) => void
  condition?: any
}

export function PaymentConditionDialog({ open, onOpenChange, condition }: PaymentConditionDialogProps) {
  const [isLoading, setIsLoading] = useState(false)

  // Inicializar formulário
  const form = useForm<PaymentConditionFormValues>({
    resolver: zodResolver(paymentConditionSchema),
    defaultValues: {
      id: condition?.id,
      code: condition?.code || "",
      name: condition?.name || "",
      days: condition?.days || "",
      type: condition?.type || "purchase",
    },
  })

  // Atualizar formulário quando a condição mudar
  useEffect(() => {
    if (condition) {
      form.reset({
        id: condition.id,
        code: condition.code || "",
        name: condition.name || "",
        days: condition.days || "",
        type: condition.type || "purchase",
      })
    } else {
      form.reset({
        id: undefined,
        code: "",
        name: "",
        days: "",
        type: "purchase",
      })
    }
  }, [condition, form])

  // Enviar formulário
  const onSubmit = async (data: PaymentConditionFormValues) => {
    setIsLoading(true)
    try {
      let result

      // As actions recebem args posicionais e o tipo no formato do Bitrix (Compra/Venda)
      const tipo = data.type === "sale" ? "Venda" : "Compra"
      if (data.id) {
        // Atualizar condição existente
        result = await updatePaymentConditionAction(String(data.id), data.name, data.code, tipo)
      } else {
        // Criar nova condição
        result = await createPaymentConditionAction(data.name, data.code, tipo)
      }

      if (result.error) {
        console.error("Erro ao salvar condição de pagamento:", result.error)
        alert(result.error)
        setIsLoading(false)
        return
      }

      onOpenChange(true) // Fechar diálogo e recarregar dados
    } catch (error) {
      console.error("Erro ao salvar condição de pagamento:", error)
      alert("Erro ao salvar condição de pagamento: " + (error instanceof Error ? error.message : "Erro desconhecido"))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{condition ? "Editar Condição de Pagamento" : "Nova Condição de Pagamento"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Código</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Ex: 001" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Ex: À Vista" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="days"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Dias</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Ex: 0 ou 30,60,90" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o tipo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="purchase">Compra</SelectItem>
                      <SelectItem value="sale">Venda</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? "Salvando..." : "Salvar"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

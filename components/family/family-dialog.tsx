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
import { states } from "@/lib/utils"
import { createFamilyAction, updateFamilyAction } from "@/lib/actions"

// Schema de validação para o formulário
const familySchema = z.object({
  id: z.number().optional(),
  name: z.string().min(1, "Nome é obrigatório"),
  state: z.string().min(1, "Estado é obrigatório"),
  omie_code: z.string().optional(),
})

type FamilyFormValues = z.infer<typeof familySchema>

interface FamilyDialogProps {
  open: boolean
  onOpenChange: (reloadData: boolean) => void
  family?: any
}

export function FamilyDialog({ open, onOpenChange, family }: FamilyDialogProps) {
  const [isLoading, setIsLoading] = useState(false)

  // Inicializar formulário
  const form = useForm<FamilyFormValues>({
    resolver: zodResolver(familySchema),
    defaultValues: {
      id: family?.id,
      name: family?.name || "",
      state: family?.state || "",
      omie_code: family?.omie_code || "",
    },
  })

  // Atualizar formulário quando a família mudar
  useEffect(() => {
    if (family) {
      form.reset({
        id: family.id,
        name: family.name || "",
        state: family.state || "",
        omie_code: family.omie_code || "",
      })
    } else {
      form.reset({
        id: undefined,
        name: "",
        state: "",
        omie_code: "",
      })
    }
  }, [family, form])

  // Enviar formulário
  const onSubmit = async (data: FamilyFormValues) => {
    setIsLoading(true)
    try {
      let result

      if (data.id) {
        // Atualizar família existente
        result = await updateFamilyAction({ ...data, id: data.id })
      } else {
        // Criar nova família
        result = await createFamilyAction(data)
      }

      if (result.error) {
        console.error("Erro ao salvar família:", result.error)
        alert(result.error)
        setIsLoading(false)
        return
      }

      onOpenChange(true) // Fechar diálogo e recarregar dados
    } catch (error) {
      console.error("Erro ao salvar família:", error)
      alert("Erro ao salvar família: " + (error instanceof Error ? error.message : "Erro desconhecido"))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{family ? "Editar Família" : "Nova Família"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Nome da família" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="state"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Estado</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um estado" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {states.map((state) => (
                        <SelectItem key={state.value} value={state.value}>
                          {state.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="omie_code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Código Omie</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Ex: 2081927710" />
                  </FormControl>
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

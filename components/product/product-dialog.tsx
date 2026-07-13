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
import { createProductAction, updateProductAction, getFamiliesAction } from "@/lib/actions"

// Schema de validação para o formulário
const productSchema = z.object({
  id: z.number().optional(),
  partnumber: z.string().min(1, "Partnumber é obrigatório"),
  description: z.string().min(1, "Descrição é obrigatória"),
  cfop: z.string().optional(),
  nature: z.string().optional(),
  family: z.string().optional(),
  ncm: z.string().optional(),
  type: z.string().optional(),
})

type ProductFormValues = z.infer<typeof productSchema>

interface ProductDialogProps {
  open: boolean
  onOpenChange: (reloadData: boolean) => void
  product?: any
}

// Lista de tipos de produtos
const productTypes = [
  { value: "SW", label: "Software" },
  { value: "HW", label: "Hardware" },
  { value: "LIC", label: "Licença" },
  { value: "LC", label: "LC" },
  { value: "ST", label: "ST" },
]

export function ProductDialog({ open, onOpenChange, product }: ProductDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [families, setFamilies] = useState<{ id: number; name: string; state: string }[]>([])

  useEffect(() => {
    getFamiliesAction().then((data) => {
      if (Array.isArray(data)) setFamilies(data as { id: number; name: string; state: string }[])
    })
  }, [])

  // Inicializar formulário
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      id: product?.id,
      partnumber: product?.partnumber || "",
      description: product?.description || "",
      cfop: product?.cfop || "",
      nature: product?.nature || "",
      family: product?.family || "",
      ncm: product?.ncm || "",
      type: product?.type || "",
    },
  })

  // Atualizar formulário quando o produto mudar
  useEffect(() => {
    if (product) {
      form.reset({
        id: product.id,
        partnumber: product.partnumber || "",
        description: product.description || "",
        cfop: product.cfop || "",
        nature: product.nature || "",
        family: product.family || "",
        ncm: product.ncm || "",
        type: product.type || "",
      })
    } else {
      form.reset({
        id: undefined,
        partnumber: "",
        description: "",
        cfop: "",
        nature: "",
        family: "",
        ncm: "",
        type: "",
      })
    }
  }, [product, form])

  // Enviar formulário
  const onSubmit = async (data: ProductFormValues) => {
    setIsLoading(true)
    try {
      let result

      if (data.id) {
        // Atualizar produto existente
        result = await updateProductAction(data)
      } else {
        // Criar novo produto
        result = await createProductAction(data)
      }

      if (result.error) {
        console.error("Erro ao salvar produto:", result.error)
        alert(result.error)
        setIsLoading(false)
        return
      }

      onOpenChange(true) // Fechar diálogo e recarregar dados
    } catch (error) {
      console.error("Erro ao salvar produto:", error)
      alert("Erro ao salvar produto: " + (error instanceof Error ? error.message : "Erro desconhecido"))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product ? "Editar Produto" : "Novo Produto"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="partnumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Partnumber</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Partnumber" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrição</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Descrição do produto" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                        {productTypes.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
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
                name="cfop"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CFOP</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="CFOP" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="nature"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Natureza</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Natureza" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="family"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Família</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ""}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione a família" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {families.map((f) => (
                          <SelectItem key={f.id} value={f.name}>
                            {f.name} ({f.state})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="ncm"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>NCM</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="NCM" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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

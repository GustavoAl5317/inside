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
import { taxpayerOptions, isCNPJComplete, formatCNPJ } from "@/lib/utils"
import { createCompanyAction, updateCompanyAction, lookupCNPJAction, lookupSintegraAction } from "@/lib/actions"
import { AlertCircle, CheckCircle, Database } from "lucide-react"

// Schema de validação para o formulário
const companySchema = z.object({
  id: z.number().optional(),
  cnpj: z.string().refine(isCNPJComplete, "CNPJ deve ter 14 dígitos"),
  name: z.string().min(1, "Nome é obrigatório"),
  stateRegistration: z.string().optional(),
  zipCode: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  neighborhood: z.string().optional(),
  address: z.string().optional(),
  number: z.string().optional(),
  complement: z.string().optional(),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  companyType: z.enum(["supplier", "customer", "interatell"]),
  isTaxpayer: z.boolean().optional(),
})

type CompanyFormValues = z.infer<typeof companySchema>

interface CompanyDialogProps {
  open: boolean
  onOpenChange: (reloadData: boolean) => void
  company?: any
}

export function CompanyDialog({ open, onOpenChange, company }: CompanyDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isLookingUpCNPJ, setIsLookingUpCNPJ] = useState(false)
  const [apiDataFetched, setApiDataFetched] = useState(false)
  const [apiMessage, setApiMessage] = useState<{
    type: "success" | "error" | "info"
    text: string
    source?: "database" | "api" | "manual"
  } | null>(null)

  // Inicializar formulário
  const form = useForm<CompanyFormValues>({
    resolver: zodResolver(companySchema),
    defaultValues: {
      id: company?.id,
      cnpj: company?.cnpj || "",
      name: company?.name || "",
      stateRegistration: company?.state_registration || "",
      zipCode: company?.zip_code || "",
      city: company?.city || "",
      state: company?.state || "",
      neighborhood: company?.neighborhood || "",
      address: company?.address || "",
      number: company?.number || "",
      complement: company?.complement || "",
      contactName: company?.contact_name || "",
      phone: company?.phone || "",
      email: company?.email || "",
      companyType: company?.company_type || "supplier",
      isTaxpayer: company?.is_taxpayer || false,
    },
  })

  // Atualizar formulário quando a empresa mudar
  useEffect(() => {
    if (company) {
      form.reset({
        id: company.id,
        cnpj: company.cnpj || "",
        name: company.name || "",
        stateRegistration: company.state_registration || "",
        zipCode: company.zip_code || "",
        city: company.city || "",
        state: company.state || "",
        neighborhood: company.neighborhood || "",
        address: company.address || "",
        number: company.number || "",
        complement: company.complement || "",
        contactName: company.contact_name || "",
        phone: company.phone || "",
        email: company.email || "",
        companyType: company.company_type || "supplier",
        isTaxpayer: company.is_taxpayer || false,
      })
      // Se estamos editando uma empresa existente, não precisamos consultar a API
      setApiDataFetched(true)
    } else {
      form.reset({
        id: undefined,
        cnpj: "",
        name: "",
        stateRegistration: "",
        zipCode: "",
        city: "",
        state: "",
        neighborhood: "",
        address: "",
        number: "",
        complement: "",
        contactName: "",
        phone: "",
        email: "",
        companyType: "supplier",
        isTaxpayer: false,
      })
      setApiDataFetched(false)
      setApiMessage(null)
    }
  }, [company, form])

  // Buscar dados do CNPJ
  const handleCNPJLookup = async (source: "api" | "sintegra" = "api") => {
    const cnpj = form.getValues("cnpj")
    if (!cnpj || !isCNPJComplete(cnpj)) {
      form.setError("cnpj", {
        type: "manual",
        message: "CNPJ inválido. Deve conter 14 dígitos.",
      })
      return
    }

    setIsLookingUpCNPJ(true)
    setApiMessage(null)

    try {
      let companyData
      const normalizedCnpj = formatCNPJ(cnpj)

      if (source === "sintegra") {
        // Para o Sintegra, precisamos da UF
        const state = form.getValues("state")
        if (!state) {
          form.setError("state", {
            type: "manual",
            message: "Selecione a UF para consulta no Sintegra",
          })
          return
        }

        companyData = await lookupSintegraAction(normalizedCnpj, state)
      } else {
        // Consulta padrão via API de CNPJ
        companyData = await lookupCNPJAction(normalizedCnpj)
      }

      if (companyData.error) {
        form.setError("cnpj", {
          type: "manual",
          message: companyData.error,
        })
        setApiMessage({
          type: "error",
          text: companyData.error,
        })
        setApiDataFetched(false)
        return
      }

      // Preencher formulário com dados da empresa
      form.setValue("name", companyData.name)
      form.setValue("stateRegistration", companyData.stateRegistration)
      form.setValue("zipCode", companyData.zipCode)
      form.setValue("city", companyData.city)
      form.setValue("state", companyData.state)
      form.setValue("neighborhood", companyData.neighborhood)
      form.setValue("address", companyData.address)
      form.setValue("number", companyData.number)
      form.setValue("complement", companyData.complement)
      form.setValue("contactName", companyData.contactName)
      form.setValue("phone", companyData.phone)
      form.setValue("email", companyData.email)

      // Se for do Sintegra, mostrar informações adicionais
      if (source === "sintegra" && companyData.source === "sintegra" && (companyData as any).situacao) {
        alert(
          `Informações adicionais do Sintegra:\n\nSituação: ${(companyData as any).situacao}\nRegime: ${(companyData as any).regime}\nData de início: ${(companyData as any).dataInicioAtividade}`,
        )
      }

      // Marcar que os dados foram obtidos da API
      setApiDataFetched(companyData.source === "api" || companyData.source === "database")

      // Exibir mensagem de sucesso
      if (companyData.message) {
        setApiMessage({
          type: "success",
          text: companyData.message,
          source: companyData.source as "database" | "api" | "manual",
        })
      }
    } catch (error) {
      form.setError("cnpj", {
        type: "manual",
        message: "Erro ao buscar CNPJ",
      })
      setApiMessage({
        type: "error",
        text: "Erro ao buscar CNPJ. Por favor, tente novamente.",
      })
      setApiDataFetched(false)
    } finally {
      setIsLookingUpCNPJ(false)
    }
  }

  // Enviar formulário
  const onSubmit = async (data: CompanyFormValues) => {
    // Se não estamos editando uma empresa existente e os dados não foram obtidos da API, não permitir o cadastro
    if (!data.id && !apiDataFetched) {
      setApiMessage({
        type: "error",
        text: "É necessário consultar o CNPJ na API Brasil antes de cadastrar a empresa.",
      })
      return
    }

    setIsLoading(true)
    try {
      let result

      if (data.id) {
        // Atualizar empresa existente
        result = await updateCompanyAction(data)
      } else {
        // Criar nova empresa
        result = await createCompanyAction(data)
      }

      if (result.error) {
        setApiMessage({
          type: "error",
          text: result.error || "Erro ao salvar empresa",
        })
        setIsLoading(false)
        return
      }

      onOpenChange(true) // Fechar diálogo e recarregar dados
    } catch (error) {
      setApiMessage({
        type: "error",
        text: "Erro ao salvar empresa",
      })
    } finally {
      setIsLoading(false)
    }
  }

  // Renderizar mensagem da API
  const renderApiMessage = () => {
    if (!apiMessage) return null

    // Ícone baseado na fonte dos dados
    let icon = <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />

    if (apiMessage.source === "database") {
      icon = <Database className="h-5 w-5 mt-0.5 flex-shrink-0" />
    } else if (apiMessage.source === "api") {
      icon = <CheckCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
    }

    switch (apiMessage.type) {
      case "success":
        return (
          <div className="bg-green-50 text-green-700 p-3 rounded-md flex items-start gap-2 mb-4">
            {icon}
            <div>{apiMessage.text}</div>
          </div>
        )
      case "error":
        return (
          <div className="bg-red-50 text-red-700 p-3 rounded-md flex items-start gap-2 mb-4">
            {icon}
            <div>{apiMessage.text}</div>
          </div>
        )
      case "info":
        return (
          <div className="bg-blue-50 text-blue-700 p-3 rounded-md flex items-start gap-2 mb-4">
            {icon}
            <div>{apiMessage.text}</div>
          </div>
        )
    }
  }

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{company ? "Editar Empresa" : "Nova Empresa"}</DialogTitle>
        </DialogHeader>

        {!company && (
          <div className="bg-blue-50 text-blue-700 p-3 rounded-md flex items-start gap-2 mb-4">
            <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
            <div>Para cadastrar uma nova empresa, é necessário consultar o CNPJ na API Brasil primeiro.</div>
          </div>
        )}

        {renderApiMessage()}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="cnpj"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>CNPJ</FormLabel>
                      <div className="flex gap-2">
                        <FormControl>
                          <Input {...field} placeholder="CNPJ" />
                        </FormControl>
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleCNPJLookup("api")}
                            disabled={isLookingUpCNPJ}
                          >
                            {isLookingUpCNPJ ? "Buscando..." : "Buscar API"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleCNPJLookup("sintegra")}
                            disabled={isLookingUpCNPJ}
                          >
                            Sintegra
                          </Button>
                        </div>
                      </div>
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
                        <Input {...field} placeholder="Nome da empresa" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="companyType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipo de Empresa</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione o tipo" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="supplier">Fornecedor</SelectItem>
                          <SelectItem value="customer">Cliente</SelectItem>
                          <SelectItem value="interatell">Interatell</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="stateRegistration"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Inscrição Estadual</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Inscrição Estadual" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {form.watch("companyType") === "customer" && (
                  <FormField
                    control={form.control}
                    name="isTaxpayer"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contribuinte</FormLabel>
                        <Select
                          onValueChange={(value) => field.onChange(value === "true")}
                          value={field.value ? "true" : "false"}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {taxpayerOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="zipCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>CEP</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="CEP" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cidade</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Cidade" />
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
                        <FormLabel>Estado (UF)</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="UF" maxLength={2} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="neighborhood"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bairro</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Bairro" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Endereço</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Endereço" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="number"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Número</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Número" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="complement"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Complemento</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Complemento" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="contactName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome do Contato</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Nome do contato" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Telefone</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Telefone" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Email" type="email" />
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
              <Button type="submit" disabled={isLoading || (!company && !apiDataFetched)}>
                {isLoading ? "Salvando..." : "Salvar"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

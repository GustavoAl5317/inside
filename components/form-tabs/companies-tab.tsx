"use client"

import { useState } from "react"
import type { UseFormReturn } from "react-hook-form"
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getCompanyByCNPJAction, getCompaniesAction } from "@/lib/actions"
import { formatCNPJ, taxpayerOptions, isCNPJComplete } from "@/lib/utils"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Search, Plus, Info, Database, AlertCircle } from "lucide-react"

interface CompaniesTabProps {
  form: UseFormReturn<any>
}

export function CompaniesTab({ form }: CompaniesTabProps) {
  const [companyTab, setCompanyTab] = useState("supplier")
  const [isLoading, setIsLoading] = useState({
    supplier: false,
    customer: false,
    interatell: false,
  })
  const [selectCompanyDialog, setSelectCompanyDialog] = useState<{
    open: boolean
    type: "supplier" | "customer" | "interatell"
  }>({
    open: false,
    type: "supplier",
  })
  const [companies, setCompanies] = useState<any[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [messages, setMessages] = useState<{
    supplier: { type: "info" | "success" | "error"; text: string } | null
    customer: { type: "info" | "success" | "error"; text: string } | null
    interatell: { type: "info" | "success" | "error"; text: string } | null
  }>({
    supplier: null,
    customer: null,
    interatell: null,
  })

  const handleCNPJLookup = async (type: "supplier" | "customer" | "interatell") => {
    const cnpj = form.getValues(`companies.${type}.cnpj`)

    if (!cnpj || !isCNPJComplete(cnpj)) {
      setMessages((prev) => ({
        ...prev,
        [type]: { type: "error", text: "CNPJ inválido. Deve conter 14 dígitos." },
      }))
      return
    }

    setIsLoading((prev) => ({ ...prev, [type]: true }))
    setMessages((prev) => ({ ...prev, [type]: null }))

    try {
      // Usar apenas a função que busca do banco de dados
      const companyData = await getCompanyByCNPJAction(formatCNPJ(cnpj))

      if (companyData.error) {
        setMessages((prev) => ({
          ...prev,
          [type]: { type: "error", text: companyData.error },
        }))
        return
      }

      // Format CNPJ
      form.setValue(`companies.${type}.cnpj`, companyData.cnpj)

      // Set company data
      form.setValue(`companies.${type}.name`, companyData.name)
      form.setValue(`companies.${type}.stateRegistration`, companyData.stateRegistration)
      form.setValue(`companies.${type}.zipCode`, companyData.zipCode)
      form.setValue(`companies.${type}.city`, companyData.city)
      form.setValue(`companies.${type}.state`, companyData.state)
      form.setValue(`companies.${type}.neighborhood`, companyData.neighborhood)
      form.setValue(`companies.${type}.address`, companyData.address)
      form.setValue(`companies.${type}.number`, companyData.number)
      form.setValue(`companies.${type}.complement`, companyData.complement)
      form.setValue(`companies.${type}.contactName`, companyData.contactName)
      form.setValue(`companies.${type}.phone`, companyData.phone)
      form.setValue(`companies.${type}.email`, companyData.email)

      // Se houver uma mensagem na resposta, exibimos para o usuário
      if (companyData.message) {
        setMessages((prev) => ({
          ...prev,
          [type]: { type: "success", text: companyData.message },
        }))
      }
    } catch (error) {
      setMessages((prev) => ({
        ...prev,
        [type]: { type: "error", text: "Erro ao processar CNPJ. Por favor, tente novamente." },
      }))
    } finally {
      setIsLoading((prev) => ({ ...prev, [type]: false }))
    }
  }

  // Abrir diálogo para selecionar empresa
  const handleOpenSelectCompany = async (type: "supplier" | "customer" | "interatell") => {
    setSelectCompanyDialog({
      open: true,
      type,
    })

    await loadCompanies()
  }

  // Carregar empresas cadastradas
  const loadCompanies = async () => {
    try {
      const data = await getCompaniesAction(searchQuery)
      setCompanies(data)
    } catch (error) {
      // Erro silencioso - não mostrar para o usuário
    }
  }

  // Pesquisar empresas
  const handleSearchCompanies = () => {
    loadCompanies()
  }

  // Selecionar empresa
  const handleSelectCompany = (company: any) => {
    const type = selectCompanyDialog.type

    form.setValue(`companies.${type}.cnpj`, company.cnpj)
    form.setValue(`companies.${type}.name`, company.name)
    form.setValue(`companies.${type}.stateRegistration`, company.state_registration)
    form.setValue(`companies.${type}.zipCode`, company.zip_code)
    form.setValue(`companies.${type}.city`, company.city)
    form.setValue(`companies.${type}.state`, company.state)
    form.setValue(`companies.${type}.neighborhood`, company.neighborhood)
    form.setValue(`companies.${type}.address`, company.address)
    form.setValue(`companies.${type}.number`, company.number)
    form.setValue(`companies.${type}.complement`, company.complement)
    form.setValue(`companies.${type}.contactName`, company.contact_name)
    form.setValue(`companies.${type}.phone`, company.phone)
    form.setValue(`companies.${type}.email`, company.email)

    // Ajuste para garantir que supplier integrationCode e omieId sejam setados corretamente
    if (type === "supplier") {
      form.setValue(`companies.${type}.integrationCode`, company.integration_code ?? "")
      form.setValue(`companies.${type}.omieId`, company.omie_id ?? "")
    }

    if (type === "customer" && company.is_taxpayer !== null) {
      form.setValue(`companies.${type}.isTaxpayer`, company.is_taxpayer)
    }

    setSelectCompanyDialog({ open: false, type: "supplier" })

    // Adiciona mensagem de sucesso
    setMessages((prev) => ({
      ...prev,
      [type]: {
        type: "success",
        text: "Empresa selecionada com sucesso do banco de dados!",
      },
    }))
  }

  const renderMessageAlert = (type: "supplier" | "customer" | "interatell") => {
    const message = messages[type]
    if (!message) return null

    switch (message.type) {
      case "info":
        return (
          <div className="bg-blue-50 text-blue-700 p-3 rounded-md flex items-start gap-2">
            <Info className="h-5 w-5 mt-0.5 flex-shrink-0" />
            <div>{message.text}</div>
          </div>
        )
      case "success":
        return (
          <div className="bg-green-50 text-green-700 p-3 rounded-md flex items-start gap-2">
            <Database className="h-5 w-5 mt-0.5 flex-shrink-0" />
            <div>{message.text}</div>
          </div>
        )
      case "error":
        return (
          <div className="bg-red-50 text-red-700 p-3 rounded-md flex items-start gap-2">
            <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
            <div>{message.text}</div>
          </div>
        )
    }
  }

  const renderCompanyFields = (type: "supplier" | "customer" | "interatell") => {
    return (
      <div className="space-y-4">
        <div className="flex gap-2">
          <FormField
            control={form.control}
            name={`companies.${type}.cnpj`}
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormLabel>CNPJ</FormLabel>
                <div className="flex gap-2">
                  <FormControl>
                    <Input {...field} placeholder="CNPJ" />
                  </FormControl>
                  <Button type="button" onClick={() => handleCNPJLookup(type)} disabled={isLoading[type]}>
                    {isLoading[type] ? "Buscando..." : "Buscar"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => handleOpenSelectCompany(type)}>
                    Selecionar
                  </Button>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {renderMessageAlert(type)}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name={`companies.${type}.name`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nome</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name={`companies.${type}.stateRegistration`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Inscrição Estadual (opcional)</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField
            control={form.control}
            name={`companies.${type}.zipCode`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>CEP</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name={`companies.${type}.city`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Cidade</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name={`companies.${type}.state`}
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name={`companies.${type}.neighborhood`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Bairro</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name={`companies.${type}.address`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Endereço</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name={`companies.${type}.number`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Número</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name={`companies.${type}.complement`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Complemento</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField
            control={form.control}
            name={`companies.${type}.contactName`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contato (opcional)</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name={`companies.${type}.phone`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Telefone (opcional)</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name={`companies.${type}.email`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email (opcional)</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {type === "customer" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="companies.customer.isTaxpayer"
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

            <FormField
              control={form.control}
              name="companies.customer.purchaseOrder"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>P.O.</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Informações das Empresas</h2>

      <Tabs value={companyTab} onValueChange={setCompanyTab} className="w-full">
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="supplier">Fornecedor</TabsTrigger>
          <TabsTrigger value="customer">Cliente Final</TabsTrigger>
          <TabsTrigger value="interatell">Interatell</TabsTrigger>
        </TabsList>

        <TabsContent value="supplier" className="p-4 border rounded-md">
          {renderCompanyFields("supplier")}
        </TabsContent>

        <TabsContent value="customer" className="p-4 border rounded-md">
          {renderCompanyFields("customer")}
        </TabsContent>

        <TabsContent value="interatell" className="p-4 border rounded-md">
          {renderCompanyFields("interatell")}
        </TabsContent>
      </Tabs>

      {/* Diálogo para selecionar empresa */}
      <Dialog
        open={selectCompanyDialog.open}
        onOpenChange={(open) => !open && setSelectCompanyDialog((prev) => ({ ...prev, open }))}
      >
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Selecionar Empresa</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Buscar por nome ou CNPJ..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1"
                onKeyDown={(e) => e.key === "Enter" && handleSearchCompanies()}
              />
              <Button onClick={handleSearchCompanies} variant="outline">
                <Search className="h-4 w-4 mr-2" /> Buscar
              </Button>
              <Button onClick={() => window.open("/empresas", "_blank")}>
                <Plus className="h-4 w-4 mr-2" /> Nova
              </Button>
            </div>

            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>CNPJ</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Cidade/UF</TableHead>
                    <TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {companies.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-4">
                        Nenhuma empresa encontrada
                      </TableCell>
                    </TableRow>
                  ) : (
                    companies.map((company) => (
                      <TableRow key={company.id}>
                        <TableCell>{formatCNPJ(company.cnpj)}</TableCell>
                        <TableCell>{company.name}</TableCell>
                        <TableCell>
                          {company.company_type === "supplier"
                            ? "Fornecedor"
                            : company.company_type === "customer"
                              ? "Cliente"
                              : "Interatell"}
                        </TableCell>
                        <TableCell>
                          {company.city}/{company.state}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" onClick={() => handleSelectCompany(company)}>
                            Selecionar
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

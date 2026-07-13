"use client"

import React from "react"
import { useState, useEffect } from "react"
import { type UseFormReturn, useFieldArray } from "react-hook-form"
import { FormField, FormControl } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ChevronDown, ChevronUp, Trash2, Plus, Search } from "lucide-react"
import { formatCurrency, states } from "@/lib/utils"
import { CurrencyInput } from "@/components/ui/currency-input"
import { searchProductsAction, getProductByIdAction, getProductsAction, getFamiliesAction } from "@/lib/actions"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface ProductsTabProps {
  form: UseFormReturn<any>
}

export function ProductsTab({ form }: ProductsTabProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [expandedRows, setExpandedRows] = useState<number[]>([])
  const [selectProductDialog, setSelectProductDialog] = useState<{
    open: boolean
  }>({
    open: false,
  })
  const [products, setProducts] = useState<any[]>([])
  const [activeProductTab, setActiveProductTab] = useState("details")
  const [families, setFamilies] = useState<any[]>([])
  const [isLoadingFamilies, setIsLoadingFamilies] = useState(false)

  const customers: any[] = form.watch("customers") ?? []

  const { fields, append, remove, update } = useFieldArray({
    control: form.control,
    name: "products",
  })

  useEffect(() => {
    // Carregar famílias para SP por padrão quando o componente é montado
    loadFamilies("SP")
  }, [])

  const handleSearch = async () => {
    if (searchQuery.length < 2) {
      return
    }

    setIsSearching(true)
    try {
      const results = await searchProductsAction(searchQuery)
      setSearchResults(results)
    } catch (error) {
      console.error("Error searching products:", error)
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }

  const handleSelectProduct = async (id: number) => {
    try {
      const product = await getProductByIdAction(id)

      if (product) {
        append({
          id: product.id,
          partnumber: product.partnumber,
          description: product.description,
          state: "SP", // Default state
          quantity: 1, // Default quantity
          unitCost: 0, // Default unit cost
          totalCost: 0, // Default total cost
          unitSale: 0, // Default unit sale
          totalSale: 0, // Default total sale
          cfop: product.cfop,
          nature: product.nature,
          ncm: product.ncm,
        })
      }
    } catch (error) {
      console.error("Error fetching product details:", error)
    }

    setSearchResults([])
    setSearchQuery("")
    setSelectProductDialog({ open: false })
  }

  const handleQuantityChange = (index: number, value: number) => {
    const unitCost = form.getValues(`products.${index}.unitCost`) || 0
    const unitSale = form.getValues(`products.${index}.unitSale`) || 0

    form.setValue(`products.${index}.quantity`, value)
    form.setValue(`products.${index}.totalCost`, value * unitCost)
    form.setValue(`products.${index}.totalSale`, value * unitSale)
  }

  const toggleRowExpand = (index: number) => {
    setExpandedRows((prev) => {
      if (prev.includes(index)) {
        return prev.filter((i) => i !== index)
      } else {
        return [...prev, index]
      }
    })
  }

  // Abrir diálogo para selecionar produto
  const handleOpenSelectProduct = async () => {
    setSelectProductDialog({
      open: true,
    })

    await loadProducts()
  }

  // Carregar produtos cadastrados
  const loadProducts = async () => {
    try {
      const data = await getProductsAction(searchQuery)
      setProducts(data)
    } catch (error) {
      console.error("Erro ao carregar produtos:", error)
    }
  }

  // Pesquisar produtos
  const handleSearchProducts = () => {
    loadProducts()
  }

  // Carregar famílias baseadas no estado selecionado
  const loadFamilies = async (state: string) => {
    if (!state) return

    setIsLoadingFamilies(true)
    try {
      console.log(`Carregando famílias para o estado: ${state}`)
      const data = await getFamiliesAction(state)
      console.log(`Famílias carregadas:`, data)
      setFamilies(data)
    } catch (error) {
      console.error("Erro ao carregar famílias:", error)
    } finally {
      setIsLoadingFamilies(false)
    }
  }

  // Quando o estado de um produto mudar, carregamos as famílias correspondentes
  const handleStateChange = (index: number, state: string) => {
    // Atualizar o estado do produto
    form.setValue(`products.${index}.state`, state)

    // Limpar a família selecionada
    form.setValue(`products.${index}.family_id`, undefined)

    // Carregar famílias para o estado selecionado
    loadFamilies(state)
  }

  // Calcular totais
  const calculateTotals = () => {
    const products = form.getValues("products") || []

    const totalCost = products.reduce((sum: number, product: any) => sum + (product.totalCost || 0), 0)
    const totalSale = products.reduce((sum: number, product: any) => sum + (product.totalSale || 0), 0)
    const profit = totalSale - totalCost
    const profitMargin = totalCost > 0 ? (profit / totalCost) * 100 : 0

    return {
      totalCost,
      totalSale,
      profit,
      profitMargin,
    }
  }

  const totals = calculateTotals()

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Produtos</h2>

      <div className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Buscar produto por partnumber ou descrição..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1"
          />
          <Button type="button" onClick={handleSearch} disabled={isSearching || searchQuery.length < 2}>
            {isSearching ? "Buscando..." : "Buscar"}
          </Button>
          <Button type="button" variant="outline" onClick={handleOpenSelectProduct}>
            Selecionar
          </Button>
        </div>

        {searchResults.length > 0 && (
          <div className="border rounded-md p-2">
            <h3 className="font-medium mb-2">Resultados da busca:</h3>
            <ul className="space-y-1">
              {searchResults.map((product) => (
                <li key={product.id} className="flex justify-between items-center p-2 hover:bg-muted/50 rounded-md">
                  <span>
                    {product.partnumber} - {product.description}
                  </span>
                  <Button type="button" size="sm" onClick={() => handleSelectProduct(product.id)}>
                    Adicionar
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {fields.length > 0 ? (
          <div className="space-y-4">
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Partnumber</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Destino</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Família</TableHead>
                    <TableHead>Quantidade</TableHead>
                    <TableHead>Custo Unitário</TableHead>
                    <TableHead>Custo Total</TableHead>
                    <TableHead>Venda Unitária</TableHead>
                    <TableHead>Venda Total</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fields.map((field, index) => (
                    <React.Fragment key={field.id}>
                      <TableRow>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => toggleRowExpand(index)}>
                            {expandedRows.includes(index) ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </Button>
                        </TableCell>
                        <TableCell>{form.getValues(`products.${index}.partnumber`)}</TableCell>
                        <TableCell>{form.getValues(`products.${index}.description`)}</TableCell>
                        <TableCell>
                          <FormField
                            control={form.control}
                            name={`products.${index}.destinoCliente`}
                            render={({ field }) => (
                              <Select onValueChange={field.onChange} value={field.value ?? "__all__"}>
                                <FormControl>
                                  <SelectTrigger className="w-36">
                                    <SelectValue placeholder="Todos" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="__all__">Todos os clientes</SelectItem>
                                  {customers.map((c: any, i: number) => (
                                    <SelectItem key={i} value={String(i)}>
                                      {c.name || `Cliente ${i + 1}`}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          />
                        </TableCell>
                        <TableCell>
                          <FormField
                            control={form.control}
                            name={`products.${index}.state`}
                            render={({ field }) => (
                              <Select
                                onValueChange={(value) => handleStateChange(index, value)}
                                defaultValue={field.value}
                              >
                                <FormControl>
                                  <SelectTrigger className="w-20">
                                    <SelectValue placeholder="Estado" />
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
                            )}
                          />
                        </TableCell>
                        <TableCell>
                          <FormField
                            control={form.control}
                            name={`products.${index}.family_id`}
                            render={({ field }) => (
                              <Select
                                onValueChange={field.onChange}
                                value={field.value?.toString() || ""}
                                disabled={!form.getValues(`products.${index}.state`) || isLoadingFamilies}
                              >
                                <FormControl>
                                  <SelectTrigger className="w-32">
                                    <SelectValue placeholder="Família" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {families.length > 0 ? (
                                    families.map((family) => (
                                      <SelectItem key={family.id} value={family.id.toString()}>
                                        {family.name}
                                      </SelectItem>
                                    ))
                                  ) : (
                                    <SelectItem value="none" disabled>
                                      Nenhuma família encontrada para este estado
                                    </SelectItem>
                                  )}
                                </SelectContent>
                              </Select>
                            )}
                          />
                        </TableCell>
                        <TableCell>
                          <FormField
                            control={form.control}
                            name={`products.${index}.quantity`}
                            render={({ field }) => (
                              <FormControl>
                                <Input
                                  type="number"
                                  className="w-20"
                                  {...field}
                                  onChange={(e) => handleQuantityChange(index, Number.parseInt(e.target.value) || 0)}
                                />
                              </FormControl>
                            )}
                          />
                        </TableCell>
                        <TableCell>
                          <FormField
                            control={form.control}
                            name={`products.${index}.unitCost`}
                            render={({ field }) => (
                              <FormControl>
                                <div className="relative">
                                  <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 z-10">
                                    R$
                                  </span>
                                  <CurrencyInput
                                    className="w-28 pl-8"
                                    value={field.value || 0}
                                    resetKey={`${index}:cost:${field.value ?? 0}`}
                                    onChange={v => {
                                      field.onChange(v)
                                      const quantity = form.getValues(`products.${index}.quantity`) || 0
                                      form.setValue(`products.${index}.totalCost`, quantity * v)
                                    }}
                                  />
                                </div>
                              </FormControl>
                            )}
                          />
                        </TableCell>
                        <TableCell>{formatCurrency(form.getValues(`products.${index}.totalCost`) || 0)}</TableCell>
                        <TableCell>
                          <FormField
                            control={form.control}
                            name={`products.${index}.unitSale`}
                            render={({ field }) => (
                              <FormControl>
                                <div className="relative">
                                  <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 z-10">
                                    R$
                                  </span>
                                  <CurrencyInput
                                    className="w-28 pl-8"
                                    value={field.value || 0}
                                    resetKey={`${index}:sale:${field.value ?? 0}`}
                                    onChange={v => {
                                      field.onChange(v)
                                      const quantity = form.getValues(`products.${index}.quantity`) || 0
                                      form.setValue(`products.${index}.totalSale`, quantity * v)
                                    }}
                                  />
                                </div>
                              </FormControl>
                            )}
                          />
                        </TableCell>
                        <TableCell>{formatCurrency(form.getValues(`products.${index}.totalSale`) || 0)}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => remove(index)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                      {expandedRows.includes(index) && (
                        <TableRow>
                          <TableCell colSpan={12}>
                            <div className="p-4 bg-muted/20">
                              <Tabs value={activeProductTab} onValueChange={setActiveProductTab} className="w-full">
                                <TabsList className="grid grid-cols-2 w-full max-w-md">
                                  <TabsTrigger value="details">Detalhes do Produto</TabsTrigger>
                                  <TabsTrigger value="costs">Custos e Vendas</TabsTrigger>
                                </TabsList>

                                <TabsContent value="details" className="pt-4">
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div>
                                      <span className="font-medium">Partnumber:</span>{" "}
                                      {form.getValues(`products.${index}.partnumber`)}
                                    </div>
                                    <div>
                                      <span className="font-medium">Descrição:</span>{" "}
                                      {form.getValues(`products.${index}.description`)}
                                    </div>
                                    <div>
                                      <span className="font-medium">CFOP:</span>{" "}
                                      {form.getValues(`products.${index}.cfop`)}
                                    </div>
                                    <div>
                                      <span className="font-medium">Natureza:</span>{" "}
                                      {form.getValues(`products.${index}.nature`)}
                                    </div>
                                    <div>
                                      <span className="font-medium">NCM:</span>{" "}
                                      {form.getValues(`products.${index}.ncm`)}
                                    </div>
                                  </div>
                                </TabsContent>

                                <TabsContent value="costs" className="pt-4">
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div>
                                      <span className="font-medium">Quantidade:</span>{" "}
                                      {form.getValues(`products.${index}.quantity`)}
                                    </div>
                                    <div>
                                      <span className="font-medium">Custo Unitário:</span>{" "}
                                      {formatCurrency(form.getValues(`products.${index}.unitCost`) || 0)}
                                    </div>
                                    <div>
                                      <span className="font-medium">Custo Total:</span>{" "}
                                      {formatCurrency(form.getValues(`products.${index}.totalCost`) || 0)}
                                    </div>
                                    <div>
                                      <span className="font-medium">Venda Unitária:</span>{" "}
                                      {formatCurrency(form.getValues(`products.${index}.unitSale`) || 0)}
                                    </div>
                                    <div>
                                      <span className="font-medium">Venda Total:</span>{" "}
                                      {formatCurrency(form.getValues(`products.${index}.totalSale`) || 0)}
                                    </div>
                                    <div>
                                      <span className="font-medium">Lucro:</span>{" "}
                                      {formatCurrency(
                                        (form.getValues(`products.${index}.totalSale`) || 0) -
                                          (form.getValues(`products.${index}.totalCost`) || 0),
                                      )}
                                    </div>
                                    <div>
                                      <span className="font-medium">Margem:</span>{" "}
                                      {form.getValues(`products.${index}.totalCost`) > 0
                                        ? (
                                            (((form.getValues(`products.${index}.totalSale`) || 0) -
                                              (form.getValues(`products.${index}.totalCost`) || 0)) /
                                              (form.getValues(`products.${index}.totalCost`) || 0)) *
                                            100
                                          ).toFixed(2)
                                        : "0.00"}
                                      %
                                    </div>
                                  </div>
                                </TabsContent>
                              </Tabs>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Resumo dos totais */}
            <div className="p-4 bg-muted/20 rounded-md">
              <h3 className="font-medium mb-2">Resumo</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <span className="font-medium">Custo Total:</span> {formatCurrency(totals.totalCost)}
                </div>
                <div>
                  <span className="font-medium">Venda Total:</span> {formatCurrency(totals.totalSale)}
                </div>
                <div>
                  <span className="font-medium">Lucro:</span> {formatCurrency(totals.profit)}
                </div>
                <div>
                  <span className="font-medium">Margem de Lucro:</span> {totals.profitMargin.toFixed(2)}%
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-8 text-center border rounded-md">
            <p className="text-muted-foreground">
              Nenhum produto selecionado. Use o campo de busca acima para adicionar produtos.
            </p>
          </div>
        )}
      </div>

      {/* Diálogo para selecionar produto */}
      <Dialog
        open={selectProductDialog.open}
        onOpenChange={(open) => !open && setSelectProductDialog((prev) => ({ ...prev, open }))}
      >
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Selecionar Produto</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Buscar por partnumber ou descrição..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1"
                onKeyDown={(e) => e.key === "Enter" && handleSearchProducts()}
              />
              <Button onClick={handleSearchProducts} variant="outline">
                <Search className="h-4 w-4 mr-2" /> Buscar
              </Button>
              <Button onClick={() => window.open("/produtos", "_blank")}>
                <Plus className="h-4 w-4 mr-2" /> Novo
              </Button>
            </div>

            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Partnumber</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>CFOP</TableHead>
                    <TableHead>Natureza</TableHead>
                    <TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-4">
                        Nenhum produto encontrado
                      </TableCell>
                    </TableRow>
                  ) : (
                    products.map((product) => (
                      <TableRow key={product.id}>
                        <TableCell>{product.partnumber}</TableCell>
                        <TableCell>{product.description}</TableCell>
                        <TableCell>{product.cfop}</TableCell>
                        <TableCell>{product.nature}</TableCell>
                        <TableCell>
                          <Button size="sm" onClick={() => handleSelectProduct(product.id)}>
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

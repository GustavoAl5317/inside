"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Search, Edit, Trash2 } from "lucide-react"
import { ProductDialog } from "./product-dialog"
import { getProductsAction, deleteProductAction, getFamiliesAction } from "@/lib/actions"

export function ProductList() {
  const [products, setProducts] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [filterFamily, setFilterFamily] = useState("")
  const [families, setFamilies] = useState<{ id: number; name: string; state: string }[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [currentProduct, setCurrentProduct] = useState<any>(null)

  // Carregar famílias para o filtro
  useEffect(() => {
    getFamiliesAction().then((data) => {
      if (Array.isArray(data)) setFamilies(data as { id: number; name: string; state: string }[])
    })
  }, [])

  // Carregar produtos
  const loadProducts = async () => {
    setIsLoading(true)
    try {
      const data = await getProductsAction(searchQuery)
      setProducts(data)
    } catch (error) {
      console.error("Erro ao carregar produtos:", error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadProducts()
  }, [])

  // Abrir diálogo para adicionar novo produto
  const handleAddProduct = () => {
    setCurrentProduct(null)
    setDialogOpen(true)
  }

  // Abrir diálogo para editar produto existente
  const handleEditProduct = (product: any) => {
    setCurrentProduct(product)
    setDialogOpen(true)
  }

  // Excluir produto
  const handleDeleteProduct = async (id: number) => {
    if (confirm("Tem certeza que deseja excluir este produto?")) {
      try {
        const result = await deleteProductAction(id)

        if (result.error) {
          // Se há detalhes sobre transações, mostrar opção de exclusão forçada
          if (result.details?.canForceDelete) {
            const forceMessage = `${result.error}\n\nDetalhes: ${result.details.transactionItemCount} itens (${result.details.statusSummary})\n\nDeseja excluir mesmo assim? Os itens das transações serão removidos.`

            if (confirm(forceMessage)) {
              const forceResult = await deleteProductAction(id, true)

              if (forceResult.error) {
                alert(forceResult.error)
                return
              }

              alert(forceResult.message || "Produto excluído com sucesso!")
              loadProducts()
            }
          } else {
            alert(result.error)
          }
          return
        }

        alert(result.message || "Produto excluído com sucesso!")
        loadProducts() // Recarregar lista após exclusão
      } catch (error) {
        console.error("Erro ao excluir produto:", error)
        alert("Erro ao excluir produto")
      }
    }
  }

  // Pesquisar produtos
  const handleSearch = () => {
    loadProducts()
  }

  // Fechar diálogo e recarregar produtos se necessário
  const handleDialogClose = (reloadData: boolean) => {
    setDialogOpen(false)
    if (reloadData) {
      loadProducts()
    }
  }

  // Filtrar produtos por família (client-side)
  const filteredProducts = filterFamily && filterFamily !== "all"
    ? products.filter((p) => p.family === filterFamily)
    : products

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div className="flex gap-2 items-center flex-wrap">
          <Input
            placeholder="Buscar produtos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="w-56"
          />
          <Button variant="outline" onClick={handleSearch}>
            <Search className="h-4 w-4" />
          </Button>
          <Select value={filterFamily} onValueChange={setFilterFamily}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Filtrar por família" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as famílias</SelectItem>
              {families.map((f) => (
                <SelectItem key={f.id} value={f.name}>
                  {f.name} ({f.state})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleAddProduct}>
          <Plus className="h-4 w-4 mr-2" /> Novo Produto
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-8">Carregando produtos...</div>
      ) : (
        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Partnumber</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>CFOP</TableHead>
                <TableHead>Natureza</TableHead>
                <TableHead>Família</TableHead>
                <TableHead>NCM</TableHead>
                <TableHead className="w-[100px]">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProducts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    Nenhum produto encontrado
                  </TableCell>
                </TableRow>
              ) : (
                filteredProducts.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell>{product.partnumber}</TableCell>
                    <TableCell>{product.description}</TableCell>
                    <TableCell>{product.cfop}</TableCell>
                    <TableCell>{product.nature}</TableCell>
                    <TableCell>{product.family}</TableCell>
                    <TableCell>{product.ncm}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="icon" onClick={() => handleEditProduct(product)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDeleteProduct(product.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <ProductDialog open={dialogOpen} onOpenChange={handleDialogClose} product={currentProduct} />
    </div>
  )
}

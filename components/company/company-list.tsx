"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Plus, Search, Edit, Trash2 } from "lucide-react"
import { formatCNPJ } from "@/lib/utils"
import { CompanyDialog } from "./company-dialog"
import { getCompaniesAction, deleteCompanyAction } from "@/lib/actions"

export function CompanyList() {
  const [companies, setCompanies] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [currentCompany, setCurrentCompany] = useState<any>(null)

  // Carregar empresas
  const loadCompanies = async () => {
    setIsLoading(true)
    try {
      const data = await getCompaniesAction(searchQuery)
      setCompanies(data)
    } catch (error) {
      console.error("Erro ao carregar empresas:", error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadCompanies()
  }, [])

  // Abrir diálogo para adicionar nova empresa
  const handleAddCompany = () => {
    setCurrentCompany(null)
    setDialogOpen(true)
  }

  // Abrir diálogo para editar empresa existente
  const handleEditCompany = (company: any) => {
    setCurrentCompany(company)
    setDialogOpen(true)
  }

  // Excluir empresa
  const handleDeleteCompany = async (id: number) => {
    if (confirm("Tem certeza que deseja excluir esta empresa?")) {
      try {
        const result = await deleteCompanyAction(id)

        if (result.error) {
          // Se há detalhes sobre transações, mostrar opção de exclusão forçada
          if (result.details?.canForceDelete) {
            const forceMessage = `${result.error}\n\nDetalhes: ${result.details.transactionCount} transações (${result.details.statusSummary})\n\nDeseja excluir mesmo assim? As referências nas transações serão removidas.`

            if (confirm(forceMessage)) {
              const forceResult = await deleteCompanyAction(id, true)

              if (forceResult.error) {
                alert(forceResult.error)
                return
              }

              alert(forceResult.message || "Empresa excluída com sucesso!")
              loadCompanies()
            }
          } else {
            alert(result.error)
          }
          return
        }

        alert(result.message || "Empresa excluída com sucesso!")
        loadCompanies() // Recarregar lista após exclusão
      } catch (error) {
        console.error("Erro ao excluir empresa:", error)
        alert("Erro ao excluir empresa")
      }
    }
  }

  // Pesquisar empresas
  const handleSearch = () => {
    loadCompanies()
  }

  // Fechar diálogo e recarregar empresas se necessário
  const handleDialogClose = (reloadData: boolean) => {
    setDialogOpen(false)
    if (reloadData) {
      loadCompanies()
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex gap-2 w-full max-w-sm">
          <Input
            placeholder="Buscar empresas..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <Button variant="outline" onClick={handleSearch}>
            <Search className="h-4 w-4" />
          </Button>
        </div>
        <Button onClick={handleAddCompany}>
          <Plus className="h-4 w-4 mr-2" /> Nova Empresa
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-8">Carregando empresas...</div>
      ) : (
        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>CNPJ</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Cidade/UF</TableHead>
                <TableHead>Contato</TableHead>
                <TableHead className="w-[100px]">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
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
                    <TableCell>{company.contact_name}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="icon" onClick={() => handleEditCompany(company)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDeleteCompany(company.id)}>
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

      <CompanyDialog open={dialogOpen} onOpenChange={handleDialogClose} company={currentCompany} />
    </div>
  )
}

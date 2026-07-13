"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Plus, Edit, Trash2, Download } from "lucide-react"
import { FamilyDialog } from "./family-dialog"
import { getFamiliesAction, deleteFamilyAction, seedFamiliesAction } from "@/lib/actions"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { states } from "@/lib/utils"

export function FamilyList() {
  const [families, setFamilies] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSeeding, setIsSeeding] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [filterState, setFilterState] = useState<string>("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [currentFamily, setCurrentFamily] = useState<any>(null)

  // Carregar famílias
  const loadFamilies = async () => {
    setIsLoading(true)
    try {
      const data = await getFamiliesAction(filterState || undefined)
      setFamilies(data)
    } catch (error) {
      console.error("Erro ao carregar famílias:", error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadFamilies()
  }, [filterState])

  // Abrir diálogo para adicionar nova família
  const handleAddFamily = () => {
    setCurrentFamily(null)
    setDialogOpen(true)
  }

  // Abrir diálogo para editar família existente
  const handleEditFamily = (family: any) => {
    setCurrentFamily(family)
    setDialogOpen(true)
  }

  // Excluir família
  const handleDeleteFamily = async (id: number) => {
    if (confirm("Tem certeza que deseja excluir esta família?")) {
      try {
        const result = await deleteFamilyAction(id)

        if (result.error) {
          alert(result.error)
          return
        }

        loadFamilies() // Recarregar lista após exclusão
      } catch (error) {
        console.error("Erro ao excluir família:", error)
        alert("Erro ao excluir família")
      }
    }
  }

  // Pesquisar famílias
  const handleSearch = () => {
    loadFamilies()
  }

  // Fechar diálogo e recarregar famílias se necessário
  const handleDialogClose = (reloadData: boolean) => {
    setDialogOpen(false)
    if (reloadData) {
      loadFamilies()
    }
  }

  // Filtrar por estado
  const handleFilterChange = (state: string) => {
    setFilterState(state)
  }

  // Importar famílias padrão (seed)
  const handleSeedFamilies = async () => {
    if (!confirm("Isso vai importar todas as famílias padrão (Barueri/SP e Espírito Santo/ES). Continuar?")) return
    setIsSeeding(true)
    try {
      const result = await seedFamiliesAction()
      if (result.error) { alert(result.error); return }
      alert(`Importação concluída! ${result.inserted} inseridas, ${result.updated} atualizadas.`)
      loadFamilies()
    } catch (error) {
      alert("Erro ao importar famílias")
    } finally {
      setIsSeeding(false)
    }
  }

  // Filtrar famílias pelo termo de busca
  const filteredFamilies = families.filter((family) => family.name.toLowerCase().includes(searchQuery.toLowerCase()))

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div className="flex gap-2 items-center flex-wrap">
          <Input
            placeholder="Buscar famílias..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-64"
          />
          <Select value={filterState} onValueChange={handleFilterChange}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {states.map((state) => (
                <SelectItem key={state.value} value={state.value}>
                  {state.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSeedFamilies} disabled={isSeeding}>
            <Download className="h-4 w-4 mr-2" />
            {isSeeding ? "Importando..." : "Importar Famílias Padrão"}
          </Button>
          <Button onClick={handleAddFamily}>
            <Plus className="h-4 w-4 mr-2" /> Nova Família
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-8">Carregando famílias...</div>
      ) : (
        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Código Omie</TableHead>
                <TableHead className="w-[100px]">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredFamilies.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8">
                    Nenhuma família encontrada
                  </TableCell>
                </TableRow>
              ) : (
                filteredFamilies.map((family) => (
                  <TableRow key={family.id}>
                    <TableCell>{family.name}</TableCell>
                    <TableCell>{family.state}</TableCell>
                    <TableCell className="font-mono text-sm text-gray-500">{family.omie_code || "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="icon" onClick={() => handleEditFamily(family)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDeleteFamily(family.id)}>
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

      <FamilyDialog open={dialogOpen} onOpenChange={handleDialogClose} family={currentFamily} />
    </div>
  )
}

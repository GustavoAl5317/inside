import { CompanyList } from "@/components/company/company-list"

export default function CompaniesPage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Cadastro de Empresas</h1>
          <p className="text-muted-foreground">Gerencie o cadastro de fornecedores, clientes e parceiros</p>
        </div>

        <CompanyList />
      </div>
    </div>
  )
}

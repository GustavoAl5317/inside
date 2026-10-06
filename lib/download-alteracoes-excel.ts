import type { PayloadChange } from './deal-payload-diff'
import type { DealIdentificacao } from './generate-alteracoes-excel'

/** Baixa a planilha de alterações do Deal Completo gerada no servidor. */
export async function downloadAlteracoesExcel(
  deal: DealIdentificacao,
  changes: PayloadChange[],
): Promise<void> {
  const resp = await fetch('/api/alteracoes-excel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deal, changes }),
  })
  const json = await resp.json().catch(() => null)
  if (!resp.ok || !json?.success) {
    throw new Error(json?.error || `Falha ao gerar a planilha (HTTP ${resp.status})`)
  }

  const bin = atob(json.base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = json.filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

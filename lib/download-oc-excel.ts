/**
 * Baixa as planilhas de Ordem de Compra geradas no servidor.
 *
 * A geração roda no servidor porque depende do modelo em templates/ e do
 * ExcelJS; aqui só disparamos o download de cada arquivo devolvido.
 */
export async function downloadOcExcels(values: any): Promise<number> {
  const resp = await fetch('/api/oc-excel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(values),
  })
  const json = await resp.json().catch(() => null)
  if (!resp.ok || !json?.success) {
    throw new Error(json?.error || `Falha ao gerar a planilha (HTTP ${resp.status})`)
  }

  const files: Array<{ filename: string; base64: string }> = json.files ?? []
  for (const f of files) {
    const bin = atob(f.base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = f.filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    // Navegadores ignoram downloads disparados em rajada; um respiro entre eles.
    await new Promise(r => setTimeout(r, 350))
  }
  return files.length
}

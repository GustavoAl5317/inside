"use client"

interface PedidosOmieProps {
  /** Resumo gravado pelo envio ao Omie (omie_response.resumo ou o log final). */
  resumo: any
  /** Payload do negócio, para mostrar o Número de Ordem de Compra de cada OC. */
  payload?: any
}

const semZeros = (v: unknown) => String(v ?? '').trim().replace(/^0+(?=\d)/, '')

/**
 * Pedidos que o negócio já tem no Omie — inclusive de um envio que falhou no
 * meio: o que chegou a ser criado aparece aqui, e o reenvio cria só o que falta.
 */
export function PedidosOmie({ resumo, payload }: PedidosOmieProps) {
  const criados = (l?: any[]) => (l ?? []).filter(x => !x?.erro && x?.numero)
  const oc = criados(resumo?.oc)
  const ov = criados(resumo?.ov)
  const os = criados(resumo?.os)
  const falhas = [...(resumo?.oc ?? []), ...(resumo?.ov ?? []), ...(resumo?.os ?? [])].filter(x => x?.erro).length
  if (!oc.length && !ov.length && !os.length) return null

  const chip = 'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[11px]'

  return (
    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-xs">
      <p className="mb-1.5 font-semibold text-emerald-800">Pedidos já criados no Omie</p>
      <div className="flex flex-wrap gap-1.5">
        {oc.map((o, i) => {
          const numeroOc = payload?.supplierGroups?.[o.grupoIdx]?.ocNumber
          return (
            <span key={`oc${i}`} className={`${chip} border-yellow-300 bg-yellow-50 text-yellow-800`} title={o.fornecedor}>
              OC {numeroOc ? `${numeroOc} · ` : ''}{semZeros(o.numero)}
              {o.fornecedor && <span className="font-sans text-yellow-700/70">· {String(o.fornecedor).slice(0, 18)}</span>}
            </span>
          )
        })}
        {ov.map((o, i) => (
          <span key={`ov${i}`} className={`${chip} border-blue-300 bg-blue-50 text-blue-800`} title={o.cliente}>
            OV {semZeros(o.numeroCurto ?? o.numero)}
            {o.cliente && <span className="font-sans text-blue-700/70">· {String(o.cliente).slice(0, 18)}</span>}
          </span>
        ))}
        {os.map((o, i) => (
          <span key={`os${i}`} className={`${chip} border-purple-300 bg-purple-50 text-purple-800`} title={o.cliente}>
            OS {semZeros(o.numero)} <span className="font-sans">({o.nat})</span>
            {o.cliente && <span className="font-sans text-purple-700/70">· {String(o.cliente).slice(0, 18)}</span>}
          </span>
        ))}
      </div>
      {falhas > 0 && (
        <p className="mt-1.5 text-amber-700">
          {falhas} pedido{falhas > 1 ? 's' : ''} não {falhas > 1 ? 'foram criados' : 'foi criado'} na última
          tentativa — o reenvio cria só o que falta, sem duplicar os de cima.
        </p>
      )}
    </div>
  )
}

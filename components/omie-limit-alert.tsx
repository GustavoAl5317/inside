'use client'

import { AlertTriangle } from 'lucide-react'
import { camposExcedidos } from '@/lib/omie-limites'

/**
 * Alerta de campo acima do limite do Omie.
 *
 * O Omie recusa o cadastro quando um campo passa do tamanho declarado na API, e
 * o envio para no meio. O cadastro vem do Bitrix, então o alerta aponta o campo
 * e o tamanho para corrigir na origem; o app não corta o texto por conta.
 *
 * `variant`: "card" no card do fornecedor/cliente já adicionado, "inline" no
 * diálogo de seleção, antes de confirmar.
 */
export function OmieLimitAlert({
  company,
  variant = 'card',
}: {
  company: any
  variant?: 'card' | 'inline'
}) {
  const fora = camposExcedidos(company)
  if (!fora.length) return null

  return (
    <div className={`rounded-lg border-2 border-amber-300 bg-amber-50 ${
      variant === 'inline' ? 'p-2.5' : 'px-4 py-2.5'
    }`}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-xs font-bold text-amber-900">
            {fora.length === 1
              ? 'Um campo passa do limite do Omie'
              : `${fora.length} campos passam do limite do Omie`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {fora.map(c => (
              <li key={c.campo} className="text-[11px] text-amber-900">
                <span className="font-semibold">{c.label}</span>
                {': '}
                {c.tamanho} de {c.limite} caracteres
                <span className="text-amber-700"> ({c.campoOmie})</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-amber-700 mt-1.5">
            O Omie recusa o cadastro assim. Corrija no Bitrix e recarregue a empresa.
          </p>
        </div>
      </div>
    </div>
  )
}

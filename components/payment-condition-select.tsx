"use client"

import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getBitrixAllPaymentConditionsAction } from "@/lib/actions"
import type { PaymentConditionKind } from "@/lib/payment-condition-utils"

type Condicao = { id: string | number; code?: string; name: string }
type Listas = { purchase: Condicao[]; sale: Condicao[] }

// As listas vêm do Bitrix e são as mesmas para o negócio inteiro. O cache de
// módulo evita uma consulta por card: a condição agora aparece em cada
// fornecedor e em cada cliente.
let cache: Listas | null = null
let carregando: Promise<void> | null = null

function carrega(): Promise<void> {
  carregando ??= getBitrixAllPaymentConditionsAction()
    .then(r => { if (r.success) cache = { purchase: r.purchase, sale: r.sale } })
    .catch(() => {})
    .then(() => {})
  return carregando
}

interface PaymentConditionSelectProps {
  kind: PaymentConditionKind
  value: string
  onChange: (valor: string) => void
  className?: string
}

/**
 * Condição de pagamento, de compra ou de venda.
 *
 * Fora do Bitrix24 a lista não carrega e o campo vira texto livre, como a aba
 * Negócio já fazia antes de a condição passar a ser por fornecedor e por cliente.
 */
export function PaymentConditionSelect({ kind, value, onChange, className }: PaymentConditionSelectProps) {
  const [listas, setListas] = useState<Listas | null>(cache)
  const [pronto, setPronto] = useState(!!cache)

  useEffect(() => {
    if (cache) return
    let vivo = true
    carrega().then(() => {
      if (!vivo) return
      setListas(cache)
      setPronto(true)
    })
    return () => { vivo = false }
  }, [])

  const atual = String(value ?? "").trim()

  if (pronto && !listas) {
    return (
      <Input
        className={className}
        placeholder={kind === "purchase" ? "Ex: A28 - Para 28 Dias" : "Ex: T54 - Para 30 Dias"}
        value={atual}
        onChange={e => onChange(e.target.value)}
      />
    )
  }

  const opcoes = listas?.[kind] ?? []
  // Mantém no Select o valor gravado no rascunho mesmo quando ele não está mais
  // na lista do Bitrix (condição desativada ou renomeada). Sem isto o campo abre
  // em branco e a seleção parece ter sumido.
  const comSalvo = atual && !opcoes.some(c => (c.code || c.name) === atual)
    ? [...opcoes, { id: `__salvo__${atual}`, code: atual, name: `${atual} (fora da lista atual)` }]
    : opcoes

  return (
    <Select value={atual} onValueChange={onChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={pronto ? "Selecione uma condição" : "Carregando..."} />
      </SelectTrigger>
      <SelectContent>
        {!pronto ? (
          <SelectItem value="__loading__" disabled>Carregando...</SelectItem>
        ) : comSalvo.length ? (
          comSalvo.map(c => (
            <SelectItem key={c.id} value={c.code || c.name}>{c.name}</SelectItem>
          ))
        ) : (
          <SelectItem value="__none__" disabled>Nenhuma condição cadastrada</SelectItem>
        )}
      </SelectContent>
    </Select>
  )
}

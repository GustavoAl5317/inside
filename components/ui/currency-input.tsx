'use client'

import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { formatBRLInput, parseBRL } from '@/lib/utils'

type CurrencyInputProps = Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & {
  value: number
  onChange: (value: number) => void
  /** Muda quando o item/pedido é recarregado — reinicia o texto do input. */
  resetKey?: string
}

/** Input de moeda BRL: digite "14.000,50" ou "14000" — formata ao sair do campo. */
export function CurrencyInput({ value, onChange, resetKey, className, ...props }: CurrencyInputProps) {
  const [text, setText] = useState(() => formatBRLInput(value))

  useEffect(() => {
    setText(formatBRLInput(value))
  }, [resetKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      placeholder="0,00"
      className={className}
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={() => {
        const n = parseBRL(text)
        onChange(n)
        setText(formatBRLInput(n))
      }}
    />
  )
}

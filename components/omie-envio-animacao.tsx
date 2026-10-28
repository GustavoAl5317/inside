'use client'

/**
 * Animações do envio ao Omie, no estilo de um vídeo curto: a Interatell de um
 * lado, o Omie do outro e os dados atravessando entre os dois.
 *
 * - `EnvioAoVivo`: faixa discreta enquanto o envio roda, em laço.
 * - `ResultadoEnvio`: a cena de fim, de uns 3 segundos, de sucesso ou de erro.
 *
 * O logo do Omie não está no projeto; vale a marca em texto. Quem respeita o
 * "reduzir movimento" do sistema vê só os quadros finais, sem deslocamento.
 */

import React from 'react'
import { motion, useReducedMotion } from 'framer-motion'

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? ''
const AZUL_INTERATELL = '#24236b'
const AZUL_OMIE = '#0ea5e9'
const VERMELHO = '#e11d48'

const suave = [0.22, 1, 0.36, 1] as const

function MarcaInteratell({ altura = 22 }: { altura?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`${BASE}/logo-interatell-nav-trim.png`}
      alt="Interatell"
      draggable={false}
      style={{ height: altura, width: 'auto' }}
      className="select-none"
    />
  )
}

function MarcaOmie({ tamanho = 22 }: { tamanho?: number }) {
  return (
    <span
      className="select-none font-extrabold leading-none tracking-tight"
      style={{ fontSize: tamanho, color: AZUL_OMIE }}
    >
      omie
    </span>
  )
}

function Cartao({ children, lado, atraso = 0 }: { children: React.ReactNode; lado: 'esquerda' | 'direita'; atraso?: number }) {
  const parado = useReducedMotion()
  return (
    <motion.div
      initial={parado ? false : { opacity: 0, x: lado === 'esquerda' ? -36 : 36, scale: 0.92 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ duration: 0.55, delay: atraso, ease: suave }}
      className="relative flex h-16 w-36 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-[0_12px_32px_-12px_rgba(36,35,107,0.35)]"
    >
      {children}
    </motion.div>
  )
}

export type StatusEtapa = 'ok' | 'aviso' | 'erro' | 'atual' | 'pendente'
export interface EtapaCena { chave: string; rotulo: string; status: StatusEtapa }

/** Ícone de cada etapa da checagem. */
function IconeEtapa({ status }: { status: StatusEtapa }) {
  const parado = useReducedMotion()
  if (status === 'ok' || status === 'aviso') {
    const cor = status === 'ok' ? AZUL_OMIE : '#d97706'
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full" style={{ background: cor }}>
        <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="#fff" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
          <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={parado ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.3 }} />
        </svg>
      </span>
    )
  }
  if (status === 'erro') {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full" style={{ background: VERMELHO }}>
        <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="#fff" strokeWidth={4} strokeLinecap="round">
          <path d="M7 7l10 10M17 7L7 17" />
        </svg>
      </span>
    )
  }
  if (status === 'atual') {
    return (
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
        {!parado && (
          <motion.span className="absolute inset-0 rounded-full" style={{ background: AZUL_OMIE }}
            animate={{ scale: [1, 1.8], opacity: [0.5, 0] }} transition={{ duration: 1.1, repeat: Infinity, ease: 'easeOut' }} />
        )}
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: AZUL_OMIE }} />
      </span>
    )
  }
  return <span className="h-4 w-4 shrink-0 rounded-full border-2 border-slate-200" />
}

const COR_TEXTO: Record<StatusEtapa, string> = {
  ok: 'text-slate-700', aviso: 'text-amber-700', erro: 'text-rose-700 font-semibold',
  atual: 'text-sky-700 font-semibold', pendente: 'text-slate-400',
}

/** Checagem das etapas, uma por linha, entrando em sequência. */
export function ChecagemEtapas({ etapas, atraso = 0, compacta = false }: { etapas: EtapaCena[]; atraso?: number; compacta?: boolean }) {
  const parado = useReducedMotion()
  return (
    <ul className={`grid gap-x-4 ${compacta ? 'grid-cols-2 gap-y-1 sm:grid-cols-3' : 'grid-cols-1 gap-y-1.5 sm:grid-cols-2'}`}>
      {etapas.map((e, i) => (
        <motion.li
          key={e.chave}
          className={`flex items-center gap-2 text-xs ${COR_TEXTO[e.status]}`}
          initial={parado ? false : { opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: atraso + i * 0.07, ease: suave }}
        >
          <IconeEtapa status={e.status} />
          <span className="truncate">{e.rotulo}</span>
        </motion.li>
      ))}
    </ul>
  )
}

/** Faixa que corre enquanto o envio está em andamento. */
export function EnvioAoVivo({ etapa, etapas }: { etapa?: string; etapas?: EtapaCena[] }) {
  const parado = useReducedMotion()
  return (
    <div className="rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-sky-50 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-24 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white">
          <MarcaInteratell altura={16} />
        </div>
        <div className="relative h-10 flex-1">
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-indigo-200 via-slate-200 to-sky-200" />
          {!parado && [0, 0.45, 0.9].map(atraso => (
            <motion.span
              key={atraso}
              className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full"
              style={{ background: `linear-gradient(90deg, ${AZUL_INTERATELL}, ${AZUL_OMIE})`, boxShadow: `0 0 10px ${AZUL_OMIE}` }}
              initial={{ left: '0%', opacity: 0 }}
              animate={{ left: ['0%', '100%'], opacity: [0, 1, 1, 0] }}
              transition={{ duration: 1.35, delay: atraso, repeat: Infinity, ease: 'easeInOut' }}
            />
          ))}
        </div>
        <div className="flex h-10 w-24 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white">
          <MarcaOmie tamanho={18} />
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-slate-500">
        {etapa ? `${etapa}…` : 'Enviando ao Omie…'}
      </p>
      {etapas && etapas.length > 0 && (
        <div className="mt-3 border-t border-slate-200 pt-3">
          <ChecagemEtapas etapas={etapas} compacta />
        </div>
      )}
    </div>
  )
}

/** Cena de fim do envio. Some sozinha (quem monta controla o tempo) ou com um clique. */
export function ResultadoEnvio({ tipo, detalhe, etapas = [], aoFechar }: {
  tipo: 'sucesso' | 'erro'
  /** No erro, a mensagem do Omie: é o que a pessoa precisa ler para corrigir. */
  detalhe?: string
  etapas?: EtapaCena[]
  aoFechar?: () => void
}) {
  const ok = tipo === 'sucesso'
  const parado = useReducedMotion()
  const cor = ok ? AZUL_OMIE : VERMELHO

  // Linha do tempo, em segundos.
  const T = { linha: 0.45, chegada: ok ? 1.15 : 0.95, selo: ok ? 1.25 : 1.05, texto: ok ? 1.45 : 1.3 }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.35 } }}
      className="absolute inset-0 z-[60] flex cursor-pointer items-center justify-center overflow-y-auto py-6"
      style={{ background: 'rgba(248,250,252,0.9)', backdropFilter: 'blur(8px)' }}
      onClick={aoFechar}
      role="status"
    >
      <div className="flex w-full max-w-xl flex-col items-center px-6">
        <div className="flex w-full items-center">
          <Cartao lado="esquerda"><MarcaInteratell altura={24} /></Cartao>

          {/* Trilho entre as marcas */}
          <div className="relative mx-2 h-16 flex-1">
            {/* No erro a linha parte ao meio: duas metades, a da direita cai. */}
            <motion.div
              className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full"
              style={{ width: ok ? '100%' : '50%', transformOrigin: 'left', background: `linear-gradient(90deg, ${AZUL_INTERATELL}, ${ok ? AZUL_OMIE : VERMELHO})` }}
              initial={parado ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.6, delay: T.linha, ease: suave }}
            />
            {!ok && (
              <motion.div
                className="absolute right-0 top-1/2 h-[3px] w-1/2 -translate-y-1/2 rounded-full bg-slate-300"
                style={{ transformOrigin: 'left' }}
                initial={parado ? false : { scaleX: 0, rotate: 0, y: 0, opacity: 1 }}
                animate={parado ? { opacity: 0.4 } : { scaleX: [0, 1, 1], rotate: [0, 0, 14], y: [0, 0, 16], opacity: [1, 1, 0.35] }}
                transition={{ duration: 1.2, delay: T.linha, times: [0, 0.45, 1], ease: 'easeInOut' }}
              />
            )}
            {/* Pacote de dados atravessando */}
            {!parado && (
              <motion.span
                className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full"
                style={{ background: cor, boxShadow: `0 0 0 4px ${cor}22, 0 0 18px ${cor}` }}
                initial={{ left: '0%', opacity: 0 }}
                animate={ok
                  ? { left: ['0%', '96%'], opacity: [0, 1, 1, 0] }
                  : { left: ['0%', '48%', '46%', '50%', '48%'], opacity: [0, 1, 1, 1, 0] }}
                transition={{ duration: T.chegada - T.linha + 0.15, delay: T.linha, ease: 'easeInOut' }}
              />
            )}
            {/* Selo central */}
            <motion.div
              className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white"
              style={{ boxShadow: `0 0 0 3px ${cor}, 0 10px 28px -6px ${cor}88` }}
              initial={parado ? false : { scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 17, delay: T.selo }}
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke={cor} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                {ok ? (
                  <motion.path d="M5 12.5l4.5 4.5L19 7.5"
                    initial={parado ? false : { pathLength: 0 }} animate={{ pathLength: 1 }}
                    transition={{ duration: 0.4, delay: T.selo + 0.15, ease: 'easeOut' }} />
                ) : (
                  <>
                    <motion.path d="M7 7l10 10" initial={parado ? false : { pathLength: 0 }} animate={{ pathLength: 1 }}
                      transition={{ duration: 0.25, delay: T.selo + 0.15 }} />
                    <motion.path d="M17 7L7 17" initial={parado ? false : { pathLength: 0 }} animate={{ pathLength: 1 }}
                      transition={{ duration: 0.25, delay: T.selo + 0.35 }} />
                  </>
                )}
              </svg>
            </motion.div>
          </div>

          {/* O Omie recebe: pulso no sucesso, tremida no erro. */}
          <motion.div
            animate={parado ? undefined : ok
              ? { scale: [1, 1, 1.07, 1] }
              : { x: [0, 0, -6, 6, -4, 4, 0], opacity: [1, 1, 1, 1, 1, 1, 0.55] }}
            transition={{ duration: ok ? 1.5 : 1.6, times: ok ? [0, 0.72, 0.85, 1] : [0, 0.6, 0.68, 0.76, 0.84, 0.92, 1] }}
          >
            <Cartao lado="direita" atraso={0.08}>
              <MarcaOmie tamanho={26} />
              {ok && !parado && (
                <motion.span
                  className="pointer-events-none absolute inset-0 rounded-2xl"
                  style={{ boxShadow: `0 0 0 2px ${AZUL_OMIE}` }}
                  initial={{ opacity: 0, scale: 1 }}
                  animate={{ opacity: [0, 0.9, 0], scale: [1, 1, 1.25] }}
                  transition={{ duration: 0.8, delay: T.chegada, ease: 'easeOut' }}
                />
              )}
            </Cartao>
          </motion.div>
        </div>

        <motion.div
          className="mt-7 text-center"
          initial={parado ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: T.texto, ease: suave }}
        >
          <p className="text-lg font-bold tracking-tight" style={{ color: ok ? AZUL_INTERATELL : VERMELHO }}>
            {ok ? 'Enviado ao Omie' : 'Envio interrompido'}
          </p>
          {ok && (
            <p className="mt-1 text-sm text-slate-500">
              {detalhe ?? 'Pedidos gravados no Omie e números no card do Bitrix.'}
            </p>
          )}
        </motion.div>

        {/* O que deu errado, com a etapa onde parou. */}
        {!ok && (
          <motion.div
            className="mt-4 w-full rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-left"
            initial={parado ? false : { opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.45, delay: T.texto + 0.15, ease: suave }}
          >
            {etapas.find(e => e.status === 'erro') && (
              <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-500">
                Parou em: {etapas.find(e => e.status === 'erro')!.rotulo}
              </p>
            )}
            <p className="mt-0.5 break-words text-sm font-medium text-rose-800">
              {detalhe || 'O Omie recusou o envio. Veja os logs detalhados.'}
            </p>
          </motion.div>
        )}

        {etapas.length > 0 && (
          <div className="mt-4 w-full rounded-xl border border-slate-200 bg-white/80 px-4 py-3">
            <ChecagemEtapas etapas={etapas} atraso={T.texto + 0.25} />
          </div>
        )}

        <motion.p
          className="mt-3 text-[11px] text-slate-400"
          initial={parado ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: T.texto + 0.8 }}
        >
          Clique para fechar
        </motion.p>
      </div>
    </motion.div>
  )
}

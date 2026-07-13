'use client'

import { useState, useCallback } from 'react'
import { OmieStageSidebar } from './omie-stage-sidebar'
import type { StageTab } from './omie-stage-sidebar'
import { MultiStepForm } from './multi-step-form'
import type { BitrixInsideSalesItem, CardDetails } from '@/lib/bitrix-service'
import { getInsideSalesCardDetailsAction, getDraftByBitrixDealIdAction } from '@/lib/actions'
import { Loader2, FileText, Send, Pencil, ClipboardList, ArrowLeft, MousePointerClick } from 'lucide-react'

export type FormMode = 'backlog' | 'omie' | 'update'

const MODE_CONFIG: Record<FormMode, { label: string; color: string; icon: typeof Send; desc: string }> = {
  backlog: {
    label: 'Backlog',
    color: 'bg-blue-100 text-blue-700 border-blue-200',
    icon: FileText,
    desc: 'Preencha o formulário e salve como rascunho com PDF.',
  },
  omie: {
    label: 'Processamento',
    color: 'bg-purple-100 text-purple-700 border-purple-200',
    icon: Send,
    desc: 'Revise os dados e envie diretamente ao Omie.',
  },
  update: {
    label: 'Atualização',
    color: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    icon: Pencil,
    desc: 'Altere o que precisar e reenvie ao Omie para atualizar os pedidos.',
  },
}

export function InsideSalesLayout({ embedded = false }: { embedded?: boolean }) {
  const [selectedItem, setSelectedItem]     = useState<BitrixInsideSalesItem | null>(null)
  const [cardDetails, setCardDetails]       = useState<CardDetails | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [formMode, setFormMode]             = useState<FormMode>('backlog')
  const [existingDeal, setExistingDeal]     = useState<{ id: number; payload: any } | null>(null)

  const handleBitrixSelect = useCallback(async (item: BitrixInsideSalesItem, stage: StageTab) => {
    setSelectedItem(item)
    setCardDetails(null)
    setExistingDeal(null)
    setFormMode(stage === 'backlog' ? 'backlog' : 'omie')
    setLoadingDetails(true)
    try {
      const bitrixId = item.xmlId ? String(item.xmlId) : String(item.id)
      // Carrega o rascunho pendente em ambos os estágios (backlog e processamento),
      // para reabrir o card já preenchido e não perder o que foi salvo.
      const [detailsResult, draftResult] = await Promise.all([
        getInsideSalesCardDetailsAction(item.id),
        getDraftByBitrixDealIdAction(bitrixId),
      ])
      if (detailsResult.success) {
        setCardDetails({
          item: detailsResult.item,
          clientCompany: detailsResult.clientCompany ?? null,
          assignedUser: detailsResult.assignedUser ?? null,
        })
      }
      if (draftResult?.success && draftResult.deal) {
        setExistingDeal(draftResult.deal)
      }
    } catch { /* fallback */ }
    finally { setLoadingDetails(false) }
  }, [])

  const handleClear = useCallback(() => {
    setSelectedItem(null)
    setCardDetails(null)
    setExistingDeal(null)
  }, [])

  const modeCfg = MODE_CONFIG[formMode]
  const ModeIcon = modeCfg.icon

  return (
    <div className={`flex overflow-hidden ${embedded ? 'h-full' : 'h-[calc(100vh-64px)]'}`}>
      <OmieStageSidebar
        selectedBitrixId={selectedItem?.id ?? null}
        onSelect={handleBitrixSelect}
      />

      <main className="flex-1 overflow-y-auto bg-gray-50 p-6">
        <div className="max-w-5xl mx-auto">
          {!selectedItem ? (
            <div className="flex flex-col items-center justify-center min-h-[420px] text-center px-4">
              <div className="w-full max-w-lg">
                <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center mx-auto mb-5">
                  <MousePointerClick size={28} className="text-blue-500" />
                </div>
                <h2 className="text-lg font-bold text-gray-800 mb-1">Iniciar um novo processo</h2>
                <p className="text-sm text-gray-500 mb-6">
                  Selecione um card do Bitrix24 na barra lateral para abrir o formulário.
                </p>

                <div className="space-y-3 text-left">
                  {[
                    { step: '1', icon: ClipboardList, title: 'Escolha a etapa', desc: 'Clique em Backlog ou Processamento na barra à esquerda', color: 'bg-blue-500' },
                    { step: '2', icon: ArrowLeft,      title: 'Selecione o card', desc: 'Clique no negócio que deseja processar', color: 'bg-indigo-500' },
                    { step: '3', icon: FileText,       title: 'Preencha o formulário', desc: 'Complete os dados e salve ou envie ao Omie', color: 'bg-purple-500' },
                  ].map(({ step, icon: Icon, title, desc, color }) => (
                    <div key={step} className="flex items-start gap-3 p-3.5 rounded-xl border border-gray-200 bg-white shadow-sm">
                      <div className={`w-8 h-8 rounded-lg ${color} flex items-center justify-center flex-shrink-0 text-white text-xs font-bold`}>
                        {step}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                          <Icon size={13} className="text-gray-400" />
                          {title}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">

              {/* Header */}
              <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 border-b">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${modeCfg.color}`}>
                        <ModeIcon size={10} />
                        {modeCfg.label}
                      </span>
                      {existingDeal && (
                        <span className="text-[10px] text-gray-500 font-medium">
                          Deal #{existingDeal.id}
                        </span>
                      )}
                    </div>

                    <h2 className="text-base font-semibold text-gray-900 leading-snug">
                      {selectedItem.title ?? `Item #${selectedItem.id}`}
                    </h2>

                    {loadingDetails && (
                      <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                        <Loader2 size={11} className="animate-spin" />
                        Carregando dados do Bitrix24...
                      </p>
                    )}

                    {!loadingDetails && cardDetails && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {cardDetails.clientCompany && (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded font-medium">
                            🏢 {cardDetails.clientCompany.name}
                            {cardDetails.clientCompany.cnpj ? ` · ${cardDetails.clientCompany.cnpj}` : ''}
                            {cardDetails.clientCompany.city ? ` · ${cardDetails.clientCompany.city}` : ''}
                          </span>
                        )}
                        {cardDetails.assignedUser && (
                          <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded font-medium">
                            👤 {cardDetails.assignedUser.fullName}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handleClear}
                    className="flex-shrink-0 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-100 px-2 py-1 rounded transition-colors"
                  >
                    Limpar
                  </button>
                </div>
              </div>

              {/* Mode banner */}
              <div className={`px-6 py-2 border-b text-xs flex items-center gap-2 ${
                formMode === 'backlog' ? 'bg-blue-50/60 text-blue-700' : 'bg-purple-50/60 text-purple-700'
              }`}>
                <ModeIcon size={12} className="shrink-0" />
                {modeCfg.desc}
              </div>

              {/* Form */}
              <div className="p-6">
                {loadingDetails ? (
                  <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
                    <Loader2 size={20} className="animate-spin" />
                    <span className="text-sm">Carregando dados...</span>
                  </div>
                ) : (
                  <MultiStepForm
                    selectedItem={selectedItem}
                    cardDetails={cardDetails}
                    mode={formMode}
                    existingDeal={existingDeal}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

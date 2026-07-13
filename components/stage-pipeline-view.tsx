'use client'

import { useState, useEffect, useCallback } from 'react'
import { getBitrixStagesAction, getInsideSalesByStageAction } from '@/lib/actions'
import type { BitrixStage, BitrixInsideSalesItem } from '@/lib/bitrix-service'

const BITRIX_BASE = 'https://interatell.bitrix24.com.br'
const ENTITY_TYPE_ID = 129

function formatDate(dateStr?: string) {
  if (!dateStr) return '-'
  try {
    return new Date(dateStr).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return dateStr
  }
}

function isClosedStage(statusId: string) {
  return statusId.endsWith(':SUCCESS') || statusId.endsWith(':FAIL')
}

function StageListItem({
  stage,
  selected,
  onClick,
}: {
  stage: BitrixStage
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-all border-r-2 ${
        selected
          ? 'bg-blue-50 border-blue-600'
          : 'border-transparent hover:bg-gray-50'
      }`}
    >
      <span
        className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5"
        style={{ backgroundColor: stage.COLOR || '#9ca3af' }}
      />
      <span
        className={`text-sm leading-tight ${
          selected ? 'text-blue-700 font-semibold' : 'text-gray-700'
        }`}
      >
        {stage.NAME}
      </span>
    </button>
  )
}

function ItemCard({ item }: { item: BitrixInsideSalesItem }) {
  const code = item.xmlId ? String(item.xmlId) : null
  const bitrixUrl = `${BITRIX_BASE}/crm/type/${ENTITY_TYPE_ID}/details/${item.id}/`

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-gray-900 truncate">
            {item.title || `Item #${item.id}`}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            {code && (
              <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-mono font-medium">
                {code}
              </span>
            )}
            <span className="text-gray-400">ID: {item.id}</span>
            <span>Criado: {formatDate(item.createdTime)}</span>
            {item.updatedTime && item.updatedTime !== item.createdTime && (
              <span>Atualizado: {formatDate(item.updatedTime)}</span>
            )}
          </div>
        </div>
        <a
          href={bitrixUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 text-xs text-blue-600 hover:text-blue-800 hover:underline whitespace-nowrap"
        >
          Ver no Bitrix →
        </a>
      </div>
    </div>
  )
}

export function StagePipelineView() {
  const [stages, setStages] = useState<BitrixStage[]>([])
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null)
  const [items, setItems] = useState<BitrixInsideSalesItem[]>([])
  const [itemTotal, setItemTotal] = useState(0)
  const [loadingStages, setLoadingStages] = useState(true)
  const [loadingItems, setLoadingItems] = useState(false)
  const [stageError, setStageError] = useState<string | null>(null)

  const loadStages = useCallback(async () => {
    setLoadingStages(true)
    setStageError(null)
    try {
      const result = await getBitrixStagesAction()
      if (result.success && result.stages) {
        setStages(result.stages)
        const first = result.stages.find(s => !isClosedStage(s.STATUS_ID))
        if (first) setSelectedStageId(first.STATUS_ID)
      } else {
        setStageError('Não foi possível carregar as etapas do Bitrix24.')
      }
    } catch {
      setStageError('Falha ao conectar com o Bitrix24.')
    } finally {
      setLoadingStages(false)
    }
  }, [])

  const loadItems = useCallback(async (stageId: string) => {
    setLoadingItems(true)
    setItems([])
    setItemTotal(0)
    try {
      const result = await getInsideSalesByStageAction(stageId)
      if (result.success) {
        setItems(result.items ?? [])
        setItemTotal(result.total ?? 0)
      }
    } catch {
      // show empty state silently
    } finally {
      setLoadingItems(false)
    }
  }, [])

  useEffect(() => {
    loadStages()
  }, [loadStages])

  useEffect(() => {
    if (selectedStageId) loadItems(selectedStageId)
  }, [selectedStageId, loadItems])

  const activeStages = stages.filter(s => !isClosedStage(s.STATUS_ID))
  const closedStages = stages.filter(s => isClosedStage(s.STATUS_ID))
  const selectedStage = stages.find(s => s.STATUS_ID === selectedStageId)

  return (
    <div className="flex h-[calc(100vh-190px)] overflow-hidden rounded-xl border border-gray-200 shadow-lg bg-white">
      {/* ── Left sidebar: stages ── */}
      <aside className="w-64 flex-shrink-0 border-r border-gray-200 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
          <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider">
            Etapas
          </p>
          <p className="text-xs text-gray-500 mt-0.5">Pipeline Inside Sales</p>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {loadingStages ? (
            <div className="px-4 space-y-2 mt-2">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" />
              ))}
            </div>
          ) : stageError ? (
            <div className="px-4 py-6 text-center text-xs text-red-500">{stageError}</div>
          ) : (
            <>
              {activeStages.length > 0 && (
                <>
                  <div className="px-4 pt-2 pb-1">
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
                      Em andamento
                    </span>
                  </div>
                  {activeStages.map(stage => (
                    <StageListItem
                      key={stage.STATUS_ID}
                      stage={stage}
                      selected={selectedStageId === stage.STATUS_ID}
                      onClick={() => setSelectedStageId(stage.STATUS_ID)}
                    />
                  ))}
                </>
              )}

              {closedStages.length > 0 && (
                <>
                  <div className="px-4 pt-4 pb-1">
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
                      Fechados
                    </span>
                  </div>
                  {closedStages.map(stage => (
                    <StageListItem
                      key={stage.STATUS_ID}
                      stage={stage}
                      selected={selectedStageId === stage.STATUS_ID}
                      onClick={() => setSelectedStageId(stage.STATUS_ID)}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </nav>
      </aside>

      {/* ── Right panel: cards for selected stage ── */}
      <main className="flex-1 flex flex-col overflow-hidden bg-gray-50">
        {/* Panel header */}
        {selectedStage ? (
          <>
            <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3 flex-shrink-0">
              <span
                className="w-3.5 h-3.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: selectedStage.COLOR || '#9ca3af' }}
              />
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-gray-900 truncate">
                  {selectedStage.NAME}
                </h2>
                {!loadingItems && (
                  <p className="text-xs text-gray-500">
                    {itemTotal === 0
                      ? 'Nenhum item nesta etapa'
                      : `${itemTotal} ${itemTotal === 1 ? 'item' : 'itens'}`}
                    {itemTotal > 50 && ' (exibindo os 50 mais recentes)'}
                  </p>
                )}
              </div>
              <button
                onClick={() => loadItems(selectedStage.STATUS_ID)}
                disabled={loadingItems}
                className="text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-3 py-1.5 rounded-md transition-colors disabled:opacity-40"
              >
                {loadingItems ? 'Carregando...' : 'Atualizar'}
              </button>
            </div>

            {/* Cards list */}
            <div className="flex-1 overflow-y-auto p-5">
              {loadingItems ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div
                      key={i}
                      className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse"
                    >
                      <div className="h-4 bg-gray-200 rounded w-2/3 mb-3" />
                      <div className="h-3 bg-gray-100 rounded w-1/3" />
                    </div>
                  ))}
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-16">
                  <span className="text-5xl mb-4">📋</span>
                  <p className="text-gray-500 font-medium">Nenhum item nesta etapa</p>
                  <p className="text-gray-400 text-sm mt-1">
                    Esta etapa está vazia no momento
                  </p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {items.map(item => (
                    <ItemCard key={item.id} item={item} />
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center">
            <div>
              <span className="text-5xl">👈</span>
              <p className="text-gray-500 font-medium mt-4">
                Selecione uma etapa para ver os itens
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

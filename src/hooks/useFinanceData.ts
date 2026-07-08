import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  isSupabaseConfigured,
  rowToEvent,
  supabase,
  type FinancialEventRow,
} from '@/lib/supabase'
import { generateDemoEvents, makeLiveEvent } from '@/lib/demoData'
import type { FinancialEvent, SyncState } from '@/lib/types'

/** Intervalo (ms) em que o modo demo injeta um novo lançamento "ao vivo". */
const DEMO_TICK_MS = 9_000

export interface UseFinanceData {
  events: FinancialEvent[]
  sync: SyncState
  /** Data de referência estável ("hoje") capturada na montagem. */
  now: Date
  /** Marca visual quando um novo lançamento acabou de chegar. */
  lastEventId: string | null
  refetch: () => void
}

/**
 * Fonte única de verdade dos lançamentos. Em produção, assina a tabela
 * `ca_financial_events` via Supabase Realtime (alimentada pela Edge Function que
 * faz polling da API do Conta Azul). Sem Supabase configurado, cai no modo
 * demonstração e simula chegadas em tempo real.
 */
export function useFinanceData(): UseFinanceData {
  // "Hoje" estável durante a sessão — evita recomputar métricas à toa.
  const nowRef = useRef(new Date())
  const now = nowRef.current

  const [events, setEvents] = useState<FinancialEvent[]>([])
  const [lastEventId, setLastEventId] = useState<string | null>(null)
  const [sync, setSync] = useState<SyncState>({
    source: isSupabaseConfigured ? 'live' : 'demo',
    status: 'conectando',
    lastSync: null,
  })

  // ── Modo LIVE (Supabase) ────────────────────────────────────────────────
  const loadLive = useCallback(async () => {
    if (!supabase) return
    const { data, error } = await supabase
      .from('ca_financial_events')
      .select('*')
      .order('due_date', { ascending: false })
      .limit(5000)

    if (error) {
      setSync((s) => ({ ...s, status: 'erro', message: error.message }))
      return
    }
    setEvents((data as FinancialEventRow[]).map(rowToEvent))
    setSync({ source: 'live', status: 'ativo', lastSync: new Date() })
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return
    let active = true

    void loadLive()

    const channel = supabase
      .channel('ca_financial_events_stream')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ca_financial_events' },
        (payload) => {
          if (!active) return
          const row = payload.new as FinancialEventRow
          setEvents((prev) => {
            const next = prev.filter((e) => e.id !== (row?.id ?? ''))
            if (row && (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE')) {
              next.unshift(rowToEvent(row))
              setLastEventId(row.id)
            }
            return next
          })
          setSync({ source: 'live', status: 'ativo', lastSync: new Date() })
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setSync((s) => ({ ...s, status: 'ativo', lastSync: new Date() }))
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setSync((s) => ({ ...s, status: 'erro' }))
        }
      })

    return () => {
      active = false
      void supabase?.removeChannel(channel)
    }
  }, [loadLive])

  // ── Modo DEMO ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (isSupabaseConfigured) return

    setEvents(generateDemoEvents(now))
    setSync({ source: 'demo', status: 'ativo', lastSync: new Date() })

    const id = window.setInterval(() => {
      const ev = makeLiveEvent(new Date())
      setEvents((prev) => [ev, ...prev])
      setLastEventId(ev.id)
      setSync({ source: 'demo', status: 'ativo', lastSync: new Date() })
    }, DEMO_TICK_MS)

    return () => window.clearInterval(id)
  }, [now])

  const refetch = useCallback(() => {
    if (isSupabaseConfigured) void loadLive()
    else setEvents(generateDemoEvents(new Date()))
  }, [loadLive])

  return useMemo(
    () => ({ events, sync, now, lastEventId, refetch }),
    [events, sync, now, lastEventId, refetch],
  )
}

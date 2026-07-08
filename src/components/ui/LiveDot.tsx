import type { SyncState } from '@/lib/types'
import { formatRelative, formatTime } from '@/lib/format'
import { useEffect, useState } from 'react'

const STATUS_COLOR: Record<SyncState['status'], string> = {
  ativo: 'var(--grn)',
  conectando: 'var(--ora)',
  erro: 'var(--red)',
  offline: 'var(--muted-fg)',
}

const STATUS_TEXT: Record<SyncState['status'], string> = {
  ativo: 'Ao vivo',
  conectando: 'Conectando',
  erro: 'Erro de sincronia',
  offline: 'Offline',
}

/** Selo "ao vivo" com ponto pulsante e horário da última sincronização. */
export function LiveDot({ sync }: { sync: SyncState }) {
  // Re-renderiza a cada 5s para o "há Xs" ficar fresco.
  const [, tick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 5000)
    return () => window.clearInterval(id)
  }, [])

  const color = STATUS_COLOR[sync.status]
  const isLivePulse = sync.status === 'ativo'

  return (
    <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
      <span
        className={`h-2 w-2 rounded-full ${isLivePulse ? 'fz-live-dot' : ''}`}
        style={{ background: color }}
      />
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg">
        {STATUS_TEXT[sync.status]}
      </span>
      <span className="text-[11px] text-muted-fg tnum">
        {sync.source === 'demo' ? 'demo · ' : ''}
        {sync.lastSync ? formatRelative(sync.lastSync) : '—'}
      </span>
      {sync.lastSync && (
        <span className="hidden text-[11px] text-muted-fg tnum sm:inline">
          {formatTime(sync.lastSync)}
        </span>
      )}
    </div>
  )
}

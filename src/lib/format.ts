/** Formatação pt-BR: moeda, números, percentuais e datas. */

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 2,
})

const brlCompact = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
})

const int = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

/** R$ 1.234,56 */
export function formatBRL(value: number): string {
  return brl.format(value)
}

/** R$ 1,2 mil / R$ 3,4 mi — para eixos e cards compactos. */
export function formatBRLCompact(value: number): string {
  return brlCompact.format(value)
}

export function formatInt(value: number): string {
  return int.format(value)
}

/** 0.1234 -> "12,3%" (1 casa). Aceita sinal opcional. */
export function formatPct(fraction: number, opts?: { signed?: boolean }): string {
  const pct = fraction * 100
  const sign = opts?.signed && pct > 0 ? '+' : ''
  return `${sign}${pct.toLocaleString('pt-BR', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  })}%`
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const dateShortFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
})

const timeFmt = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
})

/** "08/07/2026" a partir de ISO ou Date. */
export function formatDate(value: string | Date): string {
  return dateFmt.format(typeof value === 'string' ? new Date(value) : value)
}

/** "08 de jul" */
export function formatDateShort(value: string | Date): string {
  return dateShortFmt.format(typeof value === 'string' ? new Date(value) : value)
}

/** "14:03" */
export function formatTime(value: Date): string {
  return timeFmt.format(value)
}

/** "há 12s", "há 3min", "há 2h" — para o selo de última sincronização. */
export function formatRelative(from: Date, now: Date = new Date()): string {
  const secs = Math.max(0, Math.round((now.getTime() - from.getTime()) / 1000))
  if (secs < 5) return 'agora'
  if (secs < 60) return `há ${secs}s`
  const mins = Math.round(secs / 60)
  if (mins < 60) return `há ${mins}min`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `há ${hrs}h`
  const days = Math.round(hrs / 24)
  return `há ${days}d`
}

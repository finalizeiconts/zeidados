import type { MonthlyPoint } from '@/lib/types'
import { formatBRL, formatBRLCompact } from '@/lib/format'
import { linear, niceMax, smoothPath, useHoverIndex } from './chartUtils'

const W = 720
const H = 240
const PAD = { top: 18, right: 12, bottom: 26, left: 44 }

/**
 * Linha do resultado líquido mensal (receita − despesa). Série única → sem
 * legenda; o título nomeia a série. Área com gradiente e linha de base no zero.
 */
export function ResultLineChart({ data }: { data: MonthlyPoint[] }) {
  const plotH = H - PAD.top - PAD.bottom

  const values = data.map((d) => d.resultado)
  const rawMax = Math.max(1, ...values)
  const rawMin = Math.min(0, ...values)
  const max = niceMax(rawMax)
  const min = rawMin < 0 ? -niceMax(-rawMin) : 0

  const x = linear(0, Math.max(1, data.length - 1), PAD.left, W - PAD.right)
  const y = linear(min, max, PAD.top + plotH, PAD.top)
  const y0 = y(0)

  const pts: Array<[number, number]> = data.map((d, i) => [x(i), y(d.resultado)])
  const line = smoothPath(pts)
  const area =
    pts.length > 0
      ? `${line} L${pts[pts.length - 1][0]},${y0} L${pts[0][0]},${y0} Z`
      : ''

  const { ref, index, onMove, onLeave } = useHoverIndex(data.length)
  const hovered = index != null ? data[index] : null
  const ticks = [max, (max + min) / 2, min].filter((v, i, a) => a.indexOf(v) === i)

  return (
    <div className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 'auto' }}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        role="img"
        aria-label="Resultado líquido mensal"
      >
        <defs>
          <linearGradient id="resultFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--grn)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--grn)" stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={y(t) + 3}
              textAnchor="end"
              className="tnum"
              fontSize={9}
              fill="var(--muted-fg)"
            >
              {formatBRLCompact(t)}
            </text>
          </g>
        ))}

        {/* linha do zero destacada */}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={y0}
          y2={y0}
          stroke="var(--border-strong)"
          strokeWidth={1}
        />

        {area && <path d={area} fill="url(#resultFill)" />}
        {line && (
          <path
            d={line}
            fill="none"
            stroke="var(--grn)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* crosshair + ponto */}
        {hovered && index != null && (
          <>
            <line
              x1={x(index)}
              x2={x(index)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--border-strong)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle
              cx={x(index)}
              cy={y(hovered.resultado)}
              r={4}
              fill="var(--card)"
              stroke="var(--grn)"
              strokeWidth={2}
            />
          </>
        )}

        {data.map((d, i) => (
          <text
            key={d.month}
            x={x(i)}
            y={H - 8}
            textAnchor="middle"
            fontSize={9}
            fill="var(--muted-fg)"
          >
            {d.label}
          </text>
        ))}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute top-2 right-2 rounded-xl border border-border bg-card px-3 py-2 text-xs"
          style={{ boxShadow: 'var(--shadow)' }}
        >
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-fg">
            {hovered.label}
          </div>
          <div className="tnum font-semibold" style={{ color: hovered.resultado >= 0 ? 'var(--grn)' : 'var(--red)' }}>
            {formatBRL(hovered.resultado)}
          </div>
        </div>
      )}
    </div>
  )
}

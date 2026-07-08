import type { MonthlyPoint } from '@/lib/types'
import { formatBRL, formatBRLCompact } from '@/lib/format'
import { linear, niceMax, useHoverIndex } from './chartUtils'

const W = 720
const H = 280
const PAD = { top: 18, right: 8, bottom: 28, left: 44 }

interface Props {
  data: MonthlyPoint[]
}

/**
 * Barras agrupadas Receita × Despesa por mês (regime de caixa).
 * Duas séries → legenda sempre presente + cores semânticas (verde/vermelho).
 */
export function RevenueExpenseChart({ data }: Props) {
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const max = niceMax(Math.max(1, ...data.map((d) => Math.max(d.receita, d.despesa))))
  const y = linear(0, max, PAD.top + plotH, PAD.top)
  const baseY = PAD.top + plotH

  const slot = plotW / Math.max(1, data.length)
  const barW = Math.min(13, slot * 0.32)
  const gap = 2 // vão de 2px entre as barras do par
  const { ref, index, onMove, onLeave } = useHoverIndex(data.length)

  const ticks = [0, 0.5, 1].map((f) => f * max)
  const hovered = index != null ? data[index] : null

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
        aria-label="Receita e despesa mensal"
      >
        {/* grade horizontal + rótulos do eixo Y */}
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

        {data.map((d, i) => {
          const cx = PAD.left + slot * i + slot / 2
          const xRec = cx - barW - gap / 2
          const xDes = cx + gap / 2
          const isHover = index === i
          return (
            <g key={d.month} opacity={index == null || isHover ? 1 : 0.55}>
              {/* fundo de hover */}
              {isHover && (
                <rect
                  x={cx - slot / 2}
                  y={PAD.top}
                  width={slot}
                  height={plotH}
                  fill="var(--muted)"
                  opacity={0.5}
                />
              )}
              <rect
                x={xRec}
                y={y(d.receita)}
                width={barW}
                height={Math.max(0, baseY - y(d.receita))}
                rx={3}
                fill="var(--grn)"
              />
              <rect
                x={xDes}
                y={y(d.despesa)}
                width={barW}
                height={Math.max(0, baseY - y(d.despesa))}
                rx={3}
                fill="var(--red)"
              />
              <text
                x={cx}
                y={H - 10}
                textAnchor="middle"
                fontSize={9}
                fill="var(--muted-fg)"
              >
                {d.label}
              </text>
            </g>
          )
        })}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={baseY}
          y2={baseY}
          stroke="var(--border-strong)"
          strokeWidth={1}
        />
      </svg>

      {/* legenda */}
      <div className="mt-1 flex items-center gap-4 pl-11 text-[11px] text-muted-fg">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: 'var(--grn)' }} />
          Receita
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: 'var(--red)' }} />
          Despesa
        </span>
      </div>

      {/* tooltip */}
      {hovered && (
        <div
          className="pointer-events-none absolute top-2 right-2 rounded-xl border border-border bg-card px-3 py-2 text-xs"
          style={{ boxShadow: 'var(--shadow)' }}
        >
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-fg">
            {hovered.label}
          </div>
          <div className="flex items-center justify-between gap-4 tnum">
            <span className="text-muted-fg">Receita</span>
            <span style={{ color: 'var(--grn)' }}>{formatBRL(hovered.receita)}</span>
          </div>
          <div className="flex items-center justify-between gap-4 tnum">
            <span className="text-muted-fg">Despesa</span>
            <span style={{ color: 'var(--red)' }}>{formatBRL(hovered.despesa)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-4 border-t border-border pt-1 tnum">
            <span className="text-muted-fg">Resultado</span>
            <span className="font-semibold">{formatBRL(hovered.resultado)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

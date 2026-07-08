import { useCallback, useRef, useState } from 'react'

/** Escala linear domínio→intervalo. */
export function linear(
  d0: number,
  d1: number,
  r0: number,
  r1: number,
): (v: number) => number {
  const span = d1 - d0 || 1
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0)
}

/** "Nice" máximo arredondado para cima (1/2/5 × 10ⁿ) para o topo do eixo. */
export function niceMax(value: number): number {
  if (value <= 0) return 1
  const exp = Math.floor(Math.log10(value))
  const base = Math.pow(10, exp)
  const frac = value / base
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10
  return nice * base
}

/** Constrói o `d` de uma polilinha suave (Catmull-Rom → Bézier). */
export function smoothPath(pts: Array<[number, number]>): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`
  const d: string[] = [`M${pts[0][0]},${pts[0][1]}`]
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const t = 0.18
    const c1x = p1[0] + (p2[0] - p0[0]) * t
    const c1y = p1[1] + (p2[1] - p0[1]) * t
    const c2x = p2[0] - (p3[0] - p1[0]) * t
    const c2y = p2[1] - (p3[1] - p1[1]) * t
    d.push(`C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`)
  }
  return d.join(' ')
}

/**
 * Hover baseado na fração horizontal do mouse sobre o SVG (funciona mesmo com
 * viewBox escalado). Retorna o índice mais próximo em [0, count).
 */
export function useHoverIndex(count: number) {
  const ref = useRef<SVGSVGElement | null>(null)
  const [index, setIndex] = useState<number | null>(null)

  const onMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const el = ref.current
      if (!el || count === 0) return
      const rect = el.getBoundingClientRect()
      const frac = (e.clientX - rect.left) / rect.width
      const i = Math.round(frac * (count - 1))
      setIndex(Math.max(0, Math.min(count - 1, i)))
    },
    [count],
  )

  const onLeave = useCallback(() => setIndex(null), [])

  return { ref, index, onMove, onLeave }
}

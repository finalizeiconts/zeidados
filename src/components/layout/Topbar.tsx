import { Moon, Sun } from 'lucide-react'
import type { Theme } from '@/hooks/useTheme'
import type { SyncState } from '@/lib/types'
import { LiveDot } from '@/components/ui/LiveDot'

interface TopbarProps {
  eyebrow: string
  title: string
  theme: Theme
  onToggleTheme: () => void
  sync: SyncState
}

export function Topbar({ eyebrow, title, theme, onToggleTheme, sync }: TopbarProps) {
  return (
    <div
      className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border px-6"
      style={{ background: 'var(--bg)' }}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] text-[13px] font-bold tracking-[-0.02em]"
          style={{ background: 'var(--fg)', color: 'var(--bg)' }}
        >
          Fz
        </div>
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h1 className="mt-0.5 text-[18px] font-light leading-none tracking-[-0.4px]">
            {title}
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden md:block">
          <LiveDot sync={sync} />
        </div>
        <button
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-fg transition-colors hover:bg-muted"
        >
          {theme === 'dark' ? (
            <Sun size={17} strokeWidth={1.75} />
          ) : (
            <Moon size={17} strokeWidth={1.75} />
          )}
        </button>
      </div>
    </div>
  )
}

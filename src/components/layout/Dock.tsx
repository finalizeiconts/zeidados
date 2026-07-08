import {
  Activity,
  LayoutDashboard,
  Wallet,
  Receipt,
  PieChart,
  Settings,
  type LucideIcon,
} from 'lucide-react'

interface NavItem {
  id: string
  label: string
  icon: LucideIcon
}

const NAV: NavItem[] = [
  { id: 'painel', label: 'Painel', icon: LayoutDashboard },
  { id: 'financeiro', label: 'Financeiro', icon: Wallet },
  { id: 'lancamentos', label: 'Lançamentos', icon: Receipt },
  { id: 'relatorios', label: 'Relatórios', icon: PieChart },
]

interface DockProps {
  active: string
  onSelect: (id: string) => void
}

/** Dock vertical de 56px — navegação principal do app. */
export function Dock({ active, onSelect }: DockProps) {
  return (
    <aside className="sticky top-0 flex h-screen w-14 flex-none justify-center py-3">
      <div
        className="flex w-[46px] flex-col items-center gap-1 rounded-[18px] border border-border bg-sidebar py-2"
        style={{ boxShadow: 'var(--shadow)' }}
      >
        <div className="mb-1 flex h-[30px] w-[30px] items-center justify-center text-fg">
          <Activity size={18} strokeWidth={1.5} />
        </div>
        <div className="my-0.5 h-px w-6 bg-border" />

        {NAV.map((item) => {
          const isActive = item.id === active
          const Icon = item.icon
          return (
            <button
              key={item.id}
              title={item.label}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onSelect(item.id)}
              className="relative flex h-[34px] w-[34px] items-center justify-center rounded-full transition-colors"
              style={{
                background: isActive ? 'var(--sidebar-accent)' : 'transparent',
                color: isActive ? 'var(--fg)' : 'var(--muted-fg)',
              }}
            >
              {isActive && (
                <span
                  className="absolute top-1/2 h-[18px] w-0.5 -translate-y-1/2 rounded-r"
                  style={{ left: -6, background: 'var(--primary)' }}
                />
              )}
              <Icon size={18} strokeWidth={1.5} />
            </button>
          )
        })}

        <div className="my-0.5 h-px w-6 bg-border" />
        <button
          title="Configurações"
          aria-label="Configurações"
          className="flex h-[34px] w-[34px] items-center justify-center rounded-full text-muted-fg transition-colors hover:bg-sidebar-accent hover:text-fg"
        >
          <Settings size={18} strokeWidth={1.5} />
        </button>
      </div>
    </aside>
  )
}

import { useState } from 'react'
import { Dock } from '@/components/layout/Dock'
import { Topbar } from '@/components/layout/Topbar'
import { Dashboard } from '@/pages/Dashboard'
import { useTheme } from '@/hooks/useTheme'
import { useFinanceData } from '@/hooks/useFinanceData'

export default function App() {
  const { theme, toggle } = useTheme()
  const [nav, setNav] = useState('painel')
  const data = useFinanceData()

  return (
    <div className="flex min-h-screen">
      <Dock active={nav} onSelect={setNav} />
      <main className="min-w-0 flex-1">
        <Topbar
          eyebrow="Financeiro · Conta Azul"
          title="Painel financeiro"
          theme={theme}
          onToggleTheme={toggle}
          sync={data.sync}
        />
        <Dashboard data={data} />
      </main>
    </div>
  )
}

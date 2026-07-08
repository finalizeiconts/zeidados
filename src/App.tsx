import { useState } from 'react'
import { Dock } from '@/components/layout/Dock'
import { Topbar } from '@/components/layout/Topbar'
import { Dashboard } from '@/pages/Dashboard'
import { Login } from '@/pages/Login'
import { useTheme } from '@/hooks/useTheme'
import { useSession } from '@/hooks/useSession'
import { useFinanceData } from '@/hooks/useFinanceData'
import { isSupabaseConfigured } from '@/lib/supabase'

/** Miolo autenticado — só monta (e busca dados) quando pode ler o banco. */
function AuthedApp({ onSignOut }: { onSignOut?: () => void }) {
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
          onSignOut={onSignOut}
        />
        <Dashboard data={data} />
      </main>
    </div>
  )
}

export default function App() {
  const { session, loading, signIn, signOut } = useSession()

  // Modo live exige login (RLS: só `authenticated` lê os dados).
  if (isSupabaseConfigured) {
    if (loading) {
      return (
        <div className="flex min-h-screen items-center justify-center text-sm text-muted-fg">
          Carregando…
        </div>
      )
    }
    if (!session) {
      return <Login onSignIn={signIn} />
    }
    return <AuthedApp onSignOut={() => void signOut()} />
  }

  // Modo demonstração: sem login.
  return <AuthedApp />
}

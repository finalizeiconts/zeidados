import { useState, type FormEvent } from 'react'
import { Activity, Lock } from 'lucide-react'

interface LoginProps {
  onSignIn: (email: string, password: string) => Promise<string | null>
}

/** Tela de acesso ao painel (Supabase Auth) — estilo Finalizei. */
export function Login({ onSignIn }: LoginProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const err = await onSignIn(email.trim(), password)
    if (err) setError(err)
    setBusy(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-8"
        style={{ boxShadow: 'var(--shadow-lg)' }}
      >
        <div className="mb-6 flex items-center gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-xl"
            style={{ background: 'var(--fg)', color: 'var(--bg)' }}
          >
            <Activity size={18} strokeWidth={1.75} />
          </span>
          <div>
            <div className="eyebrow">Finalizei · Zei Dados</div>
            <h1 className="text-[20px] font-light tracking-[-0.4px]">
              Painel <span className="font-serif-italic">financeiro</span>
            </h1>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="email" className="eyebrow mb-1.5 block">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@finalizeicontabilidade.com"
              className="h-[38px] w-full rounded-lg border bg-card px-3 text-sm text-fg outline-none transition-colors"
              style={{ borderColor: 'var(--border-strong)' }}
            />
          </div>
          <div>
            <label htmlFor="password" className="eyebrow mb-1.5 block">
              Senha
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="h-[38px] w-full rounded-lg border bg-card px-3 text-sm text-fg outline-none transition-colors"
              style={{ borderColor: 'var(--border-strong)' }}
            />
          </div>

          {error && (
            <p className="text-[13px]" style={{ color: 'var(--red)' }} role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-1 inline-flex h-[38px] items-center justify-center gap-2 rounded-full text-[12px] font-bold uppercase tracking-[0.09em] transition-transform hover:-translate-y-px disabled:opacity-60"
            style={{ background: 'var(--fg)', color: 'var(--bg)' }}
          >
            <Lock size={15} strokeWidth={2} />
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-muted-fg">
          Acesso restrito. Dados sincronizados do Conta Azul em tempo real.
        </p>
      </div>
    </div>
  )
}

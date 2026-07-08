import { PlugZap } from 'lucide-react'

/**
 * Aparece no modo "live" quando ainda não há dados — leva o usuário ao fluxo
 * OAuth do Conta Azul. A URL vem de VITE_CA_CONNECT_URL (função ca-auth-start).
 */
export function ConnectBanner() {
  const connectUrl =
    import.meta.env.VITE_CA_CONNECT_URL ??
    'https://ehrdmbbqvkxejgtkpbjb.supabase.co/functions/v1/ca-auth-start'

  return (
    <div className="mb-9 flex flex-col items-start gap-4 rounded-2xl border border-border bg-card p-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span
          className="flex h-11 w-11 flex-none items-center justify-center rounded-xl"
          style={{ background: 'var(--fg)', color: 'var(--bg)' }}
        >
          <PlugZap size={20} strokeWidth={1.75} />
        </span>
        <div>
          <div className="text-[15px] font-semibold">Conecte sua conta do Conta Azul</div>
          <p className="mt-1 max-w-md text-[13px] text-muted-fg">
            Autorize o acesso para o painel começar a sincronizar suas receitas e
            despesas em tempo real. Leva menos de um minuto.
          </p>
        </div>
      </div>
      {connectUrl ? (
        <a
          href={connectUrl}
          className="inline-flex h-[38px] flex-none items-center gap-2 rounded-full px-[18px] text-[12px] font-bold uppercase tracking-[0.09em] transition-transform hover:-translate-y-px"
          style={{ background: 'var(--fg)', color: 'var(--bg)' }}
        >
          <PlugZap size={16} strokeWidth={1.75} />
          Conectar
        </a>
      ) : (
        <span className="text-[11px] text-muted-fg">
          Defina <code className="font-mono">VITE_CA_CONNECT_URL</code> no .env
        </span>
      )}
    </div>
  )
}

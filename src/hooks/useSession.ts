import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '@/lib/supabase'

interface UseSession {
  /** null = deslogado; Session = logado. `loading` cobre a 1ª checagem. */
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

/** Sessão do Supabase Auth (modo live). No modo demo, nunca exige login. */
export function useSession(): UseSession {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)

  useEffect(() => {
    if (!supabase) return
    let active = true

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (active) setSession(s)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  async function signIn(email: string, password: string): Promise<string | null> {
    if (!supabase) return 'Supabase não configurado.'
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (!error) return null
    if (/invalid login credentials/i.test(error.message)) {
      return 'E-mail ou senha incorretos.'
    }
    return error.message
  }

  async function signOut(): Promise<void> {
    await supabase?.auth.signOut()
  }

  return { session, loading, signIn, signOut }
}

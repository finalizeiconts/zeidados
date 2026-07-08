/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** URL pública da Edge Function ca-auth-start (botão "Conectar Conta Azul"). */
  readonly VITE_CA_CONNECT_URL?: string
  /** Defina "1" para forçar o modo demonstração (dados fictícios). */
  readonly VITE_DEMO?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

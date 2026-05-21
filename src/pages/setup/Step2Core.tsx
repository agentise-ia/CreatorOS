// Step 2 — Coleta credenciais core (Supabase x4 + Vercel + owner email/password).
import { useState } from 'react'
import { ValidatedInput } from './ValidatedInput'
import {
  validateSupabaseUrl,
  validateSupabaseAnonKey,
  validateSupabaseServiceRole,
  validateSupabasePAT,
  validateVercelToken,
  validateEmail,
  validatePassword,
} from './validators'
import type { CoreCredentials } from './wizardStorage'

interface Step2Props {
  value: CoreCredentials
  onChange: (next: CoreCredentials) => void
  onBack: () => void
  onSubmit: (final: CoreCredentials) => void
}

export default function Step2Core({ value, onChange, onBack, onSubmit }: Step2Props) {
  const [valid, setValid] = useState({
    url: false,
    anon: false,
    service: false,
    pat: false,
    vercel: false,
    email: false,
    password: false,
  })

  const allValid = Object.values(valid).every(Boolean)

  const set = (k: keyof CoreCredentials, v: string) => onChange({ ...value, [k]: v })

  return (
    <div className="space-y-5">
      <ValidatedInput
        label="Supabase URL"
        value={value.supabase_url}
        onChange={(v) => set('supabase_url', v)}
        onValidChange={(ok) => setValid((s) => ({ ...s, url: ok }))}
        validate={async (v) => validateSupabaseUrl(v)}
        placeholder="https://xxxx.supabase.co"
        helpText="Project Settings → API → Project URL"
      />

      <ValidatedInput
        label="Supabase anon key"
        value={value.supabase_anon_key}
        onChange={(v) => set('supabase_anon_key', v)}
        onValidChange={(ok) => setValid((s) => ({ ...s, anon: ok }))}
        validate={(v) => validateSupabaseAnonKey(value.supabase_url, v)}
        placeholder="eyJ..."
        inputType="password"
        helpText="Project Settings → API → anon public"
      />

      <ValidatedInput
        label="Supabase service_role key"
        value={value.supabase_service_role_key}
        onChange={(v) => set('supabase_service_role_key', v)}
        onValidChange={(ok) => setValid((s) => ({ ...s, service: ok }))}
        validate={(v) => validateSupabaseServiceRole(value.supabase_url, v)}
        placeholder="eyJ..."
        inputType="password"
        helpText="Project Settings → API → service_role secret"
      />

      <ValidatedInput
        label="Supabase Personal Access Token"
        value={value.supabase_pat}
        onChange={(v) => set('supabase_pat', v)}
        onValidChange={(ok) => setValid((s) => ({ ...s, pat: ok }))}
        validate={validateSupabasePAT}
        placeholder="sbp_..."
        inputType="password"
        docsUrl="https://supabase.com/dashboard/account/tokens"
      />

      <ValidatedInput
        label="Vercel Token"
        value={value.vercel_token}
        onChange={(v) => set('vercel_token', v)}
        onValidChange={(ok) => setValid((s) => ({ ...s, vercel: ok }))}
        validate={validateVercelToken}
        placeholder="vercel_..."
        inputType="password"
        docsUrl="https://vercel.com/account/tokens"
      />

      <div className="my-2 border-t border-[rgba(59,130,246,0.15)] pt-4">
        <h3 className="mb-2 text-xs uppercase tracking-wider text-[#60A5FA]">
          Conta de owner desta instância
        </h3>
      </div>

      <ValidatedInput
        label="Email do owner"
        value={value.owner_email}
        onChange={(v) => set('owner_email', v)}
        onValidChange={(ok) => setValid((s) => ({ ...s, email: ok }))}
        validate={async (v) => validateEmail(v)}
        inputType="email"
        placeholder="voce@dominio.com"
        helpText="Será o primeiro usuário. Você pode convidar mais depois em /team."
      />

      <ValidatedInput
        label="Senha do owner"
        value={value.owner_password}
        onChange={(v) => set('owner_password', v)}
        onValidChange={(ok) => setValid((s) => ({ ...s, password: ok }))}
        validate={async (v) => validatePassword(v)}
        inputType="password"
        placeholder="mínimo 8 caracteres"
      />

      <div className="flex items-center justify-between pt-4">
        <button
          onClick={onBack}
          className="rounded-lg border border-[rgba(59,130,246,0.2)] bg-[rgba(255,255,255,0.03)] px-4 py-2 text-sm text-[#CBD5E1] transition-all duration-300 hover:border-[rgba(59,130,246,0.4)]"
        >
          ← Voltar
        </button>
        <button
          onClick={() => onSubmit(value)}
          disabled={!allValid}
          className="rounded-lg bg-gradient-to-br from-[#1E3A8A] to-[#3B82F6] px-6 py-2.5 font-medium text-white shadow-[0_0_30px_rgba(59,130,246,0.3)] transition-all duration-400 enabled:hover:shadow-[0_0_60px_rgba(59,130,246,0.5)] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
        >
          {allValid ? 'Configurar →' : 'Aguardando validações…'}
        </button>
      </div>
    </div>
  )
}

// Step 4 — coleta as credenciais de aplicação declaradas no setup.config.ts
// e POSTa em /api/credentials.
import { useState } from 'react'
import { ValidatedInput } from './ValidatedInput'
import { setupConfig } from '../../../setup.config'
import supabase from '@/lib/supabase'

interface Step4Props {
  /** token do owner (login automático no fim do Step 3). */
  accessToken?: string | null
  onDone: () => void
}

export default function Step4AppCredentials({ accessToken, onDone }: Step4Props) {
  const fields = setupConfig.appCredentials
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, ''])),
  )
  const [valid, setValid] = useState<Record<string, boolean>>(
    Object.fromEntries(fields.map((f) => [f.key, !!f.optional])),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const requiredOk = fields
    .filter((f) => !f.optional)
    .every((f) => valid[f.key])

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      // /api/credentials exige JWT do owner. Usa o token do login automático;
      // se não houver (ex.: refresh no Step 4), tenta a sessão do app.
      let token = accessToken ?? null
      if (!token) {
        const { data } = await supabase.auth.getSession()
        token = data.session?.access_token ?? null
      }
      if (!token) {
        throw new Error(
          'Sessão de owner não encontrada. Faça login e reabra /setup para concluir as APIs.',
        )
      }
      const res = await fetch('/api/credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ credentials: values }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        const errs = data.errors
          ? Object.entries(data.errors)
              .map(([k, v]) => `${k}: ${v}`)
              .join('\n')
          : data.message ?? `Erro ${res.status}`
        throw new Error(errs)
      }
      onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-[#CBD5E1]">
        Por último, conecte as APIs que o Creator OS usa. Tudo é criptografado
        antes de salvar (AES-256-GCM no Supabase do seu projeto).
      </p>

      {fields.map((f) => (
        <ValidatedInput
          key={f.key}
          label={f.label}
          value={values[f.key] ?? ''}
          onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
          onValidChange={(ok) => setValid((prev) => ({ ...prev, [f.key]: ok }))}
          validate={f.validate}
          placeholder={f.placeholder}
          inputType={f.inputType === 'password' ? 'password' : 'text'}
          helpText={f.helpText}
          docsUrl={f.docsUrl}
          optional={f.optional}
        />
      ))}

      {error && (
        <div className="rounded-lg border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.05)] p-3">
          <pre className="text-xs whitespace-pre-wrap text-[#FCA5A5]">{error}</pre>
        </div>
      )}

      <button
        onClick={submit}
        disabled={!requiredOk || saving}
        className="w-full rounded-lg bg-gradient-to-br from-[#1E3A8A] to-[#3B82F6] px-4 py-2.5 font-medium text-white shadow-[0_0_30px_rgba(59,130,246,0.3)] transition-all duration-400 enabled:hover:shadow-[0_0_60px_rgba(59,130,246,0.5)] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
      >
        {saving ? 'Salvando…' : 'Salvar e finalizar'}
      </button>
    </div>
  )
}

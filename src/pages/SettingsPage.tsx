import { useEffect, useState } from 'react'
import { Settings, Brain, ShieldCheck, KeyRound, CheckCircle2, Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ModelSelector } from '@/components/shared/ModelSelector'
import { useAppStore } from '@/store'
import { useAppUser } from '@/hooks/useAppUser'
import { setupConfig } from '../../setup.config'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export default function SettingsPage() {
  const user = useAppStore((s) => s.user)
  const { isAdmin, appUser } = useAppUser()

  const fields = setupConfig.appCredentials
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, ''])),
  )
  const [configured, setConfigured] = useState<Set<string>>(new Set())
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/credentials')
        if (!res.ok) return
        const data = (await res.json()) as { keys: string[] }
        if (cancelled) return
        setConfigured(new Set(data.keys))
      } catch {
        /* ignora — Settings ainda funciona mesmo sem listagem */
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  async function save(key: string) {
    const value = values[key]?.trim() ?? ''
    if (!value) return
    setSaveState('saving')
    setErrorMessage(null)
    try {
      const res = await fetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials: { [key]: value } }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        const msg = data.errors?.[key] ?? data.message ?? `Erro ${res.status}`
        throw new Error(msg)
      }
      setConfigured((prev) => new Set([...prev, key]))
      setValues((prev) => ({ ...prev, [key]: '' }))
      setSaveState('saved')
      setTimeout(() => setSaveState('idle'), 2000)
    } catch (err) {
      setSaveState('error')
      setErrorMessage((err as Error).message)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Conta, modelo de IA e API keys da aplicação
        </p>
      </div>

      {/* Account info */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex items-center gap-2">
            <Settings className="size-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Conta</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="label-uppercase">Email</p>
              <p className="text-sm text-foreground">{user?.email ?? '—'}</p>
            </div>
            <div>
              <p className="label-uppercase">User ID</p>
              <p className="truncate text-sm font-mono text-muted-foreground">
                {user?.id ?? '—'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Model selection */}
      <Card>
        <CardContent className="space-y-4 pt-4">
          <div className="flex items-center gap-2">
            <Brain className="size-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Modelo de IA</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Escolha o modelo usado para análise de conteúdo, geração de Voice Profile e
            criação de roteiros. A seleção é salva automaticamente.
          </p>
          <ModelSelector />
        </CardContent>
      </Card>

      {/* API Keys — editor real */}
      <Card>
        <CardContent className="space-y-4 pt-4">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">API Keys</h3>
            <Badge
              variant="secondary"
              className="text-[10px] border border-[rgba(59,130,246,0.2)]"
            >
              criptografadas em app_settings
            </Badge>
          </div>

          <p className="text-xs text-muted-foreground">
            Atualize uma chave aqui se ela expirou ou foi rotacionada. Os valores são
            criptografados com AES-256-GCM antes de salvar no seu Supabase. Use o campo
            vazio para substituir o valor atual.
          </p>

          {errorMessage && (
            <div className="rounded-lg border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.05)] p-2">
              <p className="text-xs text-[#FCA5A5]">{errorMessage}</p>
            </div>
          )}

          <div className="space-y-4">
            {fields.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label className="flex items-center justify-between text-xs text-[#CBD5E1]">
                  <span>
                    {f.label}{' '}
                    <span className="font-mono text-[10px] text-muted-foreground">
                      ({f.key})
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {configured.has(f.key) && (
                      <span className="flex items-center gap-1 text-[10px] text-[#10B981]">
                        <CheckCircle2 className="size-3" />
                        configurada
                      </span>
                    )}
                    {f.docsUrl && (
                      <a
                        href={f.docsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-[#60A5FA] hover:underline"
                      >
                        onde gerar?
                      </a>
                    )}
                  </span>
                </Label>
                <div className="flex gap-2">
                  <input
                    type={f.inputType === 'password' ? 'password' : 'text'}
                    value={values[f.key] ?? ''}
                    placeholder={
                      configured.has(f.key)
                        ? '(configurada — digite para substituir)'
                        : (f.placeholder ?? '')
                    }
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                    }
                    className="flex-1 rounded-lg border border-[rgba(59,130,246,0.2)] bg-[rgba(255,255,255,0.03)] px-3 py-2 font-mono text-xs text-[#F8FAFC] outline-none transition-all focus:border-[#3B82F6] focus:shadow-[0_0_30px_rgba(59,130,246,0.3)]"
                  />
                  <button
                    onClick={() => save(f.key)}
                    disabled={!values[f.key]?.trim() || saveState === 'saving'}
                    className="rounded-lg bg-gradient-to-br from-[#1E3A8A] to-[#3B82F6] px-3 py-2 text-xs font-medium text-white shadow-[0_0_20px_rgba(59,130,246,0.3)] transition-all duration-300 enabled:hover:shadow-[0_0_40px_rgba(59,130,246,0.5)] disabled:opacity-40 disabled:shadow-none"
                  >
                    {saveState === 'saving' ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      'Salvar'
                    )}
                  </button>
                </div>
                {f.helpText && (
                  <p className="text-[11px] text-muted-foreground">{f.helpText}</p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Admin-only section */}
      {isAdmin && (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">
                Administração
              </h3>
              <Badge
                variant="secondary"
                className="text-[10px] border border-[rgba(59,130,246,0.2)]"
              >
                {appUser?.role ?? 'admin'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Você tem permissões de administrador nesta instância. Gerenciamento
              de usuários e convites em /team.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

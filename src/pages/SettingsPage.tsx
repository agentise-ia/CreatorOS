import { useEffect, useState } from 'react'
import {
  Settings,
  Brain,
  ShieldCheck,
  KeyRound,
  CheckCircle2,
  Loader2,
  ChevronDown,
  Sparkles,
  UserPlus,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ModelSelector } from '@/components/shared/ModelSelector'
import { useAppStore } from '@/store'
import { useAppUser } from '@/hooks/useAppUser'
import { cn } from '@/lib/utils'
import supabase from '@/lib/supabase'
import { createInvite } from '@/lib/api'
import type { AppRole } from '@/types/auth'
import { setupConfig } from '../../setup.config'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const ROLE_LABELS: Record<AppRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  operator: 'Operador',
  member: 'Membro',
}

export default function SettingsPage() {
  const user = useAppStore((s) => s.user)
  const anthropicEnabled = useAppStore((s) => s.anthropicEnabled)
  const setAnthropicEnabled = useAppStore((s) => s.setAnthropicEnabled)
  const { isAdmin, appUser } = useAppUser()

  const fields = setupConfig.appCredentials
  const advancedFields = setupConfig.settingsOnlyCredentials ?? []
  const allFields = [...fields, ...advancedFields]
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(allFields.map((f) => [f.key, ''])),
  )
  const [configured, setConfigured] = useState<Set<string>>(new Set())
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // Convite de novos usuários (herda a role de quem convida)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteState, setInviteState] = useState<SaveState>('idle')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [invitedTo, setInvitedTo] = useState<string | null>(null)

  const myRole = appUser?.role
  const myRoleLabel = myRole ? ROLE_LABELS[myRole] : null

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault()
    const email = inviteEmail.trim()
    if (!email) return
    setInviteState('saving')
    setInviteError(null)
    setInvitedTo(null)
    try {
      await createInvite(email)
      setInvitedTo(email)
      setInviteEmail('')
      setInviteState('saved')
      setTimeout(() => setInviteState('idle'), 2000)
    } catch (err) {
      setInviteState('error')
      setInviteError((err as Error).message)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const keys = allFields.map((f) => f.key)
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (!session) return
        const res = await fetch(`/api/credentials?keys=${encodeURIComponent(keys.join(','))}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!res.ok) return
        const data = (await res.json()) as Record<string, { exists: boolean }>
        if (cancelled) return
        const present = new Set(
          Object.entries(data)
            .filter(([, v]) => v?.exists)
            .map(([k]) => k),
        )
        setConfigured(present)
      } catch {
        /* ignora — Settings ainda funciona mesmo sem listagem */
      }
    }
    void load()
    return () => {
      cancelled = true
    }
    // fields é constante (setupConfig.appCredentials) — roda só na montagem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save(key: string) {
    const value = values[key]?.trim() ?? ''
    if (!value) return
    setSaveState('saving')
    setErrorMessage(null)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        throw new Error('Sessão expirada. Faça login novamente para editar credenciais.')
      }
      const res = await fetch('/api/credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
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

          {/* Configurações Avançadas — dropdown */}
          {advancedFields.length > 0 && (
            <div className="rounded-lg border border-[rgba(59,130,246,0.15)] bg-[rgba(255,255,255,0.02)]">
              <button
                type="button"
                onClick={() => setAdvancedOpen((o) => !o)}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left"
              >
                <span className="flex items-center gap-2">
                  <Sparkles className="size-3.5 text-primary" />
                  <span className="text-sm font-medium text-foreground">
                    Configurações Avançadas
                  </span>
                </span>
                <ChevronDown
                  className={cn(
                    'size-4 text-muted-foreground transition-transform',
                    advancedOpen && 'rotate-180',
                  )}
                />
              </button>

              {advancedOpen && (
                <div className="space-y-4 border-t border-[rgba(59,130,246,0.12)] px-3 py-4">
                  {advancedFields.map((f) => (
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

                  {/* Ativar Modelos de IA (Anthropic) */}
                  <div className="flex items-start justify-between gap-3 rounded-lg border border-[rgba(59,130,246,0.12)] bg-[rgba(59,130,246,0.04)] p-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground">
                        Ativar Modelos de IA (Anthropic)
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Quando ativado, os modelos Sonnet 4.6 e Opus 4.8 aparecem em
                        "Modelo de IA". Requer a chave da Anthropic configurada acima.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={anthropicEnabled}
                      onClick={() => setAnthropicEnabled(!anthropicEnabled)}
                      className={cn(
                        'relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer appearance-none items-center rounded-full border-0 p-0.5 transition-colors',
                        anthropicEnabled
                          ? 'bg-[#3B82F6]'
                          : 'bg-[rgba(148,163,184,0.3)]',
                      )}
                    >
                      <span
                        className={cn(
                          'size-4 rounded-full bg-white shadow-sm transition-transform',
                          anthropicEnabled ? 'translate-x-4' : 'translate-x-0',
                        )}
                      />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Convidar usuário — herda a mesma role de quem convida */}
      {myRole && (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <div className="flex items-center gap-2">
              <UserPlus className="size-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">
                Convidar usuário
              </h3>
              {myRoleLabel && (
                <Badge
                  variant="secondary"
                  className="text-[10px] border border-[rgba(59,130,246,0.2)]"
                >
                  mesma role: {myRoleLabel}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              O convidado recebe um email com um magic link (válido por 7 dias) e
              entrará com a <strong>mesma role que você</strong>
              {myRoleLabel ? ` (${myRoleLabel})` : ''}.
            </p>

            <form onSubmit={sendInvite} className="flex gap-2">
              <input
                type="email"
                value={inviteEmail}
                placeholder="convidado@email.com"
                onChange={(e) => setInviteEmail(e.target.value)}
                className="flex-1 rounded-lg border border-[rgba(59,130,246,0.2)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-xs text-[#F8FAFC] outline-none transition-all focus:border-[#3B82F6] focus:shadow-[0_0_30px_rgba(59,130,246,0.3)]"
              />
              <button
                type="submit"
                disabled={!inviteEmail.trim() || inviteState === 'saving'}
                className="rounded-lg bg-gradient-to-br from-[#1E3A8A] to-[#3B82F6] px-3 py-2 text-xs font-medium text-white shadow-[0_0_20px_rgba(59,130,246,0.3)] transition-all duration-300 enabled:hover:shadow-[0_0_40px_rgba(59,130,246,0.5)] disabled:opacity-40 disabled:shadow-none"
              >
                {inviteState === 'saving' ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  'Convidar'
                )}
              </button>
            </form>

            {invitedTo && (
              <div className="flex items-center gap-1.5 rounded-lg border border-[rgba(16,185,129,0.25)] bg-[rgba(16,185,129,0.05)] p-2 text-xs text-[#10B981]">
                <CheckCircle2 className="size-3.5 shrink-0" />
                <span>
                  Convite enviado para <strong>{invitedTo}</strong>. O magic link
                  expira em 7 dias.
                </span>
              </div>
            )}

            {inviteError && (
              <div className="rounded-lg border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.05)] p-2">
                <p className="text-xs text-[#FCA5A5]">{inviteError}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

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

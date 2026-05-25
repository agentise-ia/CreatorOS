import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import supabase from '@/lib/supabase'
import { acceptNativeInvite } from '@/lib/api'
import { APP_NAME } from '@/lib/brand'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

// O convite nativo do Supabase manda um magic link que, ao ser aberto, cria a
// sessão automaticamente (o client processa o hash da URL). Aqui detectamos essa
// sessão, pedimos a senha e finalizamos via accept_native_invite (cria o
// app_users 'member' e marca o convite usado).
export default function InvitePage() {
  const [checking, setChecking] = useState(true)
  const [email, setEmail] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    // Erro vindo no hash (ex.: link expirado): #error=...&error_description=...
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const hashError = hash.get('error_description') ?? hash.get('error')
    if (hashError) {
      setError(decodeURIComponent(hashError))
      setChecking(false)
      return
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!active) return
      if (session?.user) {
        setEmail(session.user.email ?? null)
        setChecking(false)
      }
    })
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      if (data.session?.user) setEmail(data.session.user.email ?? null)
      setChecking(false)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password })
      if (updErr) throw new Error(updErr.message)
      await acceptNativeInvite()
      // Reload completo pra o app recarregar a sessão + o app_users recém-criado.
      window.location.href = '/'
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }

  // Sem sessão e sem erro = acesso direto / link inválido → manda pro login.
  if (!checking && !email && !error) return <Navigate to="/login" replace />

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{
        background: `
          radial-gradient(ellipse at 30% 20%, rgba(59, 130, 246, 0.1), transparent 50%),
          radial-gradient(ellipse at 70% 80%, rgba(37, 99, 235, 0.06), transparent 50%),
          #0A0A0F
        `,
      }}
    >
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold tracking-tight text-foreground">
            {APP_NAME}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Você foi convidado para esta instância.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          {checking ? (
            <p className="text-center text-sm text-muted-foreground">Validando convite...</p>
          ) : error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-center text-sm text-destructive">
              {error}
              <div className="mt-2 text-muted-foreground">
                Convite inválido ou expirado. Solicite um novo ao owner.
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email" className="text-[#CBD5E1]">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email ?? ''}
                  readOnly
                  className="glass-input opacity-70"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password" className="text-[#CBD5E1]">Defina sua senha</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Mínimo 8 caracteres"
                  value={password}
                  onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
                  minLength={8}
                  required
                  autoComplete="new-password"
                  className="glass-input"
                />
              </div>
              <Button
                type="submit"
                disabled={loading || password.length < 8}
                className="w-full btn-gradient"
              >
                {loading ? 'Finalizando...' : 'Aceitar convite'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

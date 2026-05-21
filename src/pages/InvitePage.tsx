import { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import supabase from '@/lib/supabase'
import { validateInviteToken } from '@/lib/api'
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

export default function InvitePage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')

  const [validating, setValidating] = useState(true)
  const [valid, setValid] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setValidating(false)
      return
    }
    validateInviteToken(token)
      .then((res) => {
        setValid(res.valid)
        setEmail(res.email)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setValidating(false))
  }, [token])

  if (!token) return <Navigate to="/login" replace />

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return
    setError(null)
    setLoading(true)

    const { error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { invite_token: token } },
    })

    setLoading(false)

    if (authError) {
      setError(authError.message)
      return
    }
    setSuccess(true)
  }

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
          {validating ? (
            <p className="text-center text-sm text-muted-foreground">Validando convite...</p>
          ) : !valid ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-center text-sm text-destructive">
              Convite inválido, expirado ou já utilizado. Solicite um novo ao owner.
            </div>
          ) : success ? (
            <div className="rounded-xl border border-[rgba(59,130,246,0.25)] bg-[rgba(59,130,246,0.05)] p-4 text-center text-sm text-foreground">
              Conta criada! Verifique seu email para confirmar e depois acesse pela tela de login.
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
                <Label htmlFor="password" className="text-[#CBD5E1]">Senha</Label>
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
                {loading ? 'Criando conta...' : 'Aceitar convite'}
              </Button>
            </form>
          )}

          {error && <p className="text-center text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import supabase from '@/lib/supabase'
import { APP_NAME } from '@/lib/brand'
import { hasOwner } from '@/lib/api'
import { useAppStore } from '@/store'
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

export function LoginPage() {
  const user = useAppStore((s) => s.user)
  const authLoading = useAppStore((s) => s.authLoading)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [isSignUp, setIsSignUp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signUpSuccess, setSignUpSuccess] = useState(false)
  const [signupOpen, setSignupOpen] = useState<boolean | null>(null)

  useEffect(() => {
    hasOwner()
      .then((exists) => setSignupOpen(!exists))
      .catch(() => setSignupOpen(false))
  }, [])

  if (!authLoading && user) {
    return <Navigate to="/" replace />
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    if (isSignUp) {
      const { error: authError } = await supabase.auth.signUp({
        email,
        password,
      })

      setLoading(false)

      if (authError) {
        setError(authError.message)
        return
      }

      setSignUpSuccess(true)
    } else {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      setLoading(false)

      if (authError) {
        setError(authError.message)
      }
    }
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
            Analise conteúdo viral e gere roteiros personalizados para Instagram
            Reels
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          {signUpSuccess ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-[rgba(59,130,246,0.25)] bg-[rgba(59,130,246,0.05)] p-6 text-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-10 w-10 text-accent"
              >
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <p className="text-sm font-medium text-foreground">
                Conta criada com sucesso!
              </p>
              <p className="text-xs text-muted-foreground">
                Verifique seu email para confirmar a conta, depois faça login.
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSignUpSuccess(false)
                  setIsSignUp(false)
                  setPassword('')
                }}
              >
                Ir para login
              </Button>
            </div>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="email" className="text-[#CBD5E1]">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="seu@email.com"
                    value={email}
                    onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
                    required
                    autoComplete="email"
                    className="glass-input"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="password" className="text-[#CBD5E1]">Senha</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder={isSignUp ? 'Mínimo 6 caracteres' : 'Sua senha'}
                    value={password}
                    onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
                    required
                    autoComplete={isSignUp ? 'new-password' : 'current-password'}
                    minLength={6}
                    className="glass-input"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={loading || !email || !password}
                  className="w-full btn-gradient"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                      {isSignUp ? 'Criando conta...' : 'Entrando...'}
                    </span>
                  ) : isSignUp ? (
                    'Criar conta'
                  ) : (
                    'Entrar'
                  )}
                </Button>
              </form>

              {/* Toggle sign up / sign in — só permite signup público se ainda não há owner */}
              {signupOpen === null ? null : signupOpen || isSignUp ? (
                <div className="text-center">
                  <button
                    type="button"
                    className="text-sm text-muted-foreground hover:text-[#60A5FA] transition-colors"
                    onClick={() => {
                      setIsSignUp(!isSignUp)
                      setError(null)
                    }}
                  >
                    {isSignUp
                      ? 'Já tem conta? Faça login'
                      : 'Primeira pessoa? Crie a conta de owner'}
                  </button>
                </div>
              ) : (
                <p className="text-center text-xs text-muted-foreground">
                  Self-signup desabilitado. Solicite um convite ao owner desta instância.
                </p>
              )}
            </>
          )}

          {/* Error message */}
          {error && (
            <p className="text-center text-sm text-destructive">{error}</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

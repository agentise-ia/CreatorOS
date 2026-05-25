import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAppStore } from '@/store'
import supabase from '@/lib/supabase'
import { createInvite, revokeInvite } from '@/lib/api'
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
import type { AppUser, Invite } from '@/types/auth'

export default function TeamPage() {
  const appUser = useAppStore((s) => s.appUser)
  const isOwner = appUser?.role === 'owner'

  const [members, setMembers] = useState<AppUser[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

  async function refresh() {
    const [{ data: usersData }, { data: invitesData }] = await Promise.all([
      supabase
        .from('app_users')
        .select('user_id, role, created_at, updated_at')
        .order('created_at', { ascending: true }),
      supabase
        .from('invites')
        .select('id, email, role, invited_by, expires_at, used_at, revoked_at, created_at')
        .is('used_at', null)
        .is('revoked_at', null)
        .order('created_at', { ascending: false }),
    ])
    setMembers((usersData ?? []) as AppUser[])
    setInvites((invitesData ?? []) as Invite[])
  }

  useEffect(() => {
    if (isOwner) void refresh()
  }, [isOwner])

  if (!appUser) return null
  if (!isOwner) return <Navigate to="/" replace />

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const target = email
      await createInvite(target)
      setSentTo(target)
      setEmail('')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function handleRevoke(inviteId: string) {
    setError(null)
    try {
      await revokeInvite(inviteId)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Time</h1>
        <p className="text-sm text-muted-foreground">
          Convide novos membros e gerencie acessos desta instância.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Convidar novo membro</CardTitle>
          <CardDescription>
            O convidado recebe um email com um magic link (válido por 7 dias). Apenas o owner pode criar convites.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleInvite} className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="convidado@email.com"
                value={email}
                onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
                required
                className="glass-input"
              />
            </div>
            <Button type="submit" disabled={loading || !email} className="btn-gradient">
              {loading ? 'Enviando...' : 'Convidar'}
            </Button>
          </form>

          {sentTo && (
            <div className="mt-4 rounded-xl border border-[rgba(59,130,246,0.25)] bg-[rgba(59,130,246,0.05)] p-3 text-sm text-foreground">
              Convite enviado por email para <strong>{sentTo}</strong>. O magic link expira em 7 dias.
            </div>
          )}

          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Convites pendentes ({invites.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {invites.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum convite pendente.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {invites.map((inv) => (
                <li
                  key={inv.id}
                  className="flex flex-col gap-2 rounded-xl border border-[rgba(59,130,246,0.15)] p-3 md:flex-row md:items-center md:justify-between"
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-foreground">{inv.email}</span>
                    <span className="text-xs text-muted-foreground">
                      Expira em {new Date(inv.expires_at).toLocaleDateString('pt-BR')}
                    </span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => handleRevoke(inv.id)}>
                    Revogar
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Membros ({members.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2">
            {members.map((m) => (
              <li
                key={m.user_id}
                className="flex items-center justify-between rounded-xl border border-[rgba(59,130,246,0.15)] p-3"
              >
                <span className="font-mono text-xs text-muted-foreground">{m.user_id}</span>
                <span className="rounded-full bg-[rgba(59,130,246,0.15)] px-2 py-0.5 text-xs text-foreground">
                  {m.role}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

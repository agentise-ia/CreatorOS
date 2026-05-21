import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import supabase from '@/lib/supabase'
import { scrapeProfile } from '@/lib/api'
import { useAppStore } from '@/store'
import type { Profile } from '@/types'

interface AddProfileModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function AddProfileModal({
  open,
  onOpenChange,
  onSuccess,
}: AddProfileModalProps) {
  const user = useAppStore((s) => s.user)
  const addProfile = useAppStore((s) => s.addProfile)

  const [username, setUsername] = useState('')
  const profileType = 'reference' as const
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function resetForm() {
    setUsername('')
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const cleanUsername = username.replace(/^@/, '').trim()
    if (!cleanUsername) {
      setError('Insira um nome de usuário válido.')
      return
    }

    if (!user) {
      setError('Você precisa estar logado.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const { data, error: insertError } = await supabase
        .from('profiles')
        .insert({
          user_id: user.id,
          instagram_username: cleanUsername,
          profile_type: profileType,
        })
        .select()
        .single()

      if (insertError) {
        if (insertError.code === '23505') {
          setError('Este perfil já foi adicionado.')
        } else {
          setError(insertError.message)
        }
        setLoading(false)
        return
      }

      addProfile(data as Profile)

      // Trigger scraping in background (non-blocking)
      scrapeProfile([cleanUsername], profileType).catch((err) => {
        console.error('Scrape trigger failed:', err)
      })

      resetForm()
      onOpenChange(false)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Adicionar Perfil de Referência</DialogTitle>
            <DialogDescription>
              Insira o @ do Instagram de um concorrente ou criador que você quer analisar.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="username">Usuário do Instagram</Label>
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted-foreground">@</span>
                <Input
                  id="username"
                  placeholder="nome_do_perfil"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                  autoFocus
                />
              </div>
            </div>

            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="size-4 animate-spin" />}
              Adicionar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

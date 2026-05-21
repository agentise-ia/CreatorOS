import { useState } from 'react'
import { Plus, Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProfileCard } from '@/components/profiles/ProfileCard'
import { AddProfileModal } from '@/components/profiles/AddProfileModal'
import { useProfiles } from '@/hooks/useProfiles'

export default function ProfilesPage() {
  const { profiles, loading, refetch } = useProfiles()
  const [modalOpen, setModalOpen] = useState(false)

  const referenceProfiles = profiles.filter(
    (p) => p.profile_type === 'reference'
  )

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Perfis de Referência</h1>
          <p className="text-sm text-muted-foreground">
            {referenceProfiles.length}{' '}
            {referenceProfiles.length === 1
              ? 'concorrente analisado'
              : 'concorrentes analisados'}
          </p>
        </div>
        <Button onClick={() => setModalOpen(true)} className="btn-gradient">
          <Plus className="size-4" />
          Adicionar Perfil
        </Button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-2xl glass-card"
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && referenceProfiles.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[rgba(59,130,246,0.2)] bg-[rgba(59,130,246,0.03)] py-16">
          <Globe className="size-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Adicione perfis de concorrentes ou referências para extrair padrões virais
          </p>
          <Button variant="outline" onClick={() => setModalOpen(true)} className="border-[rgba(59,130,246,0.25)] hover:border-[rgba(59,130,246,0.45)] hover:bg-[rgba(59,130,246,0.08)]">
            <Plus className="size-4" />
            Adicionar Perfil
          </Button>
        </div>
      )}

      {/* Reference profiles */}
      {!loading && referenceProfiles.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {referenceProfiles.map((profile) => (
            <ProfileCard key={profile.id} profile={profile} onScrapeComplete={refetch} />
          ))}
        </div>
      )}

      {/* Modal */}
      <AddProfileModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSuccess={refetch}
      />
    </div>
  )
}

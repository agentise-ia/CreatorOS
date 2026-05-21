import { useNavigate } from 'react-router-dom'
import { FileText, Plus, Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useScripts } from '@/hooks/useScripts'
import { useAppStore } from '@/store'
import { formatDate } from '@/lib/utils'

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  draft: { label: 'Rascunho', className: 'bg-[rgba(59,130,246,0.15)] text-[#60A5FA] border border-[rgba(59,130,246,0.25)]' },
  approved: { label: 'Aprovado', className: 'bg-[rgba(37,99,235,0.15)] text-[#3B82F6] border border-[rgba(37,99,235,0.25)]' },
  recorded: { label: 'Gravado', className: 'bg-[rgba(16,185,129,0.15)] text-accent border border-[rgba(16,185,129,0.25)]' },
  published: { label: 'Publicado', className: 'bg-[rgba(16,185,129,0.2)] text-accent border border-[rgba(16,185,129,0.3)]' },
}

export default function ScriptsPage() {
  const navigate = useNavigate()
  const { scripts, loading } = useScripts()
  const activeJobs = useAppStore((s) => s.activeJobs)

  const scriptJobs = activeJobs.filter(
    (j) =>
      j.job_type === 'generate_script' &&
      (j.status === 'pending' || j.status === 'processing')
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Roteiros</h1>
          <p className="text-sm text-muted-foreground">
            Roteiros gerados com padrões virais + seu tom de fala
          </p>
        </div>
        <Button size="sm" onClick={() => navigate('/scripts/new')} className="btn-gradient">
          <Plus className="size-3" />
          Novo Roteiro
        </Button>
      </div>

      {/* Active jobs */}
      {scriptJobs.length > 0 && (
        <Card className="border-[rgba(59,130,246,0.3)]">
          <CardContent className="flex items-center gap-3 pt-6">
            <Loader2 className="size-5 animate-spin text-primary" />
            <span className="text-sm text-[#60A5FA]">
              Gerando roteiro...
              {scriptJobs[0]?.progress > 0 && ` (${scriptJobs[0].progress}%)`}
            </span>
          </CardContent>
        </Card>
      )}

      {/* Scripts list */}
      {scripts.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[rgba(59,130,246,0.2)] bg-[rgba(59,130,246,0.03)] py-16">
          <FileText className="size-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Nenhum roteiro gerado</p>
          <Button size="sm" onClick={() => navigate('/scripts/new')} className="btn-gradient">
            <Plus className="size-3" />
            Criar primeiro roteiro
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {scripts.map((script) => {
            const status = STATUS_LABELS[script.status] ?? STATUS_LABELS.draft
            return (
              <Card
                key={script.id}
                className="cursor-pointer"
                onClick={() => navigate(`/scripts/${script.id}`)}
              >
                <CardContent className="flex items-center gap-4 pt-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[rgba(59,130,246,0.1)] border border-[rgba(59,130,246,0.2)]">
                    <FileText className="size-5 text-primary" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-medium text-foreground">
                        {script.title}
                      </h3>
                      <Badge className={status.className}>{status.label}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Tema: {script.topic}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    {script.estimated_duration_seconds && (
                      <p className="text-xs text-muted-foreground">
                        ~{Math.round(script.estimated_duration_seconds / 60)}min
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground">
                      {formatDate(script.created_at)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

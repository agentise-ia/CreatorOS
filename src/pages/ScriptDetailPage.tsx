import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Loader2,
  FileText,
  Monitor,
  Download,
  CheckCircle2,
  Sparkles,
  History,
  RotateCcw,
  Columns2,
  Film,
  ExternalLink,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ModelSelector } from '@/components/shared/ModelSelector'
import { VideoPlayer } from '@/components/analysis/VideoPlayer'
import { useScript } from '@/hooks/useScripts'
import { useScriptVersions } from '@/hooks/useScriptVersions'
import { useAppStore } from '@/store'
import {
  saveScriptEdit,
  restoreScriptVersion,
  generateScript,
  getJobStatus,
} from '@/lib/api'
import { formatDate, formatNumber } from '@/lib/utils'
import supabase from '@/lib/supabase'
import type { Reel } from '@/types'

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  draft: { label: 'Rascunho', className: 'bg-[rgba(59,130,246,0.15)] text-[#60A5FA] border border-[rgba(59,130,246,0.25)]' },
  approved: { label: 'Aprovado', className: 'bg-[rgba(37,99,235,0.15)] text-[#3B82F6] border border-[rgba(37,99,235,0.25)]' },
  recorded: { label: 'Gravado', className: 'bg-[rgba(16,185,129,0.15)] text-accent border border-[rgba(16,185,129,0.25)]' },
  published: { label: 'Publicado', className: 'bg-[rgba(16,185,129,0.2)] text-accent border border-[rgba(16,185,129,0.3)]' },
}

const STATUS_ORDER: string[] = ['draft', 'approved', 'recorded', 'published']

export default function ScriptDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { script, loading, error, refetch } = useScript(id)
  const { versions, loading: versionsLoading, refetch: refetchVersions } = useScriptVersions(id)
  const modelProvider = useAppStore((s) => s.modelProvider)
  const modelId = useAppStore((s) => s.modelId)
  const [updating, setUpdating] = useState(false)
  const [editedText, setEditedText] = useState('')
  const [saving, setSaving] = useState(false)
  const [regenOpen, setRegenOpen] = useState(false)
  const [regenInstructions, setRegenInstructions] = useState('')
  const [regenerating, setRegenerating] = useState(false)
  const [regenProgress, setRegenProgress] = useState(0)
  const [viewingVersion, setViewingVersion] = useState<string | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [sourceReel, setSourceReel] = useState<Reel | null>(null)
  const [sourceTranscript, setSourceTranscript] = useState<string | null>(null)
  const [sourceLoading, setSourceLoading] = useState(false)

  const sourceReelId = script?.reference_reel_ids?.[0] ?? null

  useEffect(() => {
    if (script) setEditedText(script.script_teleprompter)
  }, [script])

  // Carrega o reel-fonte (vídeo + transcrição original) usado para gerar o roteiro.
  useEffect(() => {
    if (!sourceReelId) {
      setSourceReel(null)
      setSourceTranscript(null)
      return
    }
    let cancelled = false
    async function load() {
      setSourceLoading(true)
      const [{ data: reel }, { data: tr }] = await Promise.all([
        supabase.from('reels').select('*').eq('id', sourceReelId).maybeSingle(),
        supabase
          .from('transcriptions')
          .select('full_text')
          .eq('reel_id', sourceReelId)
          .maybeSingle(),
      ])
      if (cancelled) return
      setSourceReel((reel as Reel) ?? null)
      setSourceTranscript((tr as { full_text: string } | null)?.full_text ?? null)
      setSourceLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [sourceReelId])

  const sourceVideoSrc = sourceReel
    ? sourceReel.storage_path
      ? supabase.storage.from('videos').getPublicUrl(sourceReel.storage_path).data.publicUrl
      : sourceReel.video_url
    : null

  const sourceInstagramUrl = sourceReel?.shortcode
    ? `https://www.instagram.com/reel/${sourceReel.shortcode}/`
    : null

  const hasUnsavedChanges = script ? editedText !== script.script_teleprompter : false

  async function updateStatus(newStatus: string) {
    if (!script) return
    setUpdating(true)
    await supabase
      .from('scripts')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', script.id)
    await refetch()
    setUpdating(false)
  }

  async function handleSave() {
    if (!script || !hasUnsavedChanges) return
    setSaving(true)
    try {
      await saveScriptEdit(script.id, editedText)
      await refetch()
      await refetchVersions()
    } catch { /* ignore */ }
    setSaving(false)
  }

  async function handleRegenerate() {
    if (!script) return
    setRegenerating(true)
    setRegenProgress(0)
    try {
      const { job_id } = await generateScript({
        topic: script.topic,
        voice_profile_id: script.voice_profile_id ?? undefined,
        reference_reel_ids: script.reference_reel_ids,
        additional_instructions: regenInstructions || undefined,
        model_provider: modelProvider,
        model_id: modelId,
      })
      // Poll job
      let done = false
      while (!done) {
        await new Promise(r => setTimeout(r, 3000))
        try {
          const job = await getJobStatus(job_id)
          setRegenProgress(job.progress)
          if (job.status === 'completed') {
            done = true
            // The new script was created as a separate record. We need to fetch it and copy content.
            // Fetch the latest script for this user with this topic
            const { data: latestScripts } = await supabase
              .from('scripts')
              .select('*')
              .eq('topic', script.topic)
              .order('created_at', { ascending: false })
              .limit(1)

            if (latestScripts && latestScripts.length > 0) {
              const newScript = latestScripts[0] as Record<string, unknown>
              if (newScript.id !== script.id) {
                // Get max version
                const maxVer = versions.length > 0 ? versions[0].version_number : 0
                // Create regeneration version
                await supabase.from('script_versions').insert({
                  script_id: script.id,
                  version_number: maxVer + 1,
                  script_teleprompter: newScript.script_teleprompter,
                  script_annotated: newScript.script_annotated ?? {},
                  editing_report: newScript.editing_report ?? {},
                  change_type: 'ai_regeneration',
                  change_description: regenInstructions || 'Regenerado com IA',
                })
                // Update current script
                await supabase.from('scripts').update({
                  script_teleprompter: newScript.script_teleprompter,
                  script_annotated: newScript.script_annotated,
                  editing_report: newScript.editing_report,
                  updated_at: new Date().toISOString(),
                }).eq('id', script.id)
                // Delete the duplicate script
                await supabase.from('scripts').delete().eq('id', newScript.id)
              }
            }
            await refetch()
            await refetchVersions()
          } else if (job.status === 'failed') {
            done = true
          }
        } catch { /* continue polling */ }
      }
    } catch { /* ignore */ }
    setRegenerating(false)
    setRegenOpen(false)
    setRegenInstructions('')
  }

  async function handleRestore(versionId: string) {
    try {
      await restoreScriptVersion(script!.id, versionId)
      await refetch()
      await refetchVersions()
    } catch { /* ignore */ }
  }

  function exportMarkdown() {
    if (!script) return
    const report = script.editing_report as Record<string, unknown>
    let md = `# ${script.title}\n\n`
    md += `**Tema:** ${script.topic}\n\n`
    md += `**Duração estimada:** ${script.estimated_duration_seconds ? Math.round(script.estimated_duration_seconds) + 's' : 'N/A'}\n\n`
    md += `---\n\n## Roteiro para Teleprompter\n\n${script.script_teleprompter}\n\n`
    md += `---\n\n## Relatório de Edição\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`

    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${script.title.replace(/\s+/g, '_')}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function exportPDF() {
    if (!script) return
    const { jsPDF } = await import('jspdf')
    const report = (script.editing_report ?? {}) as Record<string, unknown>
    const doc = new jsPDF({ unit: 'pt', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const margin = 50
    const maxWidth = pageWidth - margin * 2
    let y = margin

    function ensureSpace(needed: number) {
      if (y + needed > pageHeight - margin) {
        doc.addPage()
        y = margin
      }
    }

    function write(
      text: string,
      opts: {
        size?: number
        style?: 'normal' | 'bold' | 'italic'
        color?: [number, number, number]
        gap?: number
        leading?: number
      } = {}
    ) {
      const { size = 11, style = 'normal', color = [30, 30, 30], gap = 4, leading = 1.4 } = opts
      doc.setFontSize(size)
      doc.setFont('helvetica', style)
      doc.setTextColor(color[0], color[1], color[2])
      const lineHeight = size * leading
      const lines = doc.splitTextToSize(text, maxWidth) as string[]
      for (const line of lines) {
        ensureSpace(lineHeight)
        doc.text(line, margin, y)
        y += lineHeight
      }
      y += gap
    }

    function divider() {
      ensureSpace(12)
      doc.setDrawColor(220, 220, 220)
      doc.line(margin, y, pageWidth - margin, y)
      y += 12
    }

    // Cover / metadata
    write(script.title, { size: 22, style: 'bold', gap: 6 })
    write(`Tema: ${script.topic}`, { size: 10, color: [90, 90, 90] })
    if (script.estimated_duration_seconds) {
      write(`Duração estimada: ~${Math.round(script.estimated_duration_seconds)}s`, {
        size: 10,
        color: [90, 90, 90],
      })
    }
    if (report.aspect_ratio) write(`Aspecto: ${String(report.aspect_ratio)}`, { size: 10, color: [90, 90, 90] })
    if (report.color_grading) write(`Color Grading: ${String(report.color_grading)}`, { size: 10, color: [90, 90, 90] })
    if (report.captions_style) write(`Legendas: ${String(report.captions_style)}`, { size: 10, color: [90, 90, 90] })
    divider()

    // Music
    if (report.music_recommendation) {
      const music = report.music_recommendation as Record<string, unknown>
      write('Música', { size: 14, style: 'bold', gap: 6 })
      if (music.mood) write(`Mood: ${String(music.mood)}`, { size: 10 })
      if (music.genre) write(`Gênero: ${String(music.genre)}`, { size: 10 })
      if (Array.isArray(music.reference_tracks) && music.reference_tracks.length > 0) {
        write('Referências:', { size: 10, style: 'bold', gap: 2 })
        for (const t of music.reference_tracks as string[]) {
          write(`  • ${t}`, { size: 10, gap: 2 })
        }
      }
      divider()
    }

    // Roteiro
    doc.addPage()
    y = margin
    write('Roteiro para Teleprompter', { size: 16, style: 'bold', gap: 10 })
    write(script.script_teleprompter, { size: 11, leading: 1.6 })

    // Editing instructions
    const instructions = (report.editing_instructions ?? []) as Array<Record<string, unknown>>
    if (instructions.length > 0) {
      doc.addPage()
      y = margin
      write('Relatório de Edição', { size: 16, style: 'bold', gap: 10 })
      for (const inst of instructions) {
        ensureSpace(80)
        const ts = String(inst.timestamp ?? '—')
        const section = String(inst.section ?? '').toUpperCase()
        write(`${ts}  ·  ${section}`, { size: 12, style: 'bold', color: [37, 99, 235], gap: 4 })
        if (inst.visual) write(`Visual: ${String(inst.visual)}`, { size: 10 })
        if (inst.text_overlay) write(`Texto: ${String(inst.text_overlay)}`, { size: 10 })
        if (inst.audio) write(`Áudio: ${String(inst.audio)}`, { size: 10 })
        if (inst.transitions) write(`Transições: ${String(inst.transitions)}`, { size: 10 })
        if (inst.transition_in) write(`Entrada: ${String(inst.transition_in)}`, { size: 10 })
        if (inst.transition_out) write(`Saída: ${String(inst.transition_out)}`, { size: 10 })
        if (Array.isArray(inst.broll_suggestions) && inst.broll_suggestions.length > 0) {
          write('B-Roll:', { size: 10, style: 'bold', gap: 2 })
          for (const b of inst.broll_suggestions as string[]) {
            write(`  • ${b}`, { size: 10, gap: 2 })
          }
        }
        y += 8
      }
    }

    doc.save(`${script.title.replace(/\s+/g, '_')}.pdf`)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    )
  }

  if (error || !script) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/scripts')}>
          <ArrowLeft className="size-4" />
          Voltar
        </Button>
        <p className="text-sm text-destructive">{error ?? 'Roteiro não encontrado'}</p>
      </div>
    )
  }

  const status = STATUS_LABELS[script.status] ?? STATUS_LABELS.draft
  const editingReport = script.editing_report as Record<string, unknown>
  const editingInstructions = (editingReport?.editing_instructions ?? []) as Array<Record<string, unknown>>

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/scripts')}>
            <ArrowLeft className="size-4" />
            Voltar
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">{script.title}</h1>
              <Badge className={status.className}>{status.label}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Tema: {script.topic} · Criado {formatDate(script.created_at)}
              {script.estimated_duration_seconds &&
                ` · ~${Math.round(script.estimated_duration_seconds)}s`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {sourceReelId && (
            <>
              <Button variant="outline" size="sm" onClick={() => setCompareOpen(true)}>
                <Columns2 className="size-3" />
                Comparar
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSourceOpen(true)}>
                <Film className="size-3" />
                Ver conteúdo fonte
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={() => setRegenOpen(true)} disabled={regenerating}>
            <Sparkles className="size-3" />
            {regenerating ? `Regenerando ${regenProgress}%` : 'Regenerar com IA'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/scripts/${script.id}/teleprompter`)}
          >
            <Monitor className="size-3" />
            Teleprompter
          </Button>
          <Button variant="outline" size="sm" onClick={exportMarkdown}>
            <Download className="size-3" />
            Exportar MD
          </Button>
          <Button variant="outline" size="sm" onClick={exportPDF}>
            <Download className="size-3" />
            Exportar PDF
          </Button>
        </div>
      </div>

      {/* Status progression */}
      <Card>
        <CardContent className="flex items-center gap-2 pt-4">
          {STATUS_ORDER.map((s, i) => {
            const currentIdx = STATUS_ORDER.indexOf(script.status)
            const isDone = i <= currentIdx
            const isNext = i === currentIdx + 1
            const label = STATUS_LABELS[s]

            return (
              <div key={s} className="flex items-center gap-2">
                {i > 0 && (
                  <div
                    className={`h-px w-6 ${isDone ? 'bg-primary' : 'bg-border'}`}
                  />
                )}
                <button
                  className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs transition-colors ${
                    isDone
                      ? 'bg-primary/20 text-primary'
                      : isNext
                        ? 'border border-dashed border-primary/50 text-muted-foreground hover:bg-primary/10'
                        : 'text-muted-foreground'
                  }`}
                  onClick={() => isNext && updateStatus(s)}
                  disabled={!isNext || updating}
                >
                  {isDone && <CheckCircle2 className="size-3" />}
                  {label.label}
                </button>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="teleprompter">
        <TabsList>
          <TabsTrigger value="teleprompter">
            <FileText className="size-3" />
            Roteiro
            {hasUnsavedChanges && <span className="ml-1 size-1.5 rounded-full bg-yellow-400" />}
          </TabsTrigger>
          <TabsTrigger value="editing">
            <Monitor className="size-3" />
            Relatório de Edição
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="size-3" />
            Histórico
            {versions.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[9px] px-1 py-0 h-4">{versions.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="teleprompter" className="mt-4">
          <Card>
            <CardContent className="pt-4">
              <div className="mx-auto max-w-2xl">
                <textarea
                  value={editedText}
                  onChange={(e) => setEditedText(e.target.value)}
                  className="w-full min-h-[400px] resize-none bg-transparent text-sm leading-relaxed text-foreground outline-none font-mono"
                  placeholder="Escreva o roteiro aqui..."
                />
              </div>
            </CardContent>
          </Card>
          {hasUnsavedChanges && (
            <div className="mt-3 flex items-center justify-between rounded-xl glass-card px-4 py-3">
              <span className="text-xs text-yellow-400">Alterações não salvas</span>
              <div className="flex gap-2">
                <Button variant="ghost" size="xs" onClick={() => setEditedText(script!.script_teleprompter)}>Descartar</Button>
                <Button size="xs" className="btn-gradient" onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="size-3 animate-spin" /> : 'Salvar'}
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="editing" className="mt-4 space-y-4">
          {/* General info */}
          {editingReport.total_duration_estimate ? (
            <Card>
              <CardContent className="flex flex-wrap gap-4 pt-4">
                <div>
                  <p className="label-uppercase">Duração</p>
                  <p className="text-sm text-foreground">
                    {String(editingReport.total_duration_estimate)}
                  </p>
                </div>
                {editingReport.color_grading ? (
                  <div>
                    <p className="label-uppercase">Color Grading</p>
                    <p className="text-sm text-foreground">
                      {String(editingReport.color_grading)}
                    </p>
                  </div>
                ) : null}
                {editingReport.aspect_ratio ? (
                  <div>
                    <p className="label-uppercase">Aspecto</p>
                    <p className="text-sm text-foreground">
                      {String(editingReport.aspect_ratio)}
                    </p>
                  </div>
                ) : null}
                {editingReport.captions_style ? (
                  <div>
                    <p className="label-uppercase">Legendas</p>
                    <p className="text-sm text-foreground">
                      {String(editingReport.captions_style)}
                    </p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {/* Music recommendation */}
          {editingReport.music_recommendation ? (
            <Card>
              <CardContent className="space-y-2 pt-4">
                <h3 className="text-sm font-semibold text-foreground">Música</h3>
                {(() => {
                  const music = editingReport.music_recommendation as Record<string, unknown>
                  return (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {music.mood ? (
                        <div>
                          <p className="text-[10px] text-muted-foreground">Mood</p>
                          <p className="text-xs text-foreground">{String(music.mood)}</p>
                        </div>
                      ) : null}
                      {music.genre ? (
                        <div>
                          <p className="text-[10px] text-muted-foreground">Gênero</p>
                          <p className="text-xs text-foreground">{String(music.genre)}</p>
                        </div>
                      ) : null}
                    </div>
                  )
                })()}
              </CardContent>
            </Card>
          ) : null}

          {/* Editing instructions timeline */}
          {editingInstructions.length > 0 && (
            <Card>
              <CardContent className="space-y-3 pt-4">
                <h3 className="text-sm font-semibold text-foreground">
                  Instruções de Edição
                </h3>
                {editingInstructions.map((instruction, i) => (
                  <div
                    key={i}
                    className="space-y-1.5 rounded-lg border border-border bg-[rgba(59,130,246,0.04)] border-[rgba(59,130,246,0.12)] p-3"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        {String(instruction.timestamp)}
                      </Badge>
                      <Badge
                        className={
                          instruction.section === 'hook'
                            ? 'bg-red-500/20 text-red-400'
                            : instruction.section === 'cta'
                              ? 'bg-green-500/20 text-green-400'
                              : 'bg-blue-500/20 text-blue-400'
                        }
                      >
                        {String(instruction.section)}
                      </Badge>
                    </div>
                    {instruction.visual ? (
                      <p className="text-xs">
                        <span className="text-muted-foreground">Visual: </span>
                        <span className="text-foreground">{String(instruction.visual)}</span>
                      </p>
                    ) : null}
                    {instruction.text_overlay ? (
                      <p className="text-xs">
                        <span className="text-muted-foreground">Texto: </span>
                        <span className="text-foreground">{String(instruction.text_overlay)}</span>
                      </p>
                    ) : null}
                    {instruction.audio ? (
                      <p className="text-xs">
                        <span className="text-muted-foreground">Áudio: </span>
                        <span className="text-foreground">{String(instruction.audio)}</span>
                      </p>
                    ) : null}
                    {instruction.transitions ? (
                      <p className="text-xs">
                        <span className="text-muted-foreground">Transições: </span>
                        <span className="text-foreground">{String(instruction.transitions)}</span>
                      </p>
                    ) : null}
                    {Array.isArray(instruction.broll_suggestions) && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">B-Roll: </span>
                        <ul className="ml-4 list-disc text-foreground">
                          {(instruction.broll_suggestions as string[]).map((b, bi) => (
                            <li key={bi}>{b}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          {versionsLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-primary" /></div>
          ) : versions.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-muted-foreground text-sm">Nenhuma versão registrada</CardContent></Card>
          ) : (
            <div className="space-y-3">
              {versions.map((v, i) => {
                const isLatest = i === 0
                const typeBadge = v.change_type === 'initial'
                  ? { label: 'Gerado por IA', cls: 'bg-[rgba(59,130,246,0.15)] text-[#60A5FA] border border-[rgba(59,130,246,0.25)]' }
                  : v.change_type === 'manual_edit'
                    ? { label: 'Edição manual', cls: 'bg-[rgba(16,185,129,0.15)] text-accent border border-[rgba(16,185,129,0.25)]' }
                    : { label: 'Regenerado', cls: 'bg-[rgba(147,51,234,0.15)] text-purple-400 border border-[rgba(147,51,234,0.25)]' }
                return (
                  <Card key={v.id}>
                    <CardContent className="flex items-center gap-4 pt-4">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[rgba(59,130,246,0.1)] border border-[rgba(59,130,246,0.2)] text-xs font-bold text-primary">
                        {v.version_number}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge className={typeBadge.cls}>{typeBadge.label}</Badge>
                          {isLatest && <Badge className="bg-[rgba(59,130,246,0.1)] text-[#60A5FA] text-[9px]">Atual</Badge>}
                        </div>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {formatDate(v.created_at)}
                          {v.change_description && ` · ${v.change_description}`}
                        </p>
                        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                          {v.script_teleprompter.slice(0, 120)}...
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button variant="ghost" size="xs" onClick={() => setViewingVersion(viewingVersion === v.id ? null : v.id)}>
                          {viewingVersion === v.id ? 'Fechar' : 'Ver'}
                        </Button>
                        {!isLatest && (
                          <Button variant="outline" size="xs" onClick={() => handleRestore(v.id)}>
                            <RotateCcw className="size-3" />
                            Restaurar
                          </Button>
                        )}
                      </div>
                    </CardContent>
                    {viewingVersion === v.id && (
                      <CardContent className="border-t border-[rgba(59,130,246,0.08)] pt-3">
                        <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-foreground bg-[rgba(59,130,246,0.04)] rounded-lg p-3">
                          {v.script_teleprompter}
                        </pre>
                      </CardContent>
                    )}
                  </Card>
                )
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Regenerate Dialog */}
      <Dialog open={regenOpen} onOpenChange={setRegenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerar Roteiro com IA</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs text-[#CBD5E1]">Instruções para regeneração</label>
              <textarea
                value={regenInstructions}
                onChange={(e) => setRegenInstructions(e.target.value)}
                placeholder="Ex: torne o hook mais agressivo, adicione parte sobre preço..."
                className="w-full min-h-[100px] rounded-lg glass-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-[#CBD5E1]">Modelo</label>
              <ModelSelector compact />
            </div>
            <Button className="w-full btn-gradient" onClick={handleRegenerate} disabled={regenerating}>
              {regenerating ? (
                <><Loader2 className="size-4 animate-spin" /> Regenerando {regenProgress}%</>
              ) : (
                <><Sparkles className="size-4" /> Regenerar</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Comparar: transcrição original × roteiro gerado */}
      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Comparação — Original × Roteiro gerado</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge className="bg-[rgba(59,130,246,0.15)] text-[#60A5FA] border border-[rgba(59,130,246,0.25)]">
                  Transcrição original
                </Badge>
              </div>
              <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-[rgba(59,130,246,0.12)] bg-[rgba(59,130,246,0.04)] p-3">
                {sourceLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="size-5 animate-spin text-primary" />
                  </div>
                ) : sourceTranscript ? (
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">
                    {sourceTranscript}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Transcrição do vídeo original não disponível.
                  </p>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge className="bg-[rgba(16,185,129,0.15)] text-accent border border-[rgba(16,185,129,0.25)]">
                  Seu roteiro
                </Badge>
              </div>
              <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-[rgba(16,185,129,0.15)] bg-[rgba(16,185,129,0.04)] p-3">
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">
                  {script.script_teleprompter}
                </p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Ver conteúdo fonte: vídeo usado para gerar o roteiro */}
      <Dialog open={sourceOpen} onOpenChange={setSourceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conteúdo fonte</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {sourceLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="size-6 animate-spin text-primary" />
              </div>
            ) : sourceReel ? (
              <>
                <div className="mx-auto max-w-[300px]">
                  <VideoPlayer src={sourceVideoSrc} thumbnail={sourceReel.thumbnail_url} />
                </div>
                {sourceReel.caption && (
                  <p className="line-clamp-3 text-xs text-muted-foreground">
                    {sourceReel.caption}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                  <Badge variant="secondary">
                    {formatNumber(sourceReel.likes_count)} curtidas
                  </Badge>
                  <Badge variant="secondary">
                    {formatNumber(sourceReel.comments_count)} comentários
                  </Badge>
                  <Badge variant="secondary">
                    {formatNumber(sourceReel.views_count)} views
                  </Badge>
                  <Badge variant="secondary">
                    {formatNumber(sourceReel.engagement_score)} engagement
                  </Badge>
                </div>
                {sourceInstagramUrl && (
                  <Button
                    render={
                      <a
                        href={sourceInstagramUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      />
                    }
                    variant="outline"
                    className="w-full"
                  >
                    <ExternalLink className="size-4" />
                    Ver no Instagram
                  </Button>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Conteúdo fonte não encontrado (o reel pode ter sido removido).
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

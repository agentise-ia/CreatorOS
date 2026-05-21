import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDuration } from '@/lib/utils'
import type { ContentAnalysis } from '@/types'

interface StructureTimelineProps {
  analysis: ContentAnalysis
  onSeek?: (time: number) => void
}

const sections = [
  { key: 'hook' as const, label: 'Hook', color: 'bg-red-500', textColor: 'text-red-400' },
  { key: 'development' as const, label: 'Desenvolvimento', color: 'bg-blue-500', textColor: 'text-blue-400' },
  { key: 'cta' as const, label: 'CTA', color: 'bg-green-500', textColor: 'text-green-400' },
]

export function StructureTimeline({ analysis, onSeek }: StructureTimelineProps) {
  const hookType = (analysis.hook as { type?: string }).type
  const isFailed =
    hookType === 'timeout' ||
    hookType === 'error' ||
    (analysis.hook.end_ts === 0 && analysis.development.end_ts === 0 && analysis.cta.end_ts === 0)

  if (isFailed) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Estrutura Narrativa</h3>
        <div className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="space-y-1">
            <p className="text-xs font-medium text-destructive">
              {hookType === 'timeout'
                ? 'Análise expirou (timeout)'
                : 'Análise falhou'}
            </p>
            <p className="text-[11px] text-muted-foreground">
              O pipeline (Whisper + Gemini + LLM) não conseguiu concluir essa análise.
              Volte para o perfil deste reel e clique em <span className="text-foreground">"Analisar este reel"</span> de novo.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const totalDuration = Math.max(
    analysis.hook.end_ts,
    analysis.development.end_ts,
    analysis.cta.end_ts,
    1
  )

  // Visual ranges that fill the bar contiguously: hook → development extends
  // to CTA start → CTA fills to the end. The actual timestamps shown in the
  // legend and detail cards remain the original analysis values.
  const visualRanges: Record<'hook' | 'development' | 'cta', { start: number; end: number }> = {
    hook: { start: 0, end: analysis.development.start_ts },
    development: { start: analysis.development.start_ts, end: analysis.cta.start_ts },
    cta: { start: analysis.cta.start_ts, end: totalDuration },
  }

  function getWidth(key: 'hook' | 'development' | 'cta') {
    const r = visualRanges[key]
    return Math.max(((r.end - r.start) / totalDuration) * 100, 0)
  }

  function getLeft(key: 'hook' | 'development' | 'cta') {
    return (visualRanges[key].start / totalDuration) * 100
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-foreground">Estrutura Narrativa</h3>

      {/* Timeline bar — sections render contiguously (no visual gaps) */}
      <div className="relative h-8 w-full overflow-hidden rounded-lg">
        {sections.map((section) => {
          const data = analysis[section.key]
          const width = getWidth(section.key)
          const left = getLeft(section.key)

          return (
            <button
              key={section.key}
              className={cn(
                'absolute top-0 h-full cursor-pointer transition-opacity hover:opacity-80',
                section.color
              )}
              style={{ left: `${left}%`, width: `${width}%` }}
              onClick={() => onSeek?.(data.start_ts)}
              title={`${section.label}: ${formatDuration(data.start_ts)} - ${formatDuration(data.end_ts)}`}
            >
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-white">
                {width > 15 ? section.label : ''}
              </span>
            </button>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-4">
        {sections.map((section) => {
          const data = analysis[section.key]
          return (
            <div key={section.key} className="flex items-center gap-1.5 text-xs">
              <div className={cn('size-2.5 rounded-full', section.color)} />
              <span className={section.textColor}>{section.label}</span>
              <span className="text-muted-foreground">
                {formatDuration(data.start_ts)} - {formatDuration(data.end_ts)}
              </span>
            </div>
          )
        })}
      </div>

      {/* Section details */}
      <div className="space-y-3">
        {sections.map((section) => {
          const data = analysis[section.key]
          return (
            <div
              key={section.key}
              className="rounded-lg border border-[rgba(59,130,246,0.12)] bg-[rgba(59,130,246,0.04)] p-3 space-y-1"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={cn('size-2 rounded-full', section.color)} />
                  <span className="text-xs font-medium text-foreground">
                    {section.label}
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {formatDuration(data.start_ts)} - {formatDuration(data.end_ts)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {data.text}
              </p>
              {section.key === 'hook' && 'effectiveness_score' in data && (
                <p className="text-[10px] text-muted-foreground">
                  Tipo: <span className="text-foreground">{(data as { type: string }).type}</span>
                  {' · '}Eficácia: <span className="text-accent">{(data as { effectiveness_score: number }).effectiveness_score}/10</span>
                </p>
              )}
              {section.key === 'development' && 'storytelling_technique' in data && (
                <p className="text-[10px] text-muted-foreground">
                  Técnica: <span className="text-foreground">{(data as { storytelling_technique: string }).storytelling_technique}</span>
                </p>
              )}
              {section.key === 'cta' && 'strength_score' in data && (
                <p className="text-[10px] text-muted-foreground">
                  Tipo: <span className="text-foreground">{(data as { type: string }).type}</span>
                  {' · '}Força: <span className="text-accent">{(data as { strength_score: number }).strength_score}/10</span>
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

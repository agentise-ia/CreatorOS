import { cn } from '@/lib/utils'
import { formatDuration } from '@/lib/utils'
import type { Transcription } from '@/types'

interface TranscriptViewerProps {
  transcription: Transcription
  currentTime?: number
  onSeek?: (time: number) => void
}

export function TranscriptViewer({
  transcription,
  currentTime = 0,
  onSeek,
}: TranscriptViewerProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Transcrição</h3>

      <div className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-[rgba(59,130,246,0.12)] bg-[rgba(59,130,246,0.04)] p-3">
        {transcription.segments.map((segment, i) => {
          const isActive =
            currentTime >= segment.start && currentTime < segment.end

          return (
            <button
              key={i}
              className={cn(
                'flex w-full gap-3 rounded px-2 py-1.5 text-left transition-colors',
                isActive
                  ? 'bg-primary/10 text-foreground'
                  : 'hover:bg-[rgba(59,130,246,0.08)] text-muted-foreground'
              )}
              onClick={() => onSeek?.(segment.start)}
            >
              <span className="shrink-0 pt-0.5 text-[10px] font-mono text-muted-foreground">
                {formatDuration(segment.start)}
              </span>
              <span className="flex-1 text-xs leading-relaxed">
                {segment.words ? (
                  segment.words.map((word, wi) => {
                    const isWordActive =
                      currentTime >= word.start && currentTime < word.end
                    return (
                      <span
                        key={wi}
                        className={cn(
                          'transition-colors',
                          isWordActive && 'text-primary font-semibold'
                        )}
                      >
                        {word.word}{' '}
                      </span>
                    )
                  })
                ) : (
                  segment.text
                )}
              </span>
            </button>
          )
        })}
      </div>

      <p className="text-[10px] text-muted-foreground">
        Idioma: {transcription.language} · Modelo: {transcription.whisper_model}
      </p>
    </div>
  )
}

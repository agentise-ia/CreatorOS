import { Sparkles } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { ViralPatterns } from '@/types'

interface PatternCardProps {
  patterns: ViralPatterns
}

const patternLabels: Record<string, string> = {
  hook_type: 'Tipo de Hook',
  pacing: 'Ritmo',
  retention_technique: 'Técnica de Retenção',
  emotional_arc: 'Arco Emocional',
}

export function PatternCard({ patterns }: PatternCardProps) {
  const entries = Object.entries(patterns).filter(
    ([, value]) => value !== undefined && value !== null && value !== ''
  )

  if (entries.length === 0) return null

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-accent" />
          <h3 className="text-sm font-semibold text-foreground">Padrões Virais</h3>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {entries.map(([key, value]) => (
            <div key={key} className="min-w-0 space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {patternLabels[key] ?? key}
              </p>
              <Badge
                variant="secondary"
                className="block w-full whitespace-normal break-words text-left text-xs leading-snug"
              >
                {String(value)}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

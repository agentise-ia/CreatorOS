import { useAppStore } from '@/store'
import { OPENAI_MODEL_OPTIONS, ANTHROPIC_MODEL_OPTIONS } from '@/types'
import type { ModelOption, ModelProvider } from '@/types'
import { Badge } from '@/components/ui/badge'

interface ModelSelectorProps {
  compact?: boolean
}

const PROVIDER_LABELS: Record<ModelProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
}

export function ModelSelector({ compact }: ModelSelectorProps) {
  const modelProvider = useAppStore((s) => s.modelProvider)
  const modelId = useAppStore((s) => s.modelId)
  const setModel = useAppStore((s) => s.setModel)
  const anthropicEnabled = useAppStore((s) => s.anthropicEnabled)

  // Grupos visíveis: OpenAI sempre; Anthropic só quando ativado nas Configurações Avançadas.
  const groups: { provider: ModelProvider; options: ModelOption[] }[] = [
    { provider: 'openai', options: OPENAI_MODEL_OPTIONS },
    ...(anthropicEnabled
      ? [{ provider: 'anthropic' as ModelProvider, options: ANTHROPIC_MODEL_OPTIONS }]
      : []),
  ]

  if (compact) {
    const options = groups.flatMap((g) => g.options)
    return (
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const isSelected = opt.provider === modelProvider && opt.model === modelId
          return (
            <button
              key={`${opt.provider}/${opt.model}`}
              className={`rounded-xl border px-2.5 py-1 text-xs transition-all duration-300 ${
                isSelected
                  ? 'border-[rgba(59,130,246,0.45)] bg-[rgba(59,130,246,0.1)] text-primary shadow-[0_0_10px_rgba(59,130,246,0.1)]'
                  : 'border-[rgba(59,130,246,0.12)] text-muted-foreground hover:border-[rgba(59,130,246,0.3)] hover:text-[#60A5FA]'
              }`}
              onClick={() => setModel(opt.provider, opt.model)}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div
          key={group.provider}
          className="rounded-xl border border-[rgba(59,130,246,0.12)] bg-[rgba(59,130,246,0.02)] overflow-hidden"
        >
          <div className="flex items-center gap-2 border-b border-[rgba(59,130,246,0.1)] px-3 py-2.5">
            <span className="text-sm font-medium text-foreground">
              {PROVIDER_LABELS[group.provider]}
            </span>
            <span className="text-[10px] text-muted-foreground">
              · {group.options.length} {group.options.length === 1 ? 'modelo' : 'modelos'}
            </span>
          </div>
          <div className="grid gap-2 p-3 sm:grid-cols-2">
            {group.options.map((opt) => {
              const isSelected = opt.provider === modelProvider && opt.model === modelId
              return (
                <button
                  key={`${opt.provider}/${opt.model}`}
                  className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-all duration-300 ${
                    isSelected
                      ? 'border-[rgba(59,130,246,0.45)] bg-[rgba(59,130,246,0.08)] shadow-[0_0_15px_rgba(59,130,246,0.1)]'
                      : 'border-[rgba(59,130,246,0.12)] hover:border-[rgba(59,130,246,0.3)] hover:bg-[rgba(59,130,246,0.04)]'
                  }`}
                  onClick={() => setModel(opt.provider, opt.model)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">{opt.label}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">{opt.model}</p>
                    </div>
                    {isSelected && (
                      <Badge className="bg-[rgba(59,130,246,0.15)] text-primary text-[10px] border border-[rgba(59,130,246,0.25)] shrink-0">
                        Ativo
                      </Badge>
                    )}
                  </div>
                  {opt.description && (
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      {opt.description}
                    </p>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

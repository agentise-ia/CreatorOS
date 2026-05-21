import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useAppStore } from '@/store'
import { MODEL_OPTIONS, type ModelProvider, type ModelOption } from '@/types'
import { Badge } from '@/components/ui/badge'

interface ModelSelectorProps {
  compact?: boolean
}

const PROVIDER_LABEL: Record<ModelProvider, string> = {
  openai: 'OpenAI',
  gemini: 'Google',
}

function groupByProvider(options: ModelOption[]): Record<ModelProvider, ModelOption[]> {
  return options.reduce(
    (acc, opt) => {
      acc[opt.provider].push(opt)
      return acc
    },
    { openai: [], gemini: [] } as Record<ModelProvider, ModelOption[]>
  )
}

export function ModelSelector({ compact }: ModelSelectorProps) {
  const modelProvider = useAppStore((s) => s.modelProvider)
  const modelId = useAppStore((s) => s.modelId)
  const setModel = useAppStore((s) => s.setModel)
  const [expanded, setExpanded] = useState<Record<ModelProvider, boolean>>({
    openai: modelProvider === 'openai',
    gemini: modelProvider === 'gemini',
  })

  if (compact) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {MODEL_OPTIONS.map((opt) => {
          const isSelected = opt.provider === modelProvider && opt.model === modelId
          return (
            <button
              key={opt.model}
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

  const grouped = groupByProvider(MODEL_OPTIONS)
  const providers: ModelProvider[] = ['openai', 'gemini']

  const toggle = (p: ModelProvider) =>
    setExpanded((prev) => ({ ...prev, [p]: !prev[p] }))

  return (
    <div className="space-y-2">
      {providers.map((provider) => {
        const items = grouped[provider]
        const isOpen = expanded[provider]
        const activeInGroup = items.find(
          (opt) => opt.provider === modelProvider && opt.model === modelId
        )

        return (
          <div
            key={provider}
            className="rounded-xl border border-[rgba(59,130,246,0.12)] bg-[rgba(59,130,246,0.02)] overflow-hidden"
          >
            <button
              type="button"
              onClick={() => toggle(provider)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[rgba(59,130,246,0.04)]"
              aria-expanded={isOpen}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  {PROVIDER_LABEL[provider]}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  · {items.length} {items.length === 1 ? 'modelo' : 'modelos'}
                </span>
                {activeInGroup && (
                  <Badge className="bg-[rgba(59,130,246,0.15)] text-primary text-[10px] border border-[rgba(59,130,246,0.25)]">
                    {activeInGroup.label}
                  </Badge>
                )}
              </div>
              <ChevronDown
                className={`size-4 text-muted-foreground transition-transform duration-200 ${
                  isOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {isOpen && (
              <div className="grid gap-2 border-t border-[rgba(59,130,246,0.1)] p-3 sm:grid-cols-2">
                {items.map((opt) => {
                  const isSelected =
                    opt.provider === modelProvider && opt.model === modelId
                  return (
                    <button
                      key={opt.model}
                      className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-all duration-300 ${
                        isSelected
                          ? 'border-[rgba(59,130,246,0.45)] bg-[rgba(59,130,246,0.08)] shadow-[0_0_15px_rgba(59,130,246,0.1)]'
                          : 'border-[rgba(59,130,246,0.12)] hover:border-[rgba(59,130,246,0.3)] hover:bg-[rgba(59,130,246,0.04)]'
                      }`}
                      onClick={() => setModel(opt.provider, opt.model)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {opt.label}
                          </p>
                          <p className="font-mono text-[10px] text-muted-foreground">
                            {opt.model}
                          </p>
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
            )}
          </div>
        )
      })}
    </div>
  )
}

// Layout/Shell do wizard /setup. Glassmorphism dark, step indicator
// permanente, max-width controlado.
import type { ReactNode } from 'react'

export type StepStatus = 'pending' | 'active' | 'done'

interface StepIndicatorProps {
  current: number
  total: number
  labels: string[]
}

function StepIndicator({ current, total, labels }: StepIndicatorProps) {
  return (
    <div className="mx-auto mb-8 flex max-w-2xl items-center justify-between">
      {Array.from({ length: total }).map((_, i) => {
        const status: StepStatus = i + 1 < current ? 'done' : i + 1 === current ? 'active' : 'pending'
        return (
          <div key={i} className="flex flex-1 items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={[
                  'flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-semibold transition-all duration-400',
                  status === 'done'
                    ? 'border-[#10B981] bg-[rgba(16,185,129,0.15)] text-[#10B981]'
                    : status === 'active'
                      ? 'border-[#3B82F6] bg-gradient-to-br from-[#1E3A8A] to-[#3B82F6] text-white shadow-[0_0_30px_rgba(59,130,246,0.5)]'
                      : 'border-[rgba(59,130,246,0.2)] bg-[rgba(255,255,255,0.03)] text-[#94A3B8]',
                ].join(' ')}
              >
                {status === 'done' ? '✓' : i + 1}
              </div>
              <span className="text-[10px] uppercase tracking-wider text-[#94A3B8]">
                {labels[i]}
              </span>
            </div>
            {i < total - 1 && (
              <div
                className={[
                  'mx-2 h-px flex-1 transition-all duration-400',
                  i + 1 < current ? 'bg-[#10B981]' : 'bg-[rgba(59,130,246,0.15)]',
                ].join(' ')}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

interface WizardShellProps {
  step: number
  total: number
  stepLabels: string[]
  title: string
  subtitle?: string
  children: ReactNode
}

export default function WizardShell({
  step,
  total,
  stepLabels,
  title,
  subtitle,
  children,
}: WizardShellProps) {
  return (
    <div
      className="min-h-screen px-4 py-10 sm:py-16"
      style={{
        background:
          'radial-gradient(ellipse at 20% 0%, rgba(59,130,246,0.08), transparent 50%),' +
          'radial-gradient(ellipse at 80% 100%, rgba(37,99,235,0.05), transparent 50%),' +
          '#0A0A0F',
      }}
    >
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="bg-gradient-to-r from-[#60A5FA] to-[#3B82F6] bg-clip-text text-3xl font-bold text-transparent sm:text-4xl">
            Creator OS — Setup
          </h1>
          <p className="mt-2 text-sm text-[#94A3B8]">
            Configure sua instância em ~5 minutos. Sem terminal, sem código.
          </p>
        </div>

        <StepIndicator current={step} total={total} labels={stepLabels} />

        <div
          className="rounded-2xl border border-[rgba(59,130,246,0.25)] bg-[rgba(15,18,35,0.6)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_20px_60px_-20px_rgba(0,0,0,0.5)] backdrop-blur-[40px] sm:p-8"
        >
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-[#F8FAFC]">{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-[#94A3B8]">{subtitle}</p>}
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

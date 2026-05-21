// Input com validação debounced inline. Mostra ✓/✗ + mensagem em pt-BR.
import { useEffect, useRef, useState } from 'react'

type V = { ok: boolean; message?: string }

interface ValidatedInputProps {
  label: string
  value: string
  onChange: (v: string) => void
  onValidChange?: (ok: boolean) => void
  validate: (v: string) => Promise<V> | V
  placeholder?: string
  inputType?: 'text' | 'password' | 'email'
  helpText?: string
  docsUrl?: string
  optional?: boolean
}

export function ValidatedInput({
  label,
  value,
  onChange,
  onValidChange,
  validate,
  placeholder,
  inputType = 'text',
  helpText,
  docsUrl,
  optional,
}: ValidatedInputProps) {
  const [state, setState] = useState<'idle' | 'pending' | 'ok' | 'fail'>('idle')
  const [message, setMessage] = useState<string | undefined>()
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current)
    if (!value) {
      setState('idle')
      setMessage(undefined)
      onValidChange?.(optional === true)
      return
    }
    setState('pending')
    timer.current = window.setTimeout(async () => {
      try {
        const res = await validate(value)
        if (res.ok) {
          setState('ok')
          setMessage(undefined)
          onValidChange?.(true)
        } else {
          setState('fail')
          setMessage(res.message)
          onValidChange?.(false)
        }
      } catch (err) {
        setState('fail')
        setMessage((err as Error).message)
        onValidChange?.(false)
      }
    }, 800)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const borderClass =
    state === 'ok'
      ? 'border-[#10B981] shadow-[0_0_20px_rgba(16,185,129,0.2)]'
      : state === 'fail'
        ? 'border-[#EF4444] shadow-[0_0_20px_rgba(239,68,68,0.2)]'
        : state === 'pending'
          ? 'border-[#3B82F6]'
          : 'border-[rgba(59,130,246,0.2)]'

  return (
    <div className="space-y-1.5">
      <label className="flex items-center justify-between text-xs font-medium text-[#CBD5E1]">
        <span>
          {label}{' '}
          {optional && <span className="text-[10px] text-[#94A3B8]">(opcional)</span>}
        </span>
        {docsUrl && (
          <a
            href={docsUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-[#60A5FA] underline-offset-2 hover:underline"
          >
            onde gerar?
          </a>
        )}
      </label>
      <div className="relative">
        <input
          type={inputType}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-lg border bg-[rgba(255,255,255,0.03)] px-3 py-2 pr-9 font-mono text-sm text-[#F8FAFC] outline-none transition-all duration-300 focus:border-[#3B82F6] focus:shadow-[0_0_30px_rgba(59,130,246,0.3)] ${borderClass}`}
        />
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm">
          {state === 'pending' && <span className="text-[#60A5FA]">…</span>}
          {state === 'ok' && <span className="text-[#10B981]">✓</span>}
          {state === 'fail' && <span className="text-[#EF4444]">✗</span>}
        </span>
      </div>
      {state === 'fail' && message && (
        <p className="text-xs text-[#EF4444]">{message}</p>
      )}
      {state !== 'fail' && helpText && (
        <p className="text-xs text-[#94A3B8]">{helpText}</p>
      )}
    </div>
  )
}

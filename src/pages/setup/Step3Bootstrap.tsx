// Step 3 — Executa /api/bootstrap e mostra timeline visual com status.
import { useEffect, useState } from 'react'
import type { CoreCredentials } from './wizardStorage'

interface Step3Props {
  credentials: CoreCredentials
  onDone: (info?: { deployment?: { id?: string; url?: string } }) => void
  onError: (message: string) => void
}

type StepDef = {
  key: string
  label: string
  detail: string
  /** prefixos no array steps_completed que satisfazem este step */
  matches: (completed: string[]) => boolean
}

const PIPELINE: StepDef[] = [
  {
    key: 'init',
    label: 'Conectando ao Supabase',
    detail: 'Criando tabelas de infra (app_settings, _bootstrap_state)',
    matches: (c) => c.includes('init'),
  },
  {
    key: 'migrations',
    label: 'Aplicando migrations',
    detail: 'Schema do banco do Creator OS',
    matches: (c) => c.some((s) => s.startsWith('migration:')),
  },
  {
    key: 'functions',
    label: 'Deployando Edge Functions',
    detail: '8 functions: scrape, analyze, generate-script, etc.',
    matches: (c) => c.some((s) => s.startsWith('ef:')),
  },
  {
    key: 'owner',
    label: 'Criando conta de owner',
    detail: 'Primeiro usuário com role "owner"',
    matches: (c) => c.includes('owner_created'),
  },
  {
    key: 'vercel',
    label: 'Configurando Vercel',
    detail: 'Setando envs e disparando redeploy',
    matches: (c) => c.includes('vercel_envs_set'),
  },
  {
    key: 'redeploy',
    label: 'Disparando redeploy',
    detail: 'Vercel recebeu o pedido de rebuild com as novas envs',
    matches: (c) => c.includes('redeploy_triggered'),
  },
  {
    key: 'health',
    label: 'Aguardando reinício',
    detail: 'Nova versão respondendo com Supabase e CRYPTO_KEY carregados',
    matches: (c) => c.includes('health_ready'),
  },
]

type Status = 'pending' | 'running' | 'done' | 'failed'
type BootstrapStep = { step?: string } | string

const HEALTH_TIMEOUT_MS = 5 * 60 * 1000
const HEALTH_POLL_INTERVAL_MS = 3000

function sleep(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

async function waitForHealth(cancelled: () => boolean) {
  const startedAt = Date.now()

  while (!cancelled()) {
    try {
      const res = await fetch(`${window.location.origin}/api/health`, {
        method: 'GET',
        cache: 'no-store',
      })
      if (res.ok) return
    } catch {
      // O deployment pode estar trocando de versão; seguimos aguardando.
    }

    if (Date.now() - startedAt >= HEALTH_TIMEOUT_MS) {
      throw new Error(
        'O redeploy foi disparado, mas a nova versão não ficou pronta em até 5 minutos. Verifique manualmente em vercel.com/dashboard e recarregue esta página.',
      )
    }

    await sleep(HEALTH_POLL_INTERVAL_MS)
  }
}

export default function Step3Bootstrap({ credentials, onDone, onError }: Step3Props) {
  const [completed, setCompleted] = useState<string[]>([])
  const [overall, setOverall] = useState<Status>('running')
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [deployment, setDeployment] = useState<{ id?: string; url?: string } | undefined>()

  useEffect(() => {
    let cancelled = false
    async function run() {
      try {
        setOverall('running')
        const res = await fetch('/api/bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(credentials),
        })
        const data = await res.json()
        if (cancelled) return
        const steps: string[] = (data.steps_completed ?? []).map((s: BootstrapStep) =>
          typeof s === 'string' ? s : (s.step ?? ''),
        )
        setCompleted(steps)
        if (!res.ok || !data.success) {
          setOverall('failed')
          setErrMsg(data.message ?? `Erro ${res.status}`)
          onError(data.message ?? `Erro ${res.status}`)
          return
        }
        if (data.deployment) setDeployment(data.deployment)
        await waitForHealth(() => cancelled)
        if (cancelled) return
        setCompleted([...steps, 'health_ready'])
        setOverall('done')
        onDone({ deployment: data.deployment })
      } catch (err) {
        if (cancelled) return
        setOverall('failed')
        setErrMsg((err as Error).message)
        onError((err as Error).message)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function retry() {
    setErrMsg(null)
    setCompleted([])
    setOverall('running')
    // dispara novo effect remontando — toggle via state hack
    window.location.reload()
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {PIPELINE.map((p) => {
          let s: Status = 'pending'
          if (p.matches(completed)) s = 'done'
          else if (overall === 'failed') s = 'pending'
          else if (overall === 'running') {
            // qual é o primeiro pendente? esse vira "running"
            const firstPending = PIPELINE.find((x) => !x.matches(completed))
            if (firstPending?.key === p.key) s = 'running'
          }
          return <PipelineRow key={p.key} status={s} label={p.label} detail={p.detail} />
        })}
      </div>

      {overall === 'failed' && errMsg && (
        <div className="rounded-lg border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.05)] p-4 text-sm">
          <div className="mb-1 font-semibold text-[#EF4444]">Erro durante o setup</div>
          <p className="font-mono text-xs text-[#FCA5A5]">{errMsg}</p>
          <button
            onClick={retry}
            className="mt-3 rounded-lg border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)] px-3 py-1.5 text-xs text-[#FCA5A5] hover:bg-[rgba(239,68,68,0.15)]"
          >
            Tentar de novo (retoma do step que falhou)
          </button>
        </div>
      )}

      {overall === 'done' && deployment?.url && (
        <div className="rounded-lg border border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.05)] p-4 text-sm">
          <div className="mb-1 font-semibold text-[#10B981]">
            Bootstrap concluído ✓
          </div>
          <p className="text-xs text-[#CBD5E1]">
            Nova versão pronta. Vamos concluir a autenticação do owner.
          </p>
          <p className="mt-2 font-mono text-[10px] text-[#94A3B8]">
            Deployment:{' '}
            <a
              href={`https://${deployment.url}`}
              target="_blank"
              rel="noreferrer"
              className="text-[#60A5FA] hover:underline"
            >
              {deployment.url}
            </a>
          </p>
        </div>
      )}

      {overall === 'failed' && deployment?.url && (
        <p className="text-xs text-[#94A3B8]">
          Deployment disparado:{' '}
          <a
            href={`https://${deployment.url}`}
            target="_blank"
            rel="noreferrer"
            className="text-[#60A5FA] hover:underline"
          >
            {deployment.url}
          </a>
          {' · '}
          <a
            href="https://vercel.com/dashboard"
            target="_blank"
            rel="noreferrer"
            className="text-[#60A5FA] hover:underline"
          >
            Abrir dashboard da Vercel
          </a>
        </p>
      )}
    </div>
  )
}

function PipelineRow({
  status,
  label,
  detail,
}: {
  status: Status
  label: string
  detail: string
}) {
  const icon =
    status === 'done' ? (
      <span className="text-[#10B981]">✓</span>
    ) : status === 'running' ? (
      <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-[#3B82F6] shadow-[0_0_15px_#3B82F6]" />
    ) : (
      <span className="inline-block h-3 w-3 rounded-full border border-[rgba(59,130,246,0.3)]" />
    )

  return (
    <div
      className={[
        'flex items-center gap-3 rounded-lg border p-3 transition-all duration-300',
        status === 'done'
          ? 'border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.04)]'
          : status === 'running'
            ? 'border-[#3B82F6] bg-[rgba(59,130,246,0.06)] shadow-[0_0_30px_rgba(59,130,246,0.2)]'
            : 'border-[rgba(59,130,246,0.12)] bg-[rgba(15,18,35,0.4)]',
      ].join(' ')}
    >
      <div className="flex h-7 w-7 items-center justify-center">{icon}</div>
      <div className="flex-1">
        <div className="text-sm font-medium text-[#F8FAFC]">{label}</div>
        <div className="text-[11px] text-[#94A3B8]">{detail}</div>
      </div>
    </div>
  )
}

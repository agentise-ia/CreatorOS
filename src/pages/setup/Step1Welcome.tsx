interface Step1Props {
  onNext: () => void
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-[rgba(59,130,246,0.15)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[#60A5FA]">
      {children}
    </span>
  )
}

export default function Step1Welcome({ onNext }: Step1Props) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-[#CBD5E1]">
        Antes de continuar, abra estas três abas no seu navegador e tenha em
        mãos as credenciais. Volte aqui quando estiver tudo pronto.
      </p>

      <div className="space-y-3">
        <Item
          step="1"
          title="Criar projeto Supabase"
          url="https://supabase.com/dashboard/new"
          desc="Anote: Project URL, anon key, service_role key (em Settings → API). Pode demorar ~1 min pra subir."
        >
          <Pill>URL</Pill>
          <Pill>anon key</Pill>
          <Pill>service_role</Pill>
        </Item>

        <Item
          step="2"
          title="Gerar Personal Access Token Supabase"
          url="https://supabase.com/dashboard/account/tokens"
          desc='Clique em "Generate new token", dê um nome ("creator-os-setup") e copie o sbp_...'
        >
          <Pill>sbp_…</Pill>
        </Item>

        <Item
          step="3"
          title="Gerar Vercel Token"
          url="https://vercel.com/account/tokens"
          desc='Em "Create Token", expire em 30 dias é o suficiente. Escopo "Full account".'
        >
          <Pill>vercel token</Pill>
        </Item>
      </div>

      <div className="rounded-lg border border-[rgba(59,130,246,0.15)] bg-[rgba(59,130,246,0.05)] p-3 text-xs text-[#94A3B8]">
        Você também vai escolher um <strong className="text-[#CBD5E1]">email</strong>{' '}
        e uma <strong className="text-[#CBD5E1]">senha (8+ chars)</strong> para a
        conta de owner desta instância. Anote agora, vai pedir no próximo passo.
      </div>

      <button
        onClick={onNext}
        className="w-full rounded-lg bg-gradient-to-br from-[#1E3A8A] to-[#3B82F6] px-4 py-2.5 font-medium text-white shadow-[0_0_30px_rgba(59,130,246,0.3)] transition-all duration-400 hover:shadow-[0_0_60px_rgba(59,130,246,0.5)]"
      >
        Já tenho tudo isso → continuar
      </button>
    </div>
  )
}

function Item({
  step,
  title,
  url,
  desc,
  children,
}: {
  step: string
  title: string
  url: string
  desc: string
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-[rgba(59,130,246,0.15)] bg-[rgba(15,18,35,0.4)] p-3 transition-all duration-300 hover:border-[rgba(59,130,246,0.3)] hover:shadow-[0_0_30px_rgba(59,130,246,0.1)]">
      <div className="flex items-start gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[rgba(59,130,246,0.3)] bg-[rgba(59,130,246,0.1)] text-xs font-semibold text-[#60A5FA]">
          {step}
        </div>
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-[#F8FAFC]">{title}</h3>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-[#60A5FA] underline-offset-2 hover:underline"
            >
              abrir ↗
            </a>
          </div>
          <p className="text-xs text-[#94A3B8]">{desc}</p>
          {children && <div className="flex flex-wrap gap-1.5 pt-1">{children}</div>}
        </div>
      </div>
    </div>
  )
}

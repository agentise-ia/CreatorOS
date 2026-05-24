// Orquestrador do wizard. O step é persistido em localStorage (sobrevive a F5);
// as credenciais NÃO-sensíveis também. Campos sensíveis (senha, service_role,
// PAT, Vercel token) vivem só em memória React — ver wizardStorage.ts.
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import WizardShell from './WizardShell'
import Step1Welcome from './Step1Welcome'
import Step2Core from './Step2Core'
import Step3Bootstrap from './Step3Bootstrap'
import Step4AppCredentials from './Step4AppCredentials'
import { clearAll, emptyCore, loadStep, saveStep, type CoreCredentials } from './wizardStorage'
import { setupConfig } from '../../../setup.config'

const STEP_LABELS = ['Preparar', 'Credenciais', 'Bootstrap', 'APIs']

export default function SetupWizardPage() {
  const [step, setStep] = useState<number>(() => {
    const saved = loadStep<number>('step', 1)
    // Step 3 dispara /api/bootstrap usando creds sensíveis (service_role/PAT/
    // Vercel/senha) que só vivem em memória React e somem num reload. Se
    // retomamos no Step 3 após um reload, recuamos pro Step 2 pra re-digitá-las
    // — senão o Step 3 POSTaria com campos vazios → 400 "Campo obrigatório
    // ausente". O bootstrap é idempotente (retoma pelos checkpoints).
    return saved === 3 ? 2 : saved
  })
  // emptyCore garante que campos sensíveis (que não persistem) comecem vazios
  // mesmo quando loadStep('core') traz de volta só os campos não-sensíveis.
  const [core, setCore] = useState<CoreCredentials>(() => ({
    ...emptyCore,
    ...loadStep<Partial<CoreCredentials>>('core', {}),
  }))
  // Token do owner, obtido por login automático no fim do Step 3. Vive só em
  // memória — usado pelo Step 4 no header Authorization de /api/credentials.
  const [ownerToken, setOwnerToken] = useState<string | null>(null)
  const [authPending, setAuthPending] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    saveStep('step', step)
  }, [step])
  useEffect(() => {
    // saveStep remove chaves sensíveis automaticamente antes de gravar.
    saveStep('core', core)
  }, [core])

  function goNext() {
    setStep((s) => Math.min(4, s + 1))
  }
  function goBack() {
    setStep((s) => Math.max(1, s - 1))
  }

  // Após o bootstrap concluir (owner já criado no Supabase), autentica usando a
  // senha que ainda está em memória React, captura o access_token e LIMPA a
  // senha imediatamente. Usa um client construído com as creds em memória (o
  // singleton do app pode ser um stub enquanto VITE_SUPABASE_URL não existe).
  async function handleBootstrapDone() {
    setAuthError(null)
    setAuthPending(true)
    try {
      const client = createClient(core.supabase_url, core.supabase_anon_key, {
        auth: { persistSession: false },
      })
      const { data, error } = await client.auth.signInWithPassword({
        email: core.owner_email,
        password: core.owner_password,
      })
      if (error || !data.session) {
        throw new Error(error?.message ?? 'Sessão não retornada pelo Supabase')
      }
      setOwnerToken(data.session.access_token)
      // Limpa a senha da memória React assim que o login dá certo.
      setCore((c) => ({ ...c, owner_password: '' }))
      setStep(4)
    } catch (err) {
      setAuthError((err as Error).message)
    } finally {
      setAuthPending(false)
    }
  }

  let body: React.ReactNode
  let title = ''
  let subtitle: string | undefined

  if (step === 1) {
    title = 'Antes de começar'
    subtitle = 'Abra estas três páginas em outras abas — vamos precisar das credenciais.'
    body = <Step1Welcome onNext={goNext} />
  } else if (step === 2) {
    title = 'Credenciais Supabase + Vercel'
    subtitle = 'Cada campo é validado contra a API real (via servidor) conforme você digita.'
    body = (
      <Step2Core
        value={core}
        onChange={setCore}
        onBack={goBack}
        onSubmit={(v) => {
          setCore(v)
          setStep(3)
        }}
      />
    )
  } else if (step === 3) {
    title = 'Configurando sua instância'
    subtitle = 'Não feche esta aba. Cada checkpoint é persistido — se algo falhar, retomamos do ponto.'
    body = (
      <div className="space-y-4">
        <Step3Bootstrap
          credentials={core}
          onDone={handleBootstrapDone}
          onError={() => {
            /* tratado dentro do step */
          }}
        />
        {authPending && (
          <p className="text-xs text-[#60A5FA]">Autenticando como owner…</p>
        )}
        {authError && (
          <div className="rounded-lg border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.05)] p-4 text-sm">
            <div className="mb-1 font-semibold text-[#EF4444]">
              Não conseguimos te autenticar automaticamente
            </div>
            <p className="font-mono text-xs text-[#FCA5A5]">{authError}</p>
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={handleBootstrapDone}
                className="rounded-lg border border-[rgba(59,130,246,0.4)] bg-[rgba(59,130,246,0.1)] px-3 py-1.5 text-xs text-[#93C5FD] hover:bg-[rgba(59,130,246,0.15)]"
              >
                Tentar novamente
              </button>
              <a href="/login" className="text-xs text-[#60A5FA] hover:underline">
                Fazer login manualmente
              </a>
            </div>
          </div>
        )}
      </div>
    )
  } else {
    title = 'APIs da aplicação'
    subtitle = 'Apify (scraping), OpenAI (Whisper + GPT) e Gemini (vídeo) são obrigatórias. Resend é opcional.'
    body = (
      <Step4AppCredentials
        accessToken={ownerToken}
        onDone={() => {
          clearAll()
          window.location.replace(setupConfig.postBootstrapRedirect)
        }}
      />
    )
  }

  return (
    <WizardShell step={step} total={4} stepLabels={STEP_LABELS} title={title} subtitle={subtitle}>
      {body}
    </WizardShell>
  )
}

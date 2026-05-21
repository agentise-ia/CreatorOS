// Orquestrador do wizard. Estado de step + credenciais é persistido em
// localStorage para sobreviver a F5.
import { useEffect, useState } from 'react'
import WizardShell from './WizardShell'
import Step1Welcome from './Step1Welcome'
import Step2Core from './Step2Core'
import Step3Bootstrap from './Step3Bootstrap'
import Step4AppCredentials from './Step4AppCredentials'
import { clearAll, emptyCore, loadStep, saveStep, type CoreCredentials } from './wizardStorage'
import { setupConfig } from '../../../setup.config'

const STEP_LABELS = ['Preparar', 'Credenciais', 'Bootstrap', 'APIs']

export default function SetupWizardPage() {
  const [step, setStep] = useState<number>(() => loadStep<number>('step', 1))
  const [core, setCore] = useState<CoreCredentials>(() =>
    loadStep<CoreCredentials>('core', emptyCore),
  )

  useEffect(() => {
    saveStep('step', step)
  }, [step])
  useEffect(() => {
    saveStep('core', core)
  }, [core])

  function goNext() {
    setStep((s) => Math.min(4, s + 1))
  }
  function goBack() {
    setStep((s) => Math.max(1, s - 1))
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
    subtitle = 'Cada campo é validado contra a API real conforme você digita.'
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
      <Step3Bootstrap
        credentials={core}
        onDone={() => setStep(4)}
        onError={() => {
          /* tratado dentro do step */
        }}
      />
    )
  } else {
    title = 'APIs da aplicação'
    subtitle = 'Apify (scraping), OpenAI (Whisper + GPT) e Gemini (vídeo) são obrigatórias. Resend é opcional.'
    body = (
      <Step4AppCredentials
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

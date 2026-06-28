import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { X, Play, Pause, Minus, Plus, RotateCcw, Camera, CameraOff, SwitchCamera, Circle, Square, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useScript } from '@/hooks/useScripts'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function TeleprompterPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { script, loading } = useScript(id)

  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(2) // pixels per frame
  const [fontSize, setFontSize] = useState(32)
  const scrollRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<number>(0)

  // Câmera (fundo do teleprompter)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cameraOn, setCameraOn] = useState(false)
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user')
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [videoInputCount, setVideoInputCount] = useState(0)

  const isMobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  const isIOS = typeof navigator !== 'undefined' &&
    (/iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      // iPadOS 13+ se identifica como Mac com touch
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
  const canFlip = isMobile || videoInputCount > 1

  // No iOS, facingMode 'environment' costuma cair na ultra-wide (0.5x) ou num
  // device "virtual" (dupla/tripla) que inicia na 0.5x. Seleciona a câmera
  // traseira PRINCIPAL (1.0x) pelo label, evitando ultra-wide/telephoto.
  function pickMainBackCameraId(devices: MediaDeviceInfo[]): string | null {
    const vids = devices.filter((d) => d.kind === 'videoinput' && d.label)
    const back = vids.filter((d) => /back|traseira|rear|trás/i.test(d.label))
    const pool = back.length > 0 ? back : vids
    // SÓ evitamos a ultra-wide (0.5x) e a telephoto. As câmeras "Dual/Triple/Wide"
    // são devices virtuais que iniciam na lente WIDE 1.0x — essas servem.
    const AVOID = /ultra|angular|tele|teleobjetiva/i
    // 1) "Back Camera" / "Câmera traseira" exata (a wide principal)
    const exact = pool.find((d) => /^(back camera|câmera traseira|rear camera)$/i.test(d.label.trim()))
    if (exact) return exact.deviceId
    // 2) qualquer traseira que não seja ultra-wide/telephoto (dual/triple/wide ok)
    const main = pool.find((d) => !AVOID.test(d.label))
    return (main ?? pool[0])?.deviceId ?? null
  }

  // Gravação de vídeo (câmera + microfone)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioStreamRef = useRef<MediaStream | null>(null)
  const recordedUrlRef = useRef<string | null>(null)
  // Composição via canvas: grava sempre em 9:16 (1080x1920), sem depender da
  // proporção/zoom do sensor. O frame da câmera é desenhado em "cover" (igual ao
  // preview), garantindo o formato vertical sem o zoom do crop por aspectRatio.
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number>(0)
  const canvasStreamRef = useRef<MediaStream | null>(null)
  const [recording, setRecording] = useState(false)
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null)
  const [recordExt, setRecordExt] = useState<'mp4' | 'webm'>('webm')
  const [recordError, setRecordError] = useState<string | null>(null)

  function pickMimeType(): { mimeType: string; ext: 'mp4' | 'webm' } {
    // Prioriza MP4 (reproduzível direto no iOS/Android e galeria do celular).
    // Só cai pra webm se o navegador não suportar nenhum container MP4.
    const candidates: Array<{ mimeType: string; ext: 'mp4' | 'webm' }> = [
      { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' },
      { mimeType: 'video/mp4;codecs=h264,aac', ext: 'mp4' },
      { mimeType: 'video/mp4;codecs=avc1', ext: 'mp4' },
      { mimeType: 'video/mp4', ext: 'mp4' },
      { mimeType: 'video/webm;codecs=vp9,opus', ext: 'webm' },
      { mimeType: 'video/webm;codecs=vp8,opus', ext: 'webm' },
      { mimeType: 'video/webm', ext: 'webm' },
    ]
    for (const c of candidates) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c.mimeType)) return c
    }
    return { mimeType: '', ext: 'webm' }
  }

  function clearRecording() {
    if (recordedUrlRef.current) {
      URL.revokeObjectURL(recordedUrlRef.current)
      recordedUrlRef.current = null
    }
    setRecordedUrl(null)
  }

  async function startRecording() {
    setRecordError(null)
    try {
      // garante câmera ligada
      if (!cameraOn || !streamRef.current) {
        await startCamera(facingMode)
      }
      const camStream = streamRef.current
      if (!camStream) throw new Error('camera')

      // captura áudio do microfone só durante a gravação
      let audioTracks: MediaStreamTrack[] = []
      try {
        const audio = await navigator.mediaDevices.getUserMedia({ audio: true })
        audioStreamRef.current = audio
        audioTracks = audio.getAudioTracks()
      } catch {
        // sem microfone — grava só o vídeo
        audioTracks = []
      }

      // Monta um canvas 9:16 e desenha o frame da câmera em "cover" (igual ao
      // preview). Gravamos o stream do canvas → saída sempre 1080x1920 vertical.
      const CW = 1080, CH = 1920
      const canvas = canvasRef.current ?? document.createElement('canvas')
      canvas.width = CW
      canvas.height = CH
      canvasRef.current = canvas
      const ctx = canvas.getContext('2d')
      const srcVideo = videoRef.current
      const mirror = facingMode === 'user'

      const drawFrame = () => {
        if (ctx && srcVideo && srcVideo.videoWidth > 0) {
          const vw = srcVideo.videoWidth
          const vh = srcVideo.videoHeight
          const scale = Math.max(CW / vw, CH / vh) // cover
          const dw = vw * scale
          const dh = vh * scale
          const dx = (CW - dw) / 2
          const dy = (CH - dh) / 2
          ctx.save()
          if (mirror) {
            ctx.translate(CW, 0)
            ctx.scale(-1, 1)
          }
          ctx.drawImage(srcVideo, dx, dy, dw, dh)
          ctx.restore()
        }
        rafRef.current = requestAnimationFrame(drawFrame)
      }
      drawFrame()

      const canvasStream = (canvas as HTMLCanvasElement & { captureStream: (fps?: number) => MediaStream }).captureStream(30)
      canvasStreamRef.current = canvasStream

      const combined = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks])
      const { mimeType } = pickMimeType()
      const recorder = new MediaRecorder(combined, mimeType ? { mimeType } : undefined)
      // Tipo real usado pelo navegador (pode diferir do pedido).
      const actualType = recorder.mimeType || mimeType || 'video/webm'
      const actualExt: 'mp4' | 'webm' = actualType.includes('mp4') ? 'mp4' : 'webm'
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        // para o loop de desenho e o stream do canvas
        cancelAnimationFrame(rafRef.current)
        if (canvasStreamRef.current) {
          canvasStreamRef.current.getTracks().forEach((t) => t.stop())
          canvasStreamRef.current = null
        }
        const blob = new Blob(chunksRef.current, { type: actualType })
        clearRecording()
        const url = URL.createObjectURL(blob)
        recordedUrlRef.current = url
        setRecordedUrl(url)
        setRecordExt(actualExt)
        // libera o microfone
        if (audioStreamRef.current) {
          audioStreamRef.current.getTracks().forEach((t) => t.stop())
          audioStreamRef.current = null
        }
      }
      recorderRef.current = recorder
      recorder.start()
      setRecording(true)
    } catch {
      setRecordError('Não foi possível iniciar a gravação. Verifique as permissões de câmera/microfone.')
      setRecording(false)
    }
  }

  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
    recorderRef.current = null
    setRecording(false)
  }

  function downloadRecording() {
    if (!recordedUrl) return
    const a = document.createElement('a')
    a.href = recordedUrl
    a.download = `roteiro-${id ?? 'gravacao'}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${recordExt}`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
  }

  async function startCamera(facing: 'user' | 'environment') {
    setCameraError(null)
    try {
      stopStream()
      // NÃO forçamos aspectRatio/resolução: pedir 9:16 fazia o navegador recortar
      // o centro do sensor (que é ~4:3) e isso aparecia como ZOOM (perda de campo
      // de visão). Usamos o campo de visão natural da câmera; no mobile em retrato
      // o track já sai vertical. Pedimos só uma resolução alta como dica de qualidade.
      const quality = isMobile ? { width: { ideal: 1920 }, height: { ideal: 1920 } } : {}
      const videoConstraints: MediaTrackConstraints = { facingMode: { ideal: facing }, ...quality }
      let stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      }).catch(() =>
        // fallback: alguns navegadores rejeitam constraints estritas
        navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing } }, audio: false })
      ).catch(() =>
        navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      )

      // iOS + câmera traseira: força a câmera principal (1.0x) pelo deviceId,
      // já que facingMode tende a escolher a ultra-wide 0.5x.
      if (isIOS && facing === 'environment') {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices()
          const mainId = pickMainBackCameraId(devices)
          const currentId = stream.getVideoTracks()[0]?.getSettings?.().deviceId
          if (mainId && mainId !== currentId) {
            stream.getTracks().forEach((t) => t.stop())
            stream = await navigator.mediaDevices.getUserMedia({
              video: { deviceId: { exact: mainId } },
              audio: false,
            }).catch(() => navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false }))
          }
        } catch { /* mantém o stream original */ }
      }
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setCameraOn(true)
      setFacingMode(facing)
      // atualiza contagem de câmeras (labels só vêm após permissão)
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        setVideoInputCount(devices.filter((d) => d.kind === 'videoinput').length)
      } catch { /* ignore */ }
    } catch {
      setCameraError('Não foi possível acessar a câmera. Verifique as permissões do navegador.')
      setCameraOn(false)
    }
  }

  async function toggleCamera() {
    if (cameraOn) {
      stopStream()
      setCameraOn(false)
    } else {
      await startCamera(facingMode)
    }
  }

  async function flipCamera() {
    const next = facingMode === 'user' ? 'environment' : 'user'
    await startCamera(next)
  }

  // Para câmera, gravação e microfone ao desmontar
  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try { recorderRef.current.stop() } catch { /* ignore */ }
      }
      cancelAnimationFrame(rafRef.current)
      if (canvasStreamRef.current) {
        canvasStreamRef.current.getTracks().forEach((t) => t.stop())
        canvasStreamRef.current = null
      }
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((t) => t.stop())
        audioStreamRef.current = null
      }
      if (recordedUrlRef.current) {
        URL.revokeObjectURL(recordedUrlRef.current)
        recordedUrlRef.current = null
      }
      stopStream()
    }
  }, [])

  useEffect(() => {
    if (!playing) return
    let cancelled = false
    function tick() {
      if (cancelled || !scrollRef.current) return
      scrollRef.current.scrollTop += speed
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
      if (scrollTop + clientHeight >= scrollHeight) {
        setPlaying(false)
        return
      }
      animRef.current = requestAnimationFrame(tick)
    }
    animRef.current = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      cancelAnimationFrame(animRef.current)
    }
  }, [playing, speed])

  function reset() {
    setPlaying(false)
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.code === 'Space') {
        e.preventDefault()
        setPlaying((p) => !p)
      } else if (e.code === 'ArrowUp') {
        e.preventDefault()
        setSpeed((s) => Math.max(0.5, s - 0.5))
      } else if (e.code === 'ArrowDown') {
        e.preventDefault()
        setSpeed((s) => Math.min(10, s + 0.5))
      } else if (e.code === 'Escape') {
        navigate(`/scripts/${id}`)
      } else if (e.code === 'KeyR') {
        reset()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [id, navigate])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-black">
        <Loader2 className="size-8 animate-spin text-white" />
      </div>
    )
  }

  if (!script) {
    return (
      <div className="flex h-screen items-center justify-center bg-black">
        <p className="text-white">Roteiro não encontrado</p>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Câmera de fundo */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="pointer-events-none absolute inset-0 size-full object-cover transition-opacity duration-300"
        style={{
          opacity: cameraOn ? 1 : 0,
          transform: facingMode === 'user' ? 'scaleX(-1)' : undefined,
        }}
      />
      {/* Overlay escuro pra manter o texto legível sobre o vídeo */}
      {cameraOn && <div className="pointer-events-none absolute inset-0 bg-black/45" />}

      {/* Controls bar */}
      <div className="relative z-10 flex items-center justify-between gap-2 border-b border-white/10 bg-black/40 px-3 py-2 backdrop-blur-sm sm:px-4">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-white hover:bg-white/10"
            onClick={() => setPlaying(!playing)}
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>

          <Button
            variant="ghost"
            size="icon-xs"
            className="text-white hover:bg-white/10"
            onClick={reset}
          >
            <RotateCcw className="size-4" />
          </Button>

          <div className="mx-2 h-4 w-px bg-white/20" />

          <span className="text-xs text-white/60">Velocidade</span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-white hover:bg-white/10"
            onClick={() => setSpeed((s) => Math.max(0.5, s - 0.5))}
          >
            <Minus className="size-3" />
          </Button>
          <span className="min-w-[2rem] text-center text-xs text-white">
            {speed.toFixed(1)}x
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-white hover:bg-white/10"
            onClick={() => setSpeed((s) => Math.min(10, s + 0.5))}
          >
            <Plus className="size-3" />
          </Button>

          <div className="mx-2 h-4 w-px bg-white/20" />

          <span className="text-xs text-white/60">Fonte</span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-white hover:bg-white/10"
            onClick={() => setFontSize((s) => Math.max(16, s - 4))}
          >
            <Minus className="size-3" />
          </Button>
          <span className="min-w-[2rem] text-center text-xs text-white">
            {fontSize}px
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-white hover:bg-white/10"
            onClick={() => setFontSize((s) => Math.min(72, s + 4))}
          >
            <Plus className="size-3" />
          </Button>

          <div className="mx-2 h-4 w-px bg-white/20" />

          {/* Câmera */}
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn('size-9 sm:size-6', 'text-white hover:bg-white/10', cameraOn && 'bg-primary/20 text-primary')}
            onClick={toggleCamera}
            title={cameraOn ? 'Desligar câmera' : 'Ligar câmera'}
          >
            {cameraOn ? <Camera className="size-5 sm:size-4" /> : <CameraOff className="size-5 sm:size-4" />}
          </Button>
          {cameraOn && canFlip && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-9 text-white hover:bg-white/10 sm:size-6"
              onClick={flipCamera}
              title="Alternar câmera (frontal/traseira)"
            >
              <SwitchCamera className="size-5 sm:size-4" />
            </Button>
          )}

          {/* Gravação */}
          {!recording ? (
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-9 text-white hover:bg-white/10 sm:size-6"
              onClick={startRecording}
              title="Gravar vídeo"
            >
              <Circle className="size-5 fill-red-500 text-red-500 sm:size-4" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-9 bg-red-500/20 text-red-400 hover:bg-red-500/30 sm:size-6"
              onClick={stopRecording}
              title="Parar gravação"
            >
              <Square className="size-4 fill-current sm:size-3.5" />
            </Button>
          )}
          {recordedUrl && !recording && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-9 text-accent hover:bg-accent/10 sm:size-6"
              onClick={downloadRecording}
              title="Baixar gravação"
            >
              <Download className="size-5 sm:size-4" />
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-white/40 lg:inline">
            Space: play/pause · Arrows: velocidade · R: reset · Esc: sair
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-white hover:bg-white/10"
            onClick={() => navigate(`/scripts/${id}`)}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* Erros de câmera / gravação */}
      {(cameraError || recordError) && (
        <div className="relative z-10 bg-destructive/20 px-4 py-1.5 text-center text-xs text-destructive-foreground">
          {cameraError ?? recordError}
        </div>
      )}

      {/* Indicador REC */}
      {recording && (
        <div className="pointer-events-none absolute right-4 top-14 z-20 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 backdrop-blur-sm">
          <span className="size-2 animate-pulse rounded-full bg-red-500" />
          <span className="text-xs font-semibold text-white">REC</span>
        </div>
      )}

      {/* Teleprompter text */}
      <div
        ref={scrollRef}
        className="relative z-10 flex-1 overflow-y-auto px-8"
        style={{
          scrollBehavior: playing ? 'auto' : 'smooth',
        }}
      >
        {/* Top padding so text starts in middle of screen */}
        <div className="h-[50vh]" />

        <div className="mx-auto max-w-3xl">
          <pre
            className="whitespace-pre-wrap text-center font-sans leading-relaxed text-white"
            style={{ fontSize: `${fontSize}px`, lineHeight: '1.6' }}
          >
            {script.script_teleprompter}
          </pre>
        </div>

        {/* Bottom padding */}
        <div className="h-[80vh]" />
      </div>

      {/* Center line indicator */}
      <div className="pointer-events-none fixed inset-x-0 top-1/2 z-20 -translate-y-1/2">
        <div className="mx-auto h-px w-3/4 bg-primary/50" />
      </div>
    </div>
  )
}

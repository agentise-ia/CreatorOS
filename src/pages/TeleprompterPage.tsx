import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { X, Play, Pause, Minus, Plus, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useScript } from '@/hooks/useScripts'
import { Loader2 } from 'lucide-react'

export default function TeleprompterPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { script, loading } = useScript(id)

  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(2) // pixels per frame
  const [fontSize, setFontSize] = useState(32)
  const scrollRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<number>(0)

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
      {/* Controls bar */}
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2 sm:px-4">
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

      {/* Teleprompter text */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-8"
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

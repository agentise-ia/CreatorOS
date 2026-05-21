import { useRef, useState, useEffect, useCallback } from 'react'
import { Play, Pause, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDuration } from '@/lib/utils'

interface VideoPlayerProps {
  src: string | null
  thumbnail?: string | null
  onTimeUpdate?: (time: number) => void
  seekTo?: number
}

export function VideoPlayer({ src, thumbnail, onTimeUpdate, seekTo }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      const time = videoRef.current.currentTime
      setCurrentTime(time)
      onTimeUpdate?.(time)
    }
  }, [onTimeUpdate])

  useEffect(() => {
    if (seekTo !== undefined && videoRef.current) {
      videoRef.current.currentTime = seekTo
    }
  }, [seekTo])

  function togglePlay() {
    if (!videoRef.current) return
    if (playing) {
      videoRef.current.pause()
    } else {
      videoRef.current.play()
    }
    setPlaying(!playing)
  }

  function handleProgressClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!videoRef.current || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const pct = x / rect.width
    videoRef.current.currentTime = pct * duration
  }

  if (!src) {
    return (
      <div className="flex aspect-[9/16] max-h-[500px] items-center justify-center rounded-xl bg-[rgba(59,130,246,0.06)] border border-[rgba(59,130,246,0.12)]">
        {thumbnail ? (
          <img src={thumbnail} alt="" className="size-full rounded-lg object-cover" />
        ) : (
          <p className="text-xs text-muted-foreground">Vídeo não disponível</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="relative aspect-[9/16] max-h-[500px] overflow-hidden rounded-lg bg-black">
        <video
          ref={videoRef}
          src={src}
          poster={thumbnail ?? undefined}
          className="size-full object-contain"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={() => {
            if (videoRef.current) setDuration(videoRef.current.duration)
          }}
          onEnded={() => setPlaying(false)}
          muted={muted}
          playsInline
        />
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-xs" onClick={togglePlay}>
          {playing ? <Pause className="size-3" /> : <Play className="size-3" />}
        </Button>

        <div
          className="relative h-1.5 flex-1 cursor-pointer rounded-full bg-[rgba(59,130,246,0.12)]"
          onClick={handleProgressClick}
        >
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-primary transition-all"
            style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }}
          />
        </div>

        <span className="text-[10px] font-mono text-muted-foreground">
          {formatDuration(currentTime)} / {formatDuration(duration)}
        </span>

        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setMuted(!muted)}
        >
          {muted ? <VolumeX className="size-3" /> : <Volume2 className="size-3" />}
        </Button>
      </div>
    </div>
  )
}

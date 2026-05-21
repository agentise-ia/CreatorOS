import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) {
    const value = n / 1_000_000;
    return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const value = n / 1_000;
    return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)}K`;
  }
  return String(n);
}

export function formatEngagement(reel: {
  likes_count: number;
  comments_count: number;
  shares_count: number;
  views_count: number;
}): string {
  const total =
    reel.likes_count + reel.comments_count + reel.shares_count + reel.views_count;
  return formatNumber(total);
}

export function formatDate(date: string): string {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffSeconds < 60) return 'agora mesmo';
  if (diffMinutes < 60) {
    return diffMinutes === 1 ? '1 minuto atras' : `${diffMinutes} minutos atras`;
  }
  if (diffHours < 24) {
    return diffHours === 1 ? '1 hora atras' : `${diffHours} horas atras`;
  }
  if (diffDays < 30) {
    return diffDays === 1 ? '1 dia atras' : `${diffDays} dias atras`;
  }
  if (diffMonths < 12) {
    return diffMonths === 1 ? '1 mes atras' : `${diffMonths} meses atras`;
  }
  return diffYears === 1 ? '1 ano atras' : `${diffYears} anos atras`;
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

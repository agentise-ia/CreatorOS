import { LogOut, Loader2, Menu } from 'lucide-react'
import supabase from '@/lib/supabase'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

interface HeaderProps {
  title: string
  onMenuClick?: () => void
}

export function Header({ title, onMenuClick }: HeaderProps) {
  const user = useAppStore((s) => s.user)
  const activeJobs = useAppStore((s) => s.activeJobs)
  const activeCount = activeJobs.filter(
    (j) => j.status === 'pending' || j.status === 'processing'
  ).length

  const initials = user?.email
    ? user.email.slice(0, 2).toUpperCase()
    : '??'

  async function handleLogout() {
    await supabase.auth.signOut()
  }

  return (
    <header className="flex h-16 items-center justify-between glass-header px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onMenuClick}
          aria-label="Abrir menu"
          className="size-8 shrink-0 text-muted-foreground hover:text-[#60A5FA] hover:bg-[rgba(59,130,246,0.08)] lg:hidden"
        >
          <Menu className="size-5" />
        </Button>
        <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">{title}</h1>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        {/* Processing jobs indicator */}
        {activeCount > 0 && (
          <div className="flex items-center gap-2 rounded-full bg-[rgba(59,130,246,0.1)] border border-[rgba(59,130,246,0.2)] px-3 py-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span className="text-xs text-[#60A5FA]">
              {activeCount} processando
            </span>
          </div>
        )}

        {/* User info */}
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-[rgba(59,130,246,0.15)] text-xs text-primary border border-[rgba(59,130,246,0.2)]">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-sm text-muted-foreground md:inline">
            {user?.email}
          </span>
        </div>

        {/* Logout */}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleLogout}
          className="h-8 w-8 text-muted-foreground hover:text-[#60A5FA] hover:bg-[rgba(59,130,246,0.08)]"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  )
}

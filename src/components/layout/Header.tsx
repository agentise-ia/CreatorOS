import { LogOut, Loader2 } from 'lucide-react'
import supabase from '@/lib/supabase'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

interface HeaderProps {
  title: string
}

export function Header({ title }: HeaderProps) {
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
    <header className="flex h-16 items-center justify-between glass-header px-6">
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>

      <div className="flex items-center gap-4">
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

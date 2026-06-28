import { NavLink } from 'react-router-dom'
import {
  Play,
  LayoutDashboard,
  Users,
  Mic,
  FileText,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { APP_NAME } from '@/lib/brand'
import { useAppStore } from '@/store'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

const navItems = [
  { to: '/' as const, icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/voice-profile' as const, icon: Mic, label: 'Estilo de Fala', end: false },
  { to: '/profiles' as const, icon: Users, label: 'Perfis', end: false },
  { to: '/scripts' as const, icon: FileText, label: 'Roteiros', end: false },
  { to: '/settings' as const, icon: Settings, label: 'Configurações', end: false },
]

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  mobileOpen?: boolean
  onMobileClose?: () => void
}

export function Sidebar({ collapsed, onToggle, mobileOpen = false, onMobileClose }: SidebarProps) {
  const activeJobs = useAppStore((s) => s.activeJobs)
  const activeCount = activeJobs.filter(
    (j) => j.status === 'pending' || j.status === 'processing'
  ).length

  const isDesktop = useMediaQuery('(min-width: 1024px)')
  // O "collapsed" (modo ícones) só vale no desktop. No mobile o drawer é sempre completo.
  const effectiveCollapsed = isDesktop && collapsed

  return (
    <>
      {/* Backdrop do drawer mobile */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={cn(
          'fixed left-0 top-0 z-50 flex h-screen flex-col glass-sidebar transition-all duration-200',
          effectiveCollapsed ? 'w-16' : 'w-60',
          // Drawer no mobile: escondido fora da tela quando fechado
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:translate-x-0'
        )}
      >
      {/* Brand */}
      <div className="flex h-16 items-center gap-2 border-b border-[rgba(59,130,246,0.1)] px-4">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#2563EB] to-[#3B82F6] shadow-[0_0_12px_rgba(59,130,246,0.4)]">
          <Play className="size-4 text-white" fill="currentColor" strokeWidth={0} />
        </div>
        {!effectiveCollapsed && (
          <span className="truncate text-sm font-bold tracking-tight text-foreground">
            {APP_NAME}
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-4">
        {navItems.map((item) => {
          const Icon = item.icon
          const link = (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-300',
                  isActive
                    ? 'btn-gradient shadow-[0_0_15px_rgba(59,130,246,0.2)]'
                    : 'text-muted-foreground hover:bg-[rgba(59,130,246,0.08)] hover:text-foreground'
                )
              }
            >
              <Icon className="h-5 w-5 shrink-0" />
              {!effectiveCollapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          )

          if (effectiveCollapsed) {
            return (
              <Tooltip key={item.to}>
                <TooltipTrigger>{link}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            )
          }

          return link
        })}
      </nav>

      {/* Active jobs indicator */}
      {activeCount > 0 && (
        <div
          className={cn(
            'mx-2 mb-2 flex items-center gap-2 rounded-xl bg-[rgba(59,130,246,0.1)] border border-[rgba(59,130,246,0.2)] px-3 py-2',
            effectiveCollapsed && 'justify-center px-0'
          )}
        >
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
          {!effectiveCollapsed && (
            <span className="text-xs text-[#60A5FA]">
              {activeCount} {activeCount > 1 ? 'ações ativas' : 'ação ativa'}
            </span>
          )}
        </div>
      )}

      {/* Toggle button (somente desktop) */}
      <button
        onClick={onToggle}
        className="hidden h-12 items-center justify-center border-t border-[rgba(59,130,246,0.1)] text-muted-foreground transition-colors hover:text-[#60A5FA] lg:flex"
      >
        {effectiveCollapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronLeft className="h-4 w-4" />
        )}
      </button>
    </aside>
    </>
  )
}

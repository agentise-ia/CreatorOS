import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { AuthProvider } from '@/components/auth/AuthProvider'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { LoginPage } from '@/components/auth/LoginPage'
import { MainLayout } from '@/components/layout/MainLayout'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import { TooltipProvider } from '@/components/ui/tooltip'
import { isInitialized } from '@/lib/supabase'
import DashboardPage from '@/pages/DashboardPage'
import ProfilesPage from '@/pages/ProfilesPage'
import ProfileReelsPage from '@/pages/ProfileReelsPage'
import ReelAnalysisPage from '@/pages/ReelAnalysisPage'
import VoiceProfilePage from '@/pages/VoiceProfilePage'
import ScriptsPage from '@/pages/ScriptsPage'
import NewScriptPage from '@/pages/NewScriptPage'
import ScriptDetailPage from '@/pages/ScriptDetailPage'
import TeleprompterPage from '@/pages/TeleprompterPage'
import SettingsPage from '@/pages/SettingsPage'
import TeamPage from '@/pages/TeamPage'
import InvitePage from '@/pages/InvitePage'
import SetupWizardPage from '@/pages/setup/SetupWizardPage'

function UninitializedRedirect() {
  const location = useLocation()
  useEffect(() => {
    if (!isInitialized && location.pathname !== '/setup') {
      window.location.replace('/setup')
    }
  }, [location.pathname])
  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <UninitializedRedirect />
      {isInitialized ? (
        <AuthProvider>
          <TooltipProvider>
            <AppRoutes />
          </TooltipProvider>
        </AuthProvider>
      ) : (
        <Routes>
          <Route path="/setup" element={<ErrorBoundary><SetupWizardPage /></ErrorBoundary>} />
          <Route path="*" element={<Navigate to="/setup" replace />} />
        </Routes>
      )}
    </BrowserRouter>
  )
}

function AppRoutes() {
  return (
    <Routes>
      {/* Setup (acessível mesmo após init, para refazer se necessário) */}
      <Route path="/setup" element={<ErrorBoundary><SetupWizardPage /></ErrorBoundary>} />

      {/* Public */}
      <Route
        path="/login"
        element={
          <ErrorBoundary>
            <LoginPage />
          </ErrorBoundary>
        }
      />
      <Route
        path="/invite"
        element={
          <ErrorBoundary>
            <InvitePage />
          </ErrorBoundary>
        }
      />

      {/* Teleprompter fullscreen (outside MainLayout) */}
      <Route
        path="/scripts/:id/teleprompter"
        element={
          <AuthGuard>
            <ErrorBoundary>
              <TeleprompterPage />
            </ErrorBoundary>
          </AuthGuard>
        }
      />

      {/* Authenticated with layout */}
      <Route
        path="/"
        element={
          <AuthGuard>
            <MainLayout />
          </AuthGuard>
        }
      >
        <Route
          index
          element={
            <ErrorBoundary>
              <DashboardPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="profiles"
          element={
            <ErrorBoundary>
              <ProfilesPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="profiles/:id/reels"
          element={
            <ErrorBoundary>
              <ProfileReelsPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="analysis/:reelId"
          element={
            <ErrorBoundary>
              <ReelAnalysisPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="voice-profile"
          element={
            <ErrorBoundary>
              <VoiceProfilePage />
            </ErrorBoundary>
          }
        />
        <Route
          path="scripts"
          element={
            <ErrorBoundary>
              <ScriptsPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="scripts/new"
          element={
            <ErrorBoundary>
              <NewScriptPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="scripts/:id"
          element={
            <ErrorBoundary>
              <ScriptDetailPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="settings"
          element={
            <ErrorBoundary>
              <SettingsPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="team"
          element={
            <ErrorBoundary>
              <TeamPage />
            </ErrorBoundary>
          }
        />
      </Route>
    </Routes>
  )
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { APP_NAME } from '@/lib/brand'

// Estado "uninitialized" é tratado dentro do <App /> — o wizard /setup
// roda mesmo sem VITE_SUPABASE_URL. Não derrubamos a aplicação aqui.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

document.title = APP_NAME

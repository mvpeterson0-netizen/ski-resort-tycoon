import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Nunito, bundled (SIL Open Font License per npm metadata) so every device renders the same.
// Only 400 and 800 are loaded: semi-bold text (600/700) renders in 800, as in the approved preview.
import '@fontsource/nunito/400.css'
import '@fontsource/nunito/800.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

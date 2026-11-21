import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Nunito, bundled (SIL Open Font License per npm metadata) so every device renders the same.
// Only 400 and 800 are loaded: semi-bold text (600/700) renders in 800, as in the approved preview.
import '@fontsource/nunito/400.css'
import '@fontsource/nunito/800.css'
import './index.css'
import App from './App.tsx'
import { VillagePreview } from './ui/village/VillagePreview'

// PREVIEW (owner review): ?preview=village shows the proposed home view. Not linked from the game.
const preview = new URLSearchParams(window.location.search).get('preview')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {preview === 'village' ? <VillagePreview /> : <App />}
  </StrictMode>,
)

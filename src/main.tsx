import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Bundled open-source fonts (OFL / Apache-2.0) for the style previews. Unused ones are
// removed once a style is chosen.
import '@fontsource/inter/400.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
import '@fontsource/bebas-neue/400.css'
import '@fontsource/nunito/400.css'
import '@fontsource/nunito/800.css'
import '@fontsource/roboto-slab/400.css'
import '@fontsource/roboto-slab/700.css'
import '@fontsource/press-start-2p/400.css'
import './index.css'
import './themes.css'
import App from './App.tsx'

// STYLE PREVIEW: ?theme=night|poster|swiss|lodge|arcade|glacier (default: Trail Map).
const theme = new URLSearchParams(window.location.search).get('theme')
if (theme) document.documentElement.dataset.theme = theme

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

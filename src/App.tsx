import { useEffect } from 'react'
import { SIM_VERSION } from './sim'
import { MountainArt } from './ui/MountainArt'

const STYLES = ['trailmap', 'night', 'clean'] as const
type StyleName = (typeof STYLES)[number]

function readStyle(): StyleName {
  const s = new URLSearchParams(window.location.search).get('style')
  return (STYLES as readonly string[]).includes(s ?? '') ? (s as StyleName) : 'trailmap'
}

export default function App() {
  const style = readStyle()
  useEffect(() => {
    document.documentElement.dataset.style = style
  }, [style])
  return (
    <main className="screen">
      <section className="hero">
        <MountainArt />
        <h1>Ski Resort Tycoon</h1>
        <p className="tagline">
          Pick a real mountain. Buy the land. Build the lifts. Survive the warm years.
        </p>
        <div className="legend">
          <span><i className="dot g" /> Easier</span>
          <span><i className="dot b" /> More difficult</span>
          <span><i className="dot k" /> Most difficult</span>
        </div>
      </section>
      <nav className="actions">
        <button className="btn primary" disabled>New game (coming in step 2)</button>
        <button className="btn" disabled>Continue</button>
      </nav>
      <p className="foot">Prototype · sim v{SIM_VERSION} · style: {style}</p>
    </main>
  )
}

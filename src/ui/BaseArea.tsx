import { useState } from 'react'
import {
  AMENITIES, SNOWMAKING, amenityEffects, buyAmenity, buySnowmaking, maxSnowmakingKm, nextAmenityCost, siteById,
  type AmenityId, type GameState,
} from '../sim'
import { usd } from './format'
import { effectLine } from './amenityText'

const ORDER: AmenityId[] = ['parking', 'lodge', 'rentals', 'school', 'housing']

export function BaseAreaScreen({ game, onChange, onBack }: { game: GameState; onChange: (g: GameState) => void; onBack: () => void }) {
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const offseason = game.phase === 'offseason'
  const fx = amenityEffects(game.amenities, game.trails.some((t) => t.difficulty === 'green'))

  return (
    <main className="screen">
      <h2 className="screen-title">Base area</h2>
      <div className="content">
        <p className="tagline">Cash {usd(game.cashUsd)} · appeal +{Math.round((fx.appealMult - 1) * 100)}% · running costs {usd(fx.dailyCostUsd)}/day</p>
        <h3 className="group">On the mountain</h3>
        <Snowmaking game={game} onChange={onChange} setMessage={setMessage} />
        <h3 className="group">Base area</h3>
        <ul className="cards">
          {ORDER.map((id) => {
            const spec = AMENITIES[id]
            const level = game.amenities[id]
            const cost = nextAmenityCost(game.amenities, id)
            const nextDaily = cost !== null ? spec.levels[level].dailyCostUsd : 0
            return (
              <li key={id} className="card static">
                <span className="card-title">{spec.name}</span>
                <span className="badge">{level === 0 ? 'Basic' : `Level ${level} of ${spec.levels.length}`}</span>
                <span className="card-sub">{spec.blurb}</span>
                <span className="card-sub"><b>Now:</b> {effectLine(id, level)}</span>
                {cost !== null ? (
                  <>
                    <span className="card-sub"><b>Next:</b> {effectLine(id, level + 1)} · {usd(nextDaily)}/day to run</span>
                    <button
                      className="btn primary"
                      disabled={!offseason || cost > game.cashUsd}
                      onClick={() => {
                        const r = buyAmenity(game, id)
                        if (r.ok) { onChange(r.game); setMessage({ text: `Built ${spec.name.toLowerCase()} level ${level + 1}`, ok: true }) }
                        else setMessage({ text: r.reason, ok: false })
                      }}
                    >
                      {level === 0 ? 'Build' : 'Upgrade'} · {usd(cost)}
                    </button>
                  </>
                ) : (
                  <span className="card-sub ok">Fully built</span>
                )}
              </li>
            )
          })}
        </ul>
        {!offseason && <p className="hint center">Construction happens in the off-season.</p>}
        {message && <p className={message.ok ? 'ok' : 'warn'}>{message.text}</p>}
        <p className="foot">All costs and effects are placeholders.</p>
      </div>
      <nav className="actions"><button className="btn primary" onClick={onBack}>Done</button></nav>
    </main>
  )
}

const WATER_LABEL = { poor: 'Poor', fair: 'Fair', good: 'Good' } as const

function Snowmaking({ game, onChange, setMessage }: {
  game: GameState; onChange: (g: GameState) => void; setMessage: (m: { text: string; ok: boolean }) => void
}) {
  const site = siteById(game.siteId)!
  const water = site.traits.waterRights
  const trailKm = game.trails.reduce((s, t) => s + t.lengthM, 0) / 1000
  const maxKm = maxSnowmakingKm(trailKm, water)
  const room = Math.round((maxKm - game.snowmakingKm) * 10) / 10
  const step = Math.min(1, room)
  const coverage = trailKm > 0 ? game.snowmakingKm / trailKm : 0
  const offseason = game.phase === 'offseason'
  return (
    <div className="card static">
      <span className="card-title">Snowmaking</span>
      <span className="badge">{Math.round(coverage * 100)}% of trails</span>
      <span className="card-sub">
        Opens your season sooner in poor snow years and keeps covered runs at a {SNOWMAKING.madeBaseIn}" base. Costs energy and water on days it runs, plus a snowmaking crew.
      </span>
      <div className="credit-bar" role="img" aria-label={`${game.snowmakingKm} of ${maxKm} km`}>
        <i style={{ width: `${maxKm > 0 ? Math.min(100, (game.snowmakingKm / maxKm) * 100) : 0}%` }} />
      </div>
      <span className="card-sub">
        <b>{game.snowmakingKm} km</b> covered of {maxKm} km allowed · water rights: {WATER_LABEL[water]}
        {site.unverified?.includes('waterRights') ? ' (est.)' : ''}
      </span>
      {step > 0 ? (
        <button
          className="btn primary"
          disabled={!offseason || step * SNOWMAKING.installPerKmUsd > game.cashUsd}
          onClick={() => {
            const r = buySnowmaking(game, site, step)
            if (r.ok) { onChange(r.game); setMessage({ text: `Added ${step} km of snowmaking`, ok: true }) }
            else setMessage({ text: r.reason, ok: false })
          }}
        >
          Add {step} km · ${Math.round(step * SNOWMAKING.installPerKmUsd / 1000)}k
        </button>
      ) : (
        <span className="card-sub">{trailKm > 0 ? 'At your water-rights limit. Build more trails to cover more.' : 'Build trails first.'}</span>
      )}
    </div>
  )
}

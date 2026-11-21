import { useState } from 'react'
import {
  AMENITIES, AMENITY_TUNING, amenityEffects, buyAmenity, nextAmenityCost,
  type AmenityId, type GameState,
} from '../sim'
import { usd } from './format'

const ORDER: AmenityId[] = ['parking', 'lodge', 'rentals', 'school', 'housing']

/** What the current level of each amenity does, in plain words. */
function effectLine(id: AmenityId, level: number): string {
  const T = AMENITY_TUNING
  switch (id) {
    case 'parking': {
      const spaces = T.baseSpaces + level * T.spacesPerLevel
      return `${spaces.toLocaleString()} spaces · up to ${Math.round(spaces * T.guestsPerSpace).toLocaleString()} guests a day`
    }
    case 'lodge':
      return level === 0 ? 'Snack bar only' : `Food spend ×${T.lodgeFoodMult[level]} · appeal +${Math.round(level * T.lodgeAppealPerLevel * 100)}%`
    case 'rentals':
      return level === 0 ? 'Not built' : `+$${T.rentalSpendPerDayGuestUsd} per day-ticket guest · appeal +${Math.round(T.rentalsAppeal * 100)}%`
    case 'school':
      return level === 0 ? 'Not built' : `+$${T.lessonSpendPerDayGuestUsd} per day-ticket guest · families +${Math.round(T.schoolAppeal * 100)}%`
    case 'housing':
      return level === 0 ? 'No beds: local hires only' : `${level * T.bedsPerHousingLevel} beds for staff`
  }
}

export function BaseAreaScreen({ game, onChange, onBack }: { game: GameState; onChange: (g: GameState) => void; onBack: () => void }) {
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const offseason = game.phase === 'offseason'
  const fx = amenityEffects(game.amenities, game.trails.some((t) => t.difficulty === 'green'))

  return (
    <main className="screen">
      <h2 className="screen-title">Base area</h2>
      <div className="content">
        <p className="tagline">Cash {usd(game.cashUsd)} · appeal +{Math.round((fx.appealMult - 1) * 100)}% · running costs {usd(fx.dailyCostUsd)}/day</p>
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

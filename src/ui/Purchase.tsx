import { useState } from 'react'
import {
  ECON, annualDebtService, landPrice, planPurchase, siteById, totalDebt,
  type GameState, type Region, type Site,
} from '../sim'
import { usd } from './format'

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

export function PurchaseScreen({ site, region, onBuy, onBack }: {
  site: Site; region: Region; onBuy: (plan: ReturnType<typeof planPurchase>) => void; onBack: () => void
}) {
  const price = landPrice(site, region)
  const { minDownPct, ratePct, termYears } = ECON.landLoan
  const [downPct, setDownPct] = useState(40)
  const plan = planPurchase(price.totalUsd, downPct)

  return (
    <main className="screen">
      <h2 className="screen-title">Buy {site.name}</h2>
      <div className="content">
        <p className="note">All prices, rates and your starting cash are placeholder values for now.</p>

        <h3 className="group">Asking price</h3>
        <dl className="traits">
          <div className="trait">
            <dt>Base: {site.traits.acres.toLocaleString()} acres × {money(region.baseLandUsdPerAcre)}/acre</dt>
            <dd>{usd(price.baseUsd)}</dd>
          </div>
          {price.factors.map((f) => (
            <div key={f.label} className="trait">
              <dt>{f.label}<small>{f.reason}</small></dt>
              <dd className={f.factor > 1.005 ? 'up' : f.factor < 0.995 ? 'down' : ''}>×{f.factor.toFixed(2)}</dd>
            </div>
          ))}
          <div className="trait total">
            <dt>Asking price</dt>
            <dd>{money(price.totalUsd)}</dd>
          </div>
        </dl>

        <h3 className="group">Financing</h3>
        <div className="panel">
          <label className="slider-label" htmlFor="down">
            Down payment <b>{plan.downPct}%</b> · {usd(plan.downUsd)}
          </label>
          <input
            id="down" type="range" className="slider"
            min={minDownPct} max={100} step={5} value={plan.downPct}
            onChange={(e) => setDownPct(Number(e.target.value))}
          />
          <div className="slider-ends"><span>{minDownPct}% (lender minimum)</span><span>100% cash</span></div>
        </div>
        <dl className="traits">
          <div className="trait"><dt>Starting cash</dt><dd>{money(ECON.startingCashUsd)}</dd></div>
          <div className="trait"><dt>Land mortgage</dt><dd>{money(plan.loanUsd)}<small>{ratePct}% over {termYears} years</small></dd></div>
          <div className="trait"><dt>Yearly mortgage payment</dt><dd>{money(plan.annualPaymentUsd)}</dd></div>
          <div className="trait total">
            <dt>Cash left to build with</dt>
            <dd className={plan.cashAfterUsd < 0 ? 'down' : ''}>{money(plan.cashAfterUsd)}</dd>
          </div>
        </dl>
        {plan.problem && <p className="note">{plan.problem}</p>}
      </div>
      <nav className="actions">
        <button className="btn primary" disabled={!!plan.problem} onClick={() => onBuy(plan)}>
          Buy for {usd(plan.priceUsd)}
        </button>
        <button className="btn" onClick={onBack}>Back</button>
      </nav>
    </main>
  )
}

/** Resort home: the hub screen once the player owns land. Grows in later steps. */
export function ResortHome({ game, onMap, onQuit }: { game: GameState; onMap: () => void; onQuit: () => void }) {
  const site = siteById(game.siteId)
  return (
    <main className="screen">
      <h2 className="screen-title">{site?.name ?? game.siteId}</h2>
      <div className="content">
        <p className="tagline">Year {game.year} · Off-season</p>
        <div className="kpis">
          <div><span>Cash</span><b>{usd(game.cashUsd)}</b></div>
          <div><span>Debt</span><b>{usd(totalDebt(game))}</b></div>
          <div><span>Debt payments / yr</span><b>{usd(annualDebtService(game))}</b></div>
          <div><span>Land paid</span><b>{usd(game.landPaidUsd)}</b></div>
        </div>
        <p className="note">Next up (step 5): draw trails and place a lift on the map.</p>
      </div>
      <nav className="actions">
        {site?.terrainId && <button className="btn primary" onClick={onMap}>Open mountain map</button>}
        <button className="btn" onClick={onQuit}>Main menu</button>
      </nav>
    </main>
  )
}

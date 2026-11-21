import { useState } from 'react'
import {
  ECON, VILLAGE, annualDebtService, estimatePassSales, landPrice, seasonBlocker, seasonInputs, parcelLabel, planPurchase, setPassPrice,
  setTicketPrice, siteById, siteForParcel, totalDebt, villagePackageUsd,
  type BasePlacement, type GameState, type Parcel, type Region, type Site, type VillagePurchase,
} from '../sim'
import { usd } from './format'

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

export function PurchaseScreen({ site, region, parcel, base, onBuy, onBack }: {
  site: Site; region: Region; parcel?: Parcel; base?: BasePlacement
  onBuy: (plan: ReturnType<typeof planPurchase>, village: VillagePurchase) => void; onBack: () => void
}) {
  const priced = parcel ? siteForParcel(site, parcel) : site
  const price = landPrice(priced, region)
  const { minDownPct, ratePct, termYears } = ECON.landLoan
  const [downPct, setDownPct] = useState(40)
  // The starter base village comes on top of the land and is financed with it.
  const roadM = base?.roadM ?? 0
  const villageUsd = villagePackageUsd(roadM)
  const plan = planPurchase(price.totalUsd + villageUsd, downPct)

  return (
    <main className="screen">
      <h2 className="screen-title">Buy {parcel ? `${parcelLabel(parcel)}, ${site.name}` : site.name}</h2>
      <div className="content">
        <p className="note">
          All prices, rates and your starting cash are placeholder values for now.
          {parcel && ' Vertical and aspect are measured for this parcel from USGS elevation data.'}
        </p>

        <h3 className="group">Asking price</h3>
        <dl className="traits">
          <div className="trait">
            <dt>Base: {priced.traits.acres.toLocaleString()} acres × {money(region.baseLandUsdPerAcre * ECON.landPriceScale)}/acre</dt>
            <dd>{usd(price.baseUsd)}</dd>
          </div>
          {price.factors.map((f) => (
            <div key={f.label} className="trait">
              <dt>{f.label}<small>{f.reason}</small></dt>
              <dd className={f.factor > 1.005 ? 'up' : f.factor < 0.995 ? 'down' : ''}>×{f.factor.toFixed(2)}</dd>
            </div>
          ))}
          <div className="trait total">
            <dt>Land price</dt>
            <dd>{money(price.totalUsd)}</dd>
          </div>
        </dl>

        <h3 className="group">Starter base village</h3>
        <dl className="traits">
          <div className="trait">
            <dt>Village package<small>Warming hut, ticket booth, maintenance garage, gravel lot</small></dt>
            <dd>{money(VILLAGE.packageUsd)}</dd>
          </div>
          {roadM > 0 && (
            <div className="trait"><dt>Access road<small>{roadM} m from the public road</small></dt><dd>{money(villageUsd - VILLAGE.packageUsd)}</dd></div>
          )}
          <div className="trait total"><dt>Land + village</dt><dd>{money(plan.priceUsd)}</dd></div>
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
          <div className="trait"><dt>Mortgage (land + village)</dt><dd>{money(plan.loanUsd)}<small>{ratePct}% over {termYears} years</small></dd></div>
          <div className="trait"><dt>Yearly mortgage payment</dt><dd>{money(plan.annualPaymentUsd)}</dd></div>
          <div className="trait total">
            <dt>Cash left to build with</dt>
            <dd className={plan.cashAfterUsd < 0 ? 'down' : ''}>{money(plan.cashAfterUsd)}</dd>
          </div>
        </dl>
        {plan.problem && <p className="note">{plan.problem}</p>}
      </div>
      <nav className="actions">
        <button className="btn primary" disabled={!!plan.problem} onClick={() => onBuy(plan, { base: base ?? null, costUsd: villageUsd })}>
          Buy for {usd(plan.priceUsd)}
        </button>
        <button className="btn" onClick={onBack}>Back</button>
      </nav>
    </main>
  )
}

/** Resort home: the hub screen once the player owns land. Grows in later steps. */
export function ResortHome({ game, onChange, onMap, onBuild, onSeason, onSettings, onFinance, onBase, onStaff, onQuit }: {
  game: GameState; onChange: (g: GameState) => void; onMap: () => void; onBuild: () => void; onSeason: () => void
  onSettings: () => void; onFinance: () => void; onBase: () => void; onStaff: () => void; onQuit: () => void
}) {
  const inSeason = game.phase === 'season'
  const blocker = seasonBlocker(game)
  const site = siteById(game.siteId)
  const liftCap = game.lifts.reduce((s, l) => s + l.capacityPph, 0)
  const count = (d: string) => game.trails.filter((t) => t.difficulty === d).length
  return (
    <main className="screen">
      <h2 className="screen-title">{site?.name ?? game.siteId}</h2>
      <div className="content">
        <p className="tagline">Year {game.year} · {inSeason ? `Winter season, day ${game.season?.day ?? 0}` : 'Off-season'}</p>
        <div className="kpis">
          <div><span>Cash</span><b>{usd(game.cashUsd)}</b></div>
          <div><span>Debt</span><b>{usd(totalDebt(game))}</b></div>
          <div><span>Debt payments / yr</span><b>{usd(annualDebtService(game))}</b></div>
          <div><span>Reputation</span><b>{Math.round(game.reputation * 100)}%</b></div>
        </div>
        {!inSeason && site && !blocker && (
          <PricingPanel game={game} onChange={onChange} estimate={estimatePassSales(game.year, seasonInputs(game, site), game.passPriceUsd, game.ticketPriceUsd)} />
        )}
        <h3 className="group">Mountain</h3>
        <dl className="traits">
          <div className="trait">
            <dt>Trails</dt>
            <dd>
              {game.trails.length}
              {game.trails.length > 0 && (
                <small>
                  <i className="dot g" /> {count('green')} &nbsp;<i className="dot b" /> {count('blue')} &nbsp;<i className="dot k" /> {count('black')}
                </small>
              )}
            </dd>
          </div>
          <div className="trait"><dt>Lifts</dt><dd>{game.lifts.length}{liftCap > 0 && <small>{liftCap.toLocaleString()} riders/hr</small>}</dd></div>
        </dl>
        {game.trails.length === 0 && game.lifts.length === 0 && (
          <p className="note">Start by drawing a trail and placing a lift on your land.</p>
        )}
        {game.lastSeason && !inSeason && (
          <>
            <h3 className="group">Last season (year {game.lastSeason.year})</h3>
            <dl className="traits">
              <div className="trait"><dt>Days open</dt><dd>{game.lastSeason.openDays} of {game.lastSeason.days}</dd></div>
              <div className="trait"><dt>Skier visits</dt><dd>{game.lastSeason.guests.toLocaleString()}</dd></div>
              <div className="trait"><dt>Operating profit</dt><dd>{usd(game.lastSeason.netUsd)}</dd></div>
            </dl>
          </>
        )}
        <div className="row small more">
          {site?.terrainId && <button className="btn" onClick={onMap}>Land</button>}
          <button className="btn" onClick={onSettings}>Settings</button>
          <button className="btn" onClick={onQuit}>Menu</button>
        </div>
      </div>
      <nav className="actions">
        {inSeason ? (
          <button className="btn primary" onClick={onSeason}>Continue the season</button>
        ) : (
          !blocker && <button className="btn primary" onClick={onSeason}>Start winter season</button>
        )}
        {blocker && !inSeason && <p className="hint center">To open for winter: {blocker.toLowerCase()}.</p>}
        <div className="row small">
          {!inSeason && site?.terrainId && (
            <button className={blocker ? 'btn primary' : 'btn'} onClick={onBuild}>Build</button>
          )}
          {!inSeason && <button className="btn" onClick={onBase}>Base</button>}
          <button className="btn" onClick={onStaff}>Staff</button>
          <button className="btn" onClick={onFinance}>Finance</button>
        </div>
      </nav>
    </main>
  )
}

/** Prices tab: day ticket (any time) and season pass (off-season), plus last season. */
export function PricesScreen({ game, onChange, onBack }: { game: GameState; onChange: (g: GameState) => void; onBack: () => void }) {
  const site = siteById(game.siteId)
  const inSeason = game.phase === 'season'
  return (
    <main className="screen">
      <h2 className="screen-title">Prices</h2>
      <div className="content">
        {site && (
          <PricingPanel
            game={game} onChange={onChange} inSeason={inSeason}
            estimate={inSeason ? null : estimatePassSales(game.year, seasonInputs(game, site), game.passPriceUsd, game.ticketPriceUsd)}
          />
        )}
        {game.lastSeason && (
          <>
            <h3 className="group">Last season (year {game.lastSeason.year})</h3>
            <dl className="traits">
              <div className="trait"><dt>Days open</dt><dd>{game.lastSeason.openDays} of {game.lastSeason.days}</dd></div>
              <div className="trait"><dt>Skier visits</dt><dd>{game.lastSeason.guests.toLocaleString()}</dd></div>
              <div className="trait"><dt>Passes sold</dt><dd>{game.lastSeason.passesSold.toLocaleString()}</dd></div>
              <div className="trait"><dt>Operating profit</dt><dd>{usd(game.lastSeason.netUsd)}</dd></div>
            </dl>
          </>
        )}
      </div>
      <nav className="actions"><button className="btn" onClick={onBack}>Back to resort</button></nav>
    </main>
  )
}

/** Day ticket and season pass prices, with a live pass-sales estimate in the off-season. */
function PricingPanel({ game, onChange, estimate, inSeason = false }: {
  game: GameState; onChange: (g: GameState) => void; estimate: { passesSold: number; revenueUsd: number } | null; inSeason?: boolean
}) {
  const stepper = (label: string, value: number, step: number, set: (v: number) => void, hint: string) => (
    <div className="panel price">
      <span>{label}<small className="block">{hint}</small></span>
      <button className="btn" aria-label={`Lower ${label}`} onClick={() => set(value - step)}>−</button>
      <b>${value}</b>
      <button className="btn" aria-label={`Raise ${label}`} onClick={() => set(value + step)}>+</button>
    </div>
  )
  return (
    <>
      <h3 className="group">{inSeason ? 'Prices this season' : 'Prices for next season'}</h3>
      {stepper('Day ticket', game.ticketPriceUsd, 5, (v) => onChange(setTicketPrice(game, v)), 'Can change any day')}
      {inSeason ? (
        <div className="panel price"><span>Season pass<small className="block">Locked for this season</small></span><b>${game.passPriceUsd}</b></div>
      ) : stepper('Season pass', game.passPriceUsd, 25, (v) => onChange(setPassPrice(game, v)), 'Locked when the season starts')}
      {estimate && (
        <p className="hint small center">
          Estimated <b>{estimate.passesSold.toLocaleString()}</b> passes · <b>{usd(estimate.revenueUsd)}</b> cash when the season starts.
          Pass holders stop buying day tickets and ski more often.
        </p>
      )}
    </>
  )
}

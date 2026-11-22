/**
 * The live day: watch the resort run from 9:00 to 4:00 (and into the night, with lights),
 * react to what happens, and fast-forward when you like. Playback speed is screen time
 * only; skipping stops at any event card that needs an answer.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  LIVE, answerAfternoonOffer, answerLiveCard, checkAfternoon, checkParking, dayEnd, defaultHalfDayUsd, finishDay, setLiveApres, setLiveHalfDay, setLiveLate, setLiveOvertime, setLiveShuttle, forecast, liveDayDone, playTick, seasonDate, seasonInputs, setLiftMode, setLiveNight, setLiveNightPrice,
  setLivePrice, siteById, startDay, tickTime, PRICING,
  type DayResult, type GameState, type LiftMode, type LiveDay,
} from '../sim'
import { usd } from './format'
import { MapView, RENDER_SCALE } from './MapView'
import { DayReport } from './DayReport'
import { SeasonSummary } from './Season'
import { paintGround } from './village/art'
import { drawResortScene } from './village/drawResort'
import { buildRoutes, drawSkiers } from './village/skiers'
import { useResortScene } from './village/useScene'

const SPEEDS = [1, 4, 8] as const
const AFTERNOON_LABEL = {
  overtime: 'Overtime crew to close (+15% lift capacity)',
  late: 'Stay open to 5 pm (crew on overtime)',
  night: 'Run the night session (5–9 pm)',
  apres: 'Après special at the lodge (3 pm)',
  shuttle: 'Overflow parking shuttle',
} as const
/** Real seconds for one 30-minute tick at 1×. */
const TICK_SEC_AT_1X = 8
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const clock = (tick: number, late = false) => {
  const [h, m] = tickTime(tick, late).split(':').map(Number)
  return `${h > 12 ? h - 12 : h}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`
}
const dateLabel = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`)
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}
const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`

type Tone = 'ok' | 'near' | 'full'
const toneOf = (p: number): Tone => (p >= 1 ? 'full' : p >= 0.9 ? 'near' : 'ok')
const TONE_FILL: Record<Tone, string> = { ok: '#3a9150', near: '#e0a526', full: '#c0503f' }
const pctText = (p: number) => `${Math.min(100, Math.round(p * 100))}%`

/** A ring gauge for the rail down the right edge of the map. */
function Ring({ label, pct, text }: { label: string; pct: number; text?: string }) {
  const tone = toneOf(pct)
  const deg = Math.min(360, Math.max(0, pct) * 360)
  return (
    <div className={`ring ${tone}`}>
      <div className="ring-dial" style={{ background: `conic-gradient(${TONE_FILL[tone]} ${deg}deg, rgba(43,58,70,0.12) 0)` }}>
        <span>{text ?? pctText(pct)}</span>
      </div>
      <small>{label}</small>
    </div>
  )
}

/** Net so far today: takings minus costs, event income and costs included. */
const liveNet = (l: LiveDay) => {
  const a = l.acc
  return a.ticketRev + a.food + a.extras + a.eventIncome - a.cost - a.eventCost
}

/** Play days without drawing them. Stops at a pending event card or the end of the season. */
function fastForward(game: GameState, site: NonNullable<ReturnType<typeof siteById>>, maxDays: number): { game: GameState; days: number; last: DayResult | null; results: DayResult[] } {
  let g = game
  let days = 0
  let last: DayResult | null = null
  const results: DayResult[] = []
  while (days < maxDays && g.phase === 'season' && !g.bankrupt) {
    if (!g.live) g = startDay(g, site)
    for (let guard = 0; guard < 60 && g.live && !liveDayDone(g, site); guard++) {
      // Skipping does not stop for the 2 pm advice.
      if (g.live.afternoonOffer) g = { ...g, live: { ...g.live, afternoonOffer: null } }
      g = playTick(g, site)
      if (g.live?.pending) return { game: g, days, last, results }
    }
    if (!g.live) break
    const r = finishDay(g, site, true)
    g = r.game
    last = r.result
    results.push(r.result)
    days++
  }
  return { game: g, days, last, results }
}

export function LiveDayScreen({ game, onChange, onExit, onCalendar }: {
  game: GameState; onChange: (g: GameState) => void; onExit: () => void; onCalendar: () => void
}) {
  const site = siteById(game.siteId)!
  const [t, setT] = useState<import('../sim').Terrain | null>(null)
  const { frame, ready, scene } = useResortScene(site.terrainId!, game, t)
  const [speed, setSpeed] = useState<number>(4)
  // Auto-play skips the end-of-day report; by default each open day ends with one.
  const [auto, setAuto] = useState(false)
  const [last, setLast] = useState<DayResult | null>(null)
  /** Days covered by the report on screen (one day, or the days of a skip). */
  const [reportDays, setReportDays] = useState<DayResult[] | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [skipMenu, setSkipMenu] = useState(false)
  /** Which control (or forecast / season) is open in the sheet over the map. */
  const [openOpt, setOpenOpt] = useState<string | null>(null)
  const live = game.live
  const inp = useMemo(() => seasonInputs(game, site), [game, site])
  const routes = useMemo(() => buildRoutes(game.lifts, game.trails), [game.lifts, game.trails])
  const done = !!live && liveDayDone(game, site)
  const pending = live?.pending ? live.cards.find((c) => c.id === live.pending) ?? null : null
  const offer = live?.afternoonOffer ?? null
  // Latest values for timers and the animation loop (written after each render).
  const gameRef = useRef(game)
  const liveRef = useRef<{ live: LiveDay | null }>({ live })
  useEffect(() => { gameRef.current = game; liveRef.current = { live } })

  // Begin the next day when none is under way (the first time, or after the previous one).
  const needStart = game.phase === 'season' && !live
  useEffect(() => {
    if (!needStart) return
    // Closed days (before opening) pass by themselves; open days wait for the report unless auto-playing.
    const wait = last && (auto || !last.open) && speed > 0 ? Math.max(500, 2400 / speed) : last ? 1e9 : 0
    const id = setTimeout(() => { setToast(null); onChange(startDay(gameRef.current, site)) }, wait)
    return () => clearTimeout(id)
  }, [needStart, last, auto, speed, onChange, site])

  // Playback: one tick per timer, or close the day when it is over.
  useEffect(() => {
    if (!live || speed <= 0 || pending || offer) return
    // 2 pm: ask about overtime and the night session if either should pay off (pauses until answered).
    if (live.prep.open && !live.afternoonDone && live.tick === LIVE.afternoonTick && !auto) {
      onChange(checkAfternoon(gameRef.current, site))
      return
    }
    // The lot just filled: offer the overflow shuttle if it should pay (once a day).
    if (!auto && !live.parkingCheckDone && !live.shuttle && live.acc.parkingAway > 0 && (live.rows.at(-1)?.turnedAway ?? 0) > 0 && live.tick < LIVE.dayTicks) {
      onChange(checkParking(gameRef.current, site))
      return
    }
    const id = setTimeout(() => {
      const g = gameRef.current
      if (liveDayDone(g, site)) {
        const r = finishDay(g, site, true)
        setLast(r.result)
        setReportDays(r.result.open && !auto ? [r.result] : null)
        onChange(r.game)
      } else {
        onChange(playTick(g, site))
      }
    }, (TICK_SEC_AT_1X * 1000) / speed / (done ? 3 : 1))
    return () => clearTimeout(id)
  }, [live, speed, pending, offer, done, auto, onChange, site])

  const skip = (mode: 'day' | 'week' | 'season') => {
    setSkipMenu(false)
    const r = fastForward(gameRef.current, site, mode === 'day' ? 1 : mode === 'week' ? 7 : 999)
    if (r.last) setLast(r.last)
    // A skip ends with a report covering the days skipped (unless an event stopped it).
    setReportDays(r.days > 0 && !r.game.live?.pending ? r.results : null)
    setToast(r.game.live?.pending ? `Skipped ${r.days} day${r.days === 1 ? '' : 's'}: an event needs you` : `Skipped ${r.days} day${r.days === 1 ? '' : 's'}`)
    onChange(r.game)
  }

  const nextDay = () => { setReportDays(null); setToast(null); onChange(startDay(gameRef.current, site)) }

  const edit = (f: (l: LiveDay) => LiveDay) => live && onChange({ ...game, live: f(live) })
  const row = live?.rows.at(-1)
  const price = live?.priceUsd ?? game.ticketPriceUsd
  // Cars drawn = share of the lot's own spaces taken right now (the shuttle's overflow lot is off-map).
  const fullness = row?.lotFill ?? 0
  const factors = useMemo(() => (live
    ? game.lifts.map((_, i) => (live.prep.carryDown[i] || live.tick < live.fx.liftUntil[i] ? 0 : live.lifts[i] === 'closed' ? 0 : live.lifts[i] === 'slow' ? 0.5 : 1))
    : game.lifts.map(() => 1)), [live, game.lifts])
  const lights = (inp.amenity?.nightShare ?? 0) > 0
  const season = game.season
  const focus = game.base && frame ? { x: frame.v[0] + frame.r[0], y: frame.v[1] + frame.r[1] + 2, metresAcross: 700 } : undefined
  const fc = season ? forecast(season, game.difficulty.snow) : []

  const liftState = (i: number): { label: string; down: boolean } => {
    if (!live) return { label: 'Open', down: false }
    if (live.prep.carryDown[i] || live.tick < live.fx.liftUntil[i]) return { label: 'Down', down: true }
    return { label: live.lifts[i] === 'open' ? 'Open' : live.lifts[i] === 'slow' ? 'Slow' : 'Closed', down: false }
  }
  // Tap: open ⇄ slow (a closed lift reopens). Long press: close (or reopen if already closed).
  const tapMode = (m: LiftMode): LiftMode => (m === 'open' ? 'slow' : 'open')
  const holdMode = (m: LiftMode): LiftMode => (m === 'closed' ? 'open' : 'closed')


  // ---- Controls, as pieces the layouts arrange ----
  const liftChips = live && (
    <div className="chips">
      {game.lifts.map((l, i) => {
        const st = liftState(i)
        return (
          <LiftChip
            key={l.id} disabled={st.down || done || !live.prep.open}
            className={`chip lift-${st.label.toLowerCase()}${st.label === 'Open' ? '' : ' on'}`}
            onTap={() => edit((x) => setLiftMode(x, i, tapMode(x.lifts[i])))}
            onHold={() => edit((x) => setLiftMode(x, i, holdMode(x.lifts[i])))}
          >
            {l.name} · {st.label}
          </LiftChip>
        )
      })}
    </div>
  )
  const promoNote = live && (live.promo.dayDemandMult > 1 || live.promo.visitorMult > 1) ? <p className="hint small">A marketing campaign is running today.</p> : null
  const lotFullNow = !!live && !live.shuttle && (row?.turnedAway ?? 0) > 0 && live.acc.parkingAway > 0
  /** The optional actions: a short label and state for compact layouts, and the full row. */
  const options: { id: string; label: string; state: string; on: boolean; alert?: boolean; row: ReactNode }[] = !live ? [] : [
    ...(lights ? [{
      id: 'night', label: 'Night', state: live.night ? money(live.nightPriceUsd) : 'Off', on: !!live.night,
      row: (
        <div className="live-row">
          <span>Night session<small className="block">{live.night ? `5:00–9:00 pm · night ticket ${money(live.nightPriceUsd)}` : 'Off'}</small></span>
          <button className={live.night ? 'btn primary' : 'btn'} disabled={live.tick > dayEnd(live)} onClick={() => edit((l) => setLiveNight(l, !l.night))}>
            {live.night ? 'On' : 'Off'}
          </button>
          {live.night && live.tick <= dayEnd(live) && (
            <>
              <button className="btn" aria-label="Lower night price" onClick={() => edit((l) => setLiveNightPrice(l, l.nightPriceUsd - PRICING.stepUsd))}>−</button>
              <button className="btn" aria-label="Raise night price" onClick={() => edit((l) => setLiveNightPrice(l, l.nightPriceUsd + PRICING.stepUsd))}>+</button>
            </>
          )}
        </div>
      ),
    }] : []),
    {
      id: 'overtime', label: 'Overtime', state: live.ops.overtime ? 'On' : 'Off', on: !!live.ops.overtime,
      row: (
        <div className="live-row">
          <span>Overtime crew<small className="block">{live.ops.overtime ? '+15% lift capacity, +25% payroll for the rest of the day' : 'Off'}</small></span>
          <button className={live.ops.overtime ? 'btn primary' : 'btn'} disabled={done || live.tick >= dayEnd(live) || !!live.ops.overtime} onClick={() => edit((l) => setLiveOvertime(l, true))}>
            {live.ops.overtime ? 'On' : 'Call in'}
          </button>
        </div>
      ),
    },
    {
      id: 'half', label: 'Half-day', state: live.halfDayUsd ? money(live.halfDayUsd) : 'Off', on: !!live.halfDayUsd,
      row: (
        <div className="live-row">
          <span>Half-day ticket<small className="block">{live.halfDayUsd ? `From noon · ${money(live.halfDayUsd)}` : 'Not sold today'}</small></span>
          <button className={live.halfDayUsd ? 'btn primary' : 'btn'} disabled={done || live.tick >= LIVE.dayTicks} onClick={() => edit((l) => setLiveHalfDay(l, l.halfDayUsd ? null : defaultHalfDayUsd(l.priceUsd)))}>
            {live.halfDayUsd ? 'On' : 'Off'}
          </button>
          {!!live.halfDayUsd && !done && live.tick < LIVE.dayTicks && (
            <>
              <button className="btn" aria-label="Lower half-day price" onClick={() => edit((l) => setLiveHalfDay(l, (l.halfDayUsd ?? 0) - PRICING.stepUsd))}>−</button>
              <button className="btn" aria-label="Raise half-day price" onClick={() => edit((l) => setLiveHalfDay(l, (l.halfDayUsd ?? 0) + PRICING.stepUsd))}>+</button>
            </>
          )}
        </div>
      ),
    },
    {
      id: 'apres', label: 'Après', on: !!live.apres,
      state: live.apresResult ? money(live.apresResult.revenueUsd - live.apresResult.costUsd) : live.apres ? '3 pm' : 'Off',
      row: (
        <div className="live-row">
          <span>Après special<small className="block">{live.apresResult
            ? `Seated ${live.apresResult.served} of ${live.apresResult.wanted} · ${money(live.apresResult.revenueUsd - live.apresResult.costUsd)}`
            : live.apres ? `Booked for 3 pm · ${inp.amenity?.lodgeSeats ?? '—'} seats` : `3 pm at the lodge · ${inp.amenity?.lodgeSeats ?? '—'} seats`}</small></span>
          <button className={live.apres ? 'btn primary' : 'btn'} disabled={done || live.tick > LIVE.apresFromTick || !!live.apresResult} onClick={() => edit((l) => setLiveApres(l, !l.apres))}>
            {live.apres ? 'On' : 'Off'}
          </button>
        </div>
      ),
    },
    {
      id: 'shuttle', label: 'Shuttle', state: live.shuttle ? 'On' : lotFullNow ? 'Lot full' : 'Off', on: !!live.shuttle, alert: lotFullNow,
      row: (
        <div className={`live-row${lotFullNow ? ' alert' : ''}`}>
          <span>Overflow shuttle<small className="block">{live.shuttle ? 'Running for the rest of the day' : live.acc.parkingAway > 0 ? `Lot full: ${Math.round(live.acc.parkingAway).toLocaleString()} turned away so far` : `Lot ${Math.round(inp.amenity?.parkingCapGuests ?? 0).toLocaleString()} guests/day · $${LIVE.shuttleDayUsd.toLocaleString()} a day + $${LIVE.shuttlePerGuestUsd}/guest`}</small></span>
          <button className={live.shuttle ? 'btn primary' : 'btn'} disabled={done || live.tick >= dayEnd(live) || !!live.shuttle} onClick={() => edit((l) => setLiveShuttle(l, true))}>
            {live.shuttle ? 'On' : 'Call'}
          </button>
        </div>
      ),
    },
    {
      id: 'late', label: 'To 5 pm', state: live.late ? 'On' : 'Off', on: !!live.late,
      row: (
        <div className="live-row">
          <span>Open to 5 pm<small className="block">{live.late ? `Extra hour, crew on overtime · twilight ticket ${money(Math.round(live.priceUsd * LIVE.lateTicketMult))}` : 'Lifts close at 4 pm'}</small></span>
          <button className={live.late ? 'btn primary' : 'btn'} disabled={done || live.tick >= LIVE.dayTicks} onClick={() => edit((l) => setLiveLate(l, !l.late))}>
            {live.late ? 'On' : 'Off'}
          </button>
        </div>
      ),
    },
  ]
  const forecastView = (
            <div className="forecast">
              {fc.map((f) => (
                <div key={f.day} className="fc-day">
                  <b>{f.lead === 0 ? 'Today' : `${WEEKDAYS[f.weekday]} ${MONTHS[Number(f.date.slice(5, 7)) - 1]} ${Number(f.date.slice(8))}`}</b>
                  <span className={`pill ${f.kind === 'holiday' ? 'good' : f.kind === 'weekend' ? 'mid' : ''}`}>{f.kind}</span>
                  <span>{f.beforeOpening ? 'Not open yet' : f.outlook}</span>
                  <span>{f.snowHighIn > 0 ? `${f.snowLowIn === f.snowHighIn ? f.snowHighIn : `${f.snowLowIn}–${f.snowHighIn}`}″ snow` : 'No snow'}{f.warmChance >= 0.3 ? ` · ${Math.round(f.warmChance * 100)}% warm` : ''}</span>
                </div>
              ))}
              <p className="hint small">Ranges widen the further ahead it looks. Plan prices, a snowmaking push or overtime on the calendar.</p>
              <button className="btn" onClick={onCalendar}>Open the calendar</button>
            </div>
  )
  /** The open control (or forecast / season) in a sheet over the bottom of the map. */
  const sheetBody = !openOpt ? null
    : openOpt === 'forecast' ? forecastView
    : openOpt === 'season' ? <div className="live-season"><SeasonSummary game={game} /></div>
    : !live ? null
    : openOpt === 'lifts' ? <>{liftChips}<p className="hint small">Tap a lift to run it slowly; press and hold to close it.</p></>
    : openOpt === 'forecast' ? forecastView
    : openOpt === 'season' ? <div className="live-season"><SeasonSummary game={game} /></div>
    : options.find((o) => o.id === openOpt)?.row ?? null

  return (
    <MapView
      terrainId={site.terrainId!}
      bare
      animate
      base={paintGround}
      zoomBoost={3}
      focus={focus}
      onBack={onExit}
      onTerrain={setT}
      overlay={(ctx, scale) => {
        const sc = scene(fullness)
        if (!sc || !t) return
        drawResortScene(ctx, scale, sc)
        const l = liveRef.current.live
        // Night session: dusk over the map, lifts and the base lit up.
        if (l && l.prep.open && l.tick >= dayEnd(l)) {
          const S = RENDER_SCALE
          ctx.fillStyle = 'rgba(12, 22, 54, 0.52)'
          ctx.fillRect(0, 0, t.width * S, t.height * S)
          ctx.save()
          ctx.lineCap = 'round'
          ctx.shadowColor = 'rgba(255, 214, 120, 0.95)'
          ctx.shadowBlur = 10
          ctx.strokeStyle = 'rgba(255, 226, 150, 0.95)'
          ctx.lineWidth = 2.2 / scale
          for (const lift of game.lifts) {
            ctx.beginPath()
            ctx.moveTo((lift.bottom[0] + 0.5) * S, (lift.bottom[1] + 0.5) * S)
            ctx.lineTo((lift.top[0] + 0.5) * S, (lift.top[1] + 0.5) * S)
            ctx.stroke()
          }
          if (frame) {
            const [cx, cy] = [(frame.v[0] + 0.5) * S, (frame.v[1] + 0.5) * S]
            const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 110 * S / t.cellM)
            g.addColorStop(0, 'rgba(255, 214, 130, 0.5)')
            g.addColorStop(1, 'rgba(255, 214, 130, 0)')
            ctx.fillStyle = g
            ctx.fillRect(cx - 120 * S / t.cellM, cy - 120 * S / t.cellM, 240 * S / t.cellM, 240 * S / t.cellM)
          }
          ctx.restore()
        }
        if (l && l.prep.open) {
          const r = l.rows.at(-1)
          drawSkiers(ctx, scale, t, routes, { onHill: r?.onHill ?? 0, queueMin: r?.queueMin ?? 0, factors, time: performance.now() / 1000 })
        }
      }}
      panel={
        <section className="map-panel live-panel">
            <div className="opt-strip">
              {live && (<>
              <div className="strip-price">
                <button aria-label="Lower price" disabled={done} onClick={() => edit((l) => setLivePrice(l, l.priceUsd - PRICING.stepUsd))}>−</button>
                <b>${price}</b>
                <button aria-label="Raise price" disabled={done} onClick={() => edit((l) => setLivePrice(l, l.priceUsd + PRICING.stepUsd))}>+</button>
              </div>
              <button className={`chip${openOpt === 'lifts' ? ' sel' : ''}${game.lifts.some((_, i) => liftState(i).label !== 'Open') ? ' on' : ''}`} onClick={() => setOpenOpt(openOpt === 'lifts' ? null : 'lifts')}>
                Lifts {game.lifts.filter((_, i) => liftState(i).label === 'Open').length}/{game.lifts.length}
              </button>
              {options.map((o) => (
                <button key={o.id} className={`chip${o.on ? ' on' : ''}${o.alert ? ' alert' : ''}${openOpt === o.id ? ' sel' : ''}`} onClick={() => setOpenOpt(openOpt === o.id ? null : o.id)}>
                  {o.label}{o.on || o.alert ? ` · ${o.state}` : ''}
                </button>
              ))}
              </>)}
              <button className={`chip ghost${openOpt === 'forecast' ? ' sel' : ''}`} onClick={() => setOpenOpt(openOpt === 'forecast' ? null : 'forecast')}>Forecast</button>
              <button className={`chip ghost${openOpt === 'season' ? ' sel' : ''}`} onClick={() => setOpenOpt(openOpt === 'season' ? null : 'season')}>Season</button>
            </div>
          {promoNote}
          {!live && <p className="hint">Next day starts shortly. {last && <b>Yesterday: {money(last.netUsd)}.</b>}</p>}
        </section>
      }
      actions={
        <div className="speedbar">
          <button className={speed === 0 ? 'on' : ''} aria-label="Pause" onClick={() => setSpeed(0)}>II</button>
          {SPEEDS.map((s) => <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>{s}×</button>)}
          <button className="skip" onClick={() => setSkipMenu((m) => !m)}>Skip ▾</button>
        </div>
      }
    >
      <div className="hud-bar">
        <b>{live ? dateLabel(live.prep.date) : season ? dateLabel(seasonDate(game.year, season.day).toISOString().slice(0, 10)) : ''}</b>
        <span>{live && live.prep.open ? (done ? 'Closed' : clock(live.tick, !!live.late)) : live ? (live.prep.stormClosed ? 'Storm hold' : 'Not open yet') : '—'}</span>
        {live && live.prep.open && <b className={`hud-today${liveNet(live) < 0 ? ' neg' : ''}`}>{money(liveNet(live))}</b>}
        <button className="hud-home" aria-label="Back to the resort" onClick={onExit}>⌂</button>
      </div>
      {row && live?.prep.open && (
        <div className="hud-rail">
          {row.lotPct !== undefined && <Ring label="Parking" pct={row.lotPct} />}
          {row.liftPct !== undefined && <Ring label="Lifts" pct={row.liftPct} />}
          <Ring label="Line" pct={Math.min(1, row.queueMin / 20)} text={`${row.queueMin}m`} />
          <div className="rail-num"><b>{row.onHill.toLocaleString()}</b><small>on hill</small></div>
          <div className="rail-num"><b>{Math.round(live.acc.guests).toLocaleString()}</b><small>today</small></div>
        </div>
      )}
      {live && (
        <div className="hud-foot">
          <span>❄ <b>{live.prep.baseIn}″</b> base{live.prep.newSnowIn > 0 ? <> · <b>+{live.prep.newSnowIn}″</b> new</> : null}</span>
          {live.prep.open && <span><b>{Math.round(live.prep.conditions * 100)}%</b> conditions</span>}
        </div>
      )}
      {sheetBody && (
        <div className="ctl-sheet">
          <button className="bcard-x" aria-label="Close" onClick={() => setOpenOpt(null)}>×</button>
          {sheetBody}
        </div>
      )}
      {!ready && <p className="note map-loading">Drawing your resort…</p>}
      {skipMenu && (
        <div className="hud-sheet skip-sheet">
          <button className="btn" onClick={() => skip('day')}>Skip the day</button>
          <button className="btn" onClick={() => skip('week')}>Skip a week</button>
          <button className="btn" onClick={() => { if (window.confirm('Fast-forward the rest of the season? It stops if an event needs you.')) skip('season') }}>Skip the season</button>
          <label className="auto-toggle"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-play days (no report)</label>
        </div>
      )}
      {toast && <p className="toast" onClick={() => setToast(null)}>{toast}</p>}
      {!live && last && !toast && !reportDays && (
        <div className="day-summary">
          <b>{dateLabel(last.date)}</b>
          <span>{last.open ? `${last.guests.toLocaleString()} skiers · ${money(last.netUsd)}` : 'Closed'}</span>
          {!auto && <button className="btn primary" onClick={nextDay}>Next day ▸</button>}
        </div>
      )}
      {!live && reportDays && reportDays.length > 0 && game.phase === 'season' && (
        <DayReport
          days={reportDays} game={game}
          onNext={nextDay}
          onSkipWeek={() => { setReportDays(null); skip('week') }}
          onCalendar={onCalendar}
        />
      )}
      {pending && live && (
        <div className="card-overlay" role="dialog" aria-label={pending.title}>
          <div className="event-card">
            <small>{clock(pending.tick, !!live.late)}</small>
            <h3>{pending.title}</h3>
            <p>{pending.text}</p>
            {pending.options.map((o) => (
              <button key={o.id} className={o.id === pending.defaultOption ? 'btn' : 'btn primary'} onClick={() => onChange(answerLiveCard(game, site, o.id))}>
                <b>{o.label}</b>
                <small>{o.detail}</small>
              </button>
            ))}
          </div>
        </div>
      )}
      {offer && live && !pending && (
        <div className="card-overlay" role="dialog" aria-label="Afternoon check">
          <div className="event-card">
            <small>{clock(live.tick, !!live.late)} · {offer.kind === 'parking' ? 'parking' : 'afternoon check'}</small>
            <h3>{offer.kind === 'parking' ? 'The lot is full' : 'Busy afternoon: worth staying on?'}</h3>
            <p>
              {offer.kind === 'parking'
                ? `${offer.turnedAwaySoFar.toLocaleString()} skiers have turned around at a full lot. `
                : offer.turnedAwaySoFar > 0 ? `${offer.turnedAwaySoFar.toLocaleString()} skiers have given up so far. ` : ''}
              Estimates for the rest of today, if later events go the usual way:
            </p>
            {offer.options.map((o) => (
              <button key={o.id} className="btn primary" onClick={() => onChange(answerAfternoonOffer(game, o.id))}>
                <b>{o.id === 'combo' ? `All of them: ${(o.parts ?? []).map((p) => AFTERNOON_LABEL[p].toLowerCase()).join(' + ')}` : AFTERNOON_LABEL[o.id]}</b>
                <small>About {o.gainUsd >= 0 ? '+' : '−'}{money(Math.abs(o.gainUsd))} today{o.extraGuests > 0 ? ` · ~${o.extraGuests} more skiers` : ''}</small>
              </button>
            ))}
            <button className="btn" onClick={() => onChange(answerAfternoonOffer(game, 'none'))}>
              <b>No thanks</b>
              <small>Keep the day as planned</small>
            </button>
          </div>
        </div>
      )}
      {done && !pending && live && live.rows.length > 0 && <p className="hint center day-end">Day over: {money(liveNet(live))}</p>}
      <span className="sr-only">{usd(game.cashUsd)}</span>
    </MapView>
  )
}

const HOLD_MS = 500

/** Button that tells a tap from a long press (touch, mouse or pen). */
function LiftChip({ onTap, onHold, disabled, className, children }: {
  onTap: () => void; onHold: () => void; disabled: boolean; className: string; children: ReactNode
}) {
  const timer = useRef<number | null>(null)
  const held = useRef(false)
  const [holding, setHolding] = useState(false)
  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    setHolding(false)
  }
  useEffect(() => cancel, [])
  return (
    <button
      type="button" disabled={disabled}
      className={`${className} lift-chip${holding ? ' holding' : ''}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        held.current = false
        setHolding(true)
        timer.current = window.setTimeout(() => {
          timer.current = null
          held.current = true
          setHolding(false)
          navigator.vibrate?.(30)
          onHold()
        }, HOLD_MS)
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (held.current) { held.current = false; return }
        onTap()
      }}
    >
      {children}
    </button>
  )
}

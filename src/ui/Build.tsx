import { useEffect, useMemo, useState } from 'react'
import {
  BUILD, buildLift, buildTrail, computeParcels, planLift, planTrail, resample, siteById, snapToRuns,
  type Difficulty, type ExistingRun, type GameState, type LiftPlan, type LiftType, type Parcel, type Pt, type SnapResult, type Terrain, type TrailPlan,
} from '../sim'
import { MapView, RENDER_SCALE } from './MapView'
import { renderDifficultyLayer } from './difficultyLayer'
import { usd } from './format'
import { drawLift as drawLiftArt, drawTrailSwath, paintGround } from './village/art'
import { drawResortScene } from './village/drawResort'
import { useResortScene } from './village/useScene'

const S = RENDER_SCALE
const C = (v: number) => (v + 0.5) * S // cell centre -> base-image pixels
const DIFF_COLOR: Record<Difficulty, string> = { green: '#2e8b3e', blue: '#1d5fbf', black: '#1b1b1b' }
const DIFF_LABEL: Record<Difficulty, string> = { green: 'Easier', blue: 'More difficult', black: 'Most difficult' }
const LIFT_TYPES = Object.keys(BUILD.lifts) as LiftType[]
const ft = (m: number) => `${Math.round(m * 3.28084).toLocaleString()} ft`
const degToPct = (d: number) => Math.round(Math.tan((d * Math.PI) / 180) * 100)
const SNAP_COLOR = '#2a8fbd'
const SNAP_ANIM_MS = 450
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
/** Animation clock (drawing callbacks and event handlers only, never render). */
const clock = () => performance.now()

type Mode = 'trail' | 'lift'

function polyline(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  ctx.beginPath()
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(C(x), C(y)) : ctx.moveTo(C(x), C(y))))
}

function drawTrail(ctx: CanvasRenderingContext2D, scale: number, pts: Pt[], color: string, dashed = false) {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.setLineDash(dashed ? [8 / scale, 6 / scale] : [])
  polyline(ctx, pts)
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth = 7 / scale
  ctx.stroke()
  polyline(ctx, pts)
  ctx.strokeStyle = color
  ctx.lineWidth = 4 / scale
  ctx.stroke()
  ctx.setLineDash([])
}

function drawLift(ctx: CanvasRenderingContext2D, scale: number, a: Pt, b: Pt | null, pending = false) {
  ctx.setLineDash(pending ? [6 / scale, 4 / scale] : [])
  if (b) {
    ctx.beginPath()
    ctx.moveTo(C(a[0]), C(a[1]))
    ctx.lineTo(C(b[0]), C(b[1]))
    ctx.strokeStyle = '#5b2a86'
    ctx.lineWidth = 2.5 / scale
    ctx.stroke()
  }
  ctx.setLineDash([])
  for (const p of b ? [a, b] : [a]) {
    ctx.beginPath()
    ctx.arc(C(p[0]), C(p[1]), 6 / scale, 0, Math.PI * 2)
    ctx.fillStyle = '#fffdf7'
    ctx.fill()
    ctx.lineWidth = 2.5 / scale
    ctx.strokeStyle = '#5b2a86'
    ctx.stroke()
  }
}

export function BuildScreen({ game, onChange, onBack }: {
  game: GameState; onChange: (g: GameState) => void; onBack: () => void
}) {
  const site = siteById(game.siteId)!
  const [terrain, setTerrain] = useState<Terrain | null>(null)
  const [parcels, setParcels] = useState<Parcel[]>([])
  const [mode, setMode] = useState<Mode>('trail')
  const [stroke, setStroke] = useState<Pt[]>([])
  const [trail, setTrail] = useState<TrailPlan | null>(null)
  const [stations, setStations] = useState<Pt[]>([])
  const [liftType, setLiftType] = useState<LiftType>('fixedDouble')
  const [message, setMessage] = useState<string | null>(null)
  const [layer, setLayer] = useState<HTMLCanvasElement | null>(null)
  const [showRuns, setShowRuns] = useState(false)
  // Snapping: a live preview while drawing, and a short animation when the line lands.
  const [preview, setPreview] = useState<SnapResult | null>(null)
  const [snapT0, setSnapT0] = useState<number | null>(null)
  useEffect(() => {
    if (snapT0 === null) return
    const id = setTimeout(() => setSnapT0(null), SNAP_ANIM_MS + 250)
    return () => clearTimeout(id)
  }, [snapT0])
  const runs: ExistingRun[] = useMemo(() => game.trails.map((x) => ({ id: x.id, name: x.name, points: x.points })), [game.trails])

  const lift: LiftPlan | null =
    terrain && stations.length === 2 ? planLift(terrain, liftType, stations[0], stations[1], parcels, game.ownedParcels) : null

  const { frame, scene } = useResortScene(site.terrainId!, game, terrain)
  const reset = () => { setStroke([]); setTrail(null); setStations([]) }
  const switchMode = (m: Mode) => { reset(); setMessage(null); setMode(m) }

  const pending = trail ?? lift
  const problem = pending?.problems[0] ?? (pending && pending.costUsd > game.cashUsd ? 'Not enough cash' : null)

  const confirm = () => {
    const r = trail ? buildTrail(game, trail) : lift ? buildLift(game, lift) : null
    if (!r) return
    if (!r.ok) { setMessage(r.reason); return }
    onChange(r.game)
    setMessage(trail ? `Built ${r.game.trails.at(-1)!.name}` : `Built ${r.game.lifts.at(-1)!.name}`)
    reset()
  }

  return (
    <MapView
      terrainId={site.terrainId!}
      onBack={onBack}
      base={paintGround}
      zoomBoost={3}
      // Open on the base village so new lifts and trails are drawn out from it.
      focus={frame ? { x: frame.v[0], y: frame.v[1], metresAcross: 900 } : undefined}
      animate={snapT0 !== null || (preview?.pulls.length ?? 0) > 0}
      drawing={mode === 'trail'} // a new stroke replaces any pending trail
      onTerrain={(t) => { setTerrain(t); setParcels(computeParcels(t)); setLayer(renderDifficultyLayer(t)) }}
      onStrokeMove={(pts) => {
        setStroke(pts)
        // Show the line being pulled onto any run it would merge with, before you lift your finger.
        if (terrain && runs.length && pts.length > 1) setPreview(snapToRuns(resample(pts, BUILD.trail.stepM / terrain.cellM), runs, terrain.cellM))
        else setPreview(null)
      }}
      onStrokeEnd={(pts) => {
        setStroke([])
        setPreview(null)
        if (!terrain || pts.length < 2) return
        setMessage(null)
        setTrail(planTrail(terrain, pts, parcels, game.ownedParcels, runs))
        setSnapT0(clock())
      }}
      onTapCell={(x, y) => {
        if (mode !== 'lift') return
        setMessage(null)
        setStations((s) => (s.length >= 2 ? [[x, y]] : [...s, [x, y]]))
      }}
      overlay={(ctx, scale) => {
        const k = S / (terrain?.cellM ?? 10)
        const px = ([x, y]: Pt): [number, number] => [C(x), C(y)]
        // Slope-based run difficulty on owned land (under trees, trails and buildings).
        if (showRuns && layer) {
          for (const p of parcels) {
            if (!game.ownedParcels.includes(p.id)) continue
            ctx.save()
            ctx.beginPath()
            ctx.rect(p.x0 * S, p.y0 * S, (p.x1 - p.x0) * S, (p.y1 - p.y0) * S)
            ctx.clip()
            ctx.imageSmoothingEnabled = false
            ctx.drawImage(layer, 0, 0, layer.width * S, layer.height * S)
            ctx.restore()
          }
        }
        // The resort as built: roads, base village, existing trails and lifts.
        const sc = scene(0.2)
        if (sc) drawResortScene(ctx, scale, sc)
        // Dim land the player does not own.
        ctx.fillStyle = 'rgba(60,50,40,0.32)'
        for (const p of parcels) {
          if (!game.ownedParcels.includes(p.id)) ctx.fillRect(p.x0 * S, p.y0 * S, (p.x1 - p.x0) * S, (p.y1 - p.y0) * S)
        }
        // New work, drawn on top: translucent until you confirm it.
        const now = clock()
        const pulse = 0.5 + 0.5 * Math.sin(now / 160)
        const ring = (p: Pt, r: number) => {
          ctx.beginPath()
          ctx.arc(C(p[0]), C(p[1]), r / scale, 0, Math.PI * 2)
          ctx.stroke()
        }
        if (stroke.length > 1) {
          drawTrail(ctx, scale, stroke, '#7a6a55', true)
          // The magnet: where the line will be pulled onto an existing run.
          if (preview && preview.pulls.length) {
            ctx.save()
            ctx.lineCap = 'round'
            ctx.strokeStyle = SNAP_COLOR
            ctx.lineWidth = 2 / scale
            for (const pl of preview.pulls) {
              ctx.beginPath(); ctx.moveTo(C(pl.from[0]), C(pl.from[1])); ctx.lineTo(C(pl.to[0]), C(pl.to[1])); ctx.stroke()
            }
            ctx.lineWidth = 5 / scale
            ctx.globalAlpha = 0.85
            ctx.setLineDash([])
            for (const m of preview.merges) {
              ctx.beginPath()
              preview.points.slice(m.from, m.to + 1).forEach(([x, y], i) => (i ? ctx.lineTo(C(x), C(y)) : ctx.moveTo(C(x), C(y))))
              ctx.stroke()
            }
            ctx.globalAlpha = 0.5 + 0.5 * pulse
            ctx.lineWidth = 2.5 / scale
            for (const m of preview.merges) ring(preview.points[m.kind === 'join' && m.from === 0 ? m.from : m.to], 7 + 4 * pulse)
            ctx.restore()
          }
        }
        if (trail) {
          // On release the line eases from where you drew it onto the run it merges with.
          const e = snapT0 === null ? 1 : easeOut(Math.min(1, (now - snapT0) / SNAP_ANIM_MS))
          const pts: Pt[] = trail.points.map((p, i) => {
            const r = trail.rawPoints[i] ?? p
            return [r[0] + (p[0] - r[0]) * e, r[1] + (p[1] - r[1]) * e]
          })
          if (!trail.problems.length) {
            ctx.save()
            ctx.globalAlpha = 0.7
            drawTrailSwath(ctx, pts.map(px), k, trail.difficulty)
            ctx.restore()
          }
          drawTrail(ctx, scale, pts, trail.problems.length ? '#b03a2e' : DIFF_COLOR[trail.difficulty], true)
          if (trail.merges.length && e >= 1) {
            ctx.save()
            ctx.lineCap = 'round'
            ctx.lineJoin = 'round'
            ctx.strokeStyle = SNAP_COLOR
            // The shared stretch, outlined.
            ctx.lineWidth = 4 / scale
            ctx.globalAlpha = 0.75
            let open = false
            ctx.beginPath()
            pts.forEach(([x, y], i) => {
              if (trail.shared[i]) { ctx.lineTo(C(x), C(y)); if (!open) { ctx.moveTo(C(x), C(y)); open = true } } else open = false
            })
            ctx.stroke()
            // Merge and junction markers.
            ctx.globalAlpha = 0.6 + 0.4 * pulse
            ctx.lineWidth = 2.5 / scale
            for (const m of trail.merges) {
              if (m.kind === 'merge') { ring(pts[m.from], 6 + 3 * pulse); ring(pts[m.to], 6 + 3 * pulse) }
              else ring(pts[m.from === 0 ? 0 : m.to], 6 + 3 * pulse)
            }
            ctx.restore()
          }
        }
        if (lift) {
          ctx.save()
          ctx.globalAlpha = 0.75
          drawLiftArt(ctx, px(lift.bottom), px(lift.top), k, lift.type, 0, true)
          ctx.restore()
        }
        if (stations.length) drawLift(ctx, scale, stations[0], stations[1] ?? null, true)
      }}
      panel={
        <section className="map-panel build-panel">
          <div className="seg" role="tablist">
            <button role="tab" aria-selected={mode === 'trail'} className={mode === 'trail' ? 'on' : ''} onClick={() => switchMode('trail')}>Trail</button>
            <button role="tab" aria-selected={mode === 'lift'} className={mode === 'lift' ? 'on' : ''} onClick={() => switchMode('lift')}>Lift</button>
            <button aria-pressed={showRuns} className={showRuns ? 'tgl on' : 'tgl'} onClick={() => setShowRuns((v) => !v)}>{showRuns ? '✓ ' : ''}Runs</button>
            <span className="cash">Cash {usd(game.cashUsd)}</span>
          </div>

          {mode === 'trail' && !trail && !(stroke.length && preview?.merges.length) && (
            <p className="hint">Draw a trail with one finger. Use two fingers to move or zoom the map. Where it meets a run, it snaps on.</p>
          )}
          {mode === 'trail' && !trail && stroke.length > 0 && preview && preview.merges.length > 0 && (
            <p className="hint snap-hint">Snapping onto {[...new Set(preview.merges.map((m) => m.name))].join(' and ')}. Lift your finger to see it join.</p>
          )}
          {trail && trail.problems.length > 0 && <p className="hint">Draw again to replace it.</p>}
          {trail && (
            <>
              <h3>
                <span className="diff" style={{ background: DIFF_COLOR[trail.difficulty] }} />
                {DIFF_LABEL[trail.difficulty]} trail · {usd(trail.costUsd)}
              </h3>
              {trail.merges.length > 0 && (
                <p className="hint snap-hint">
                  {trail.merges.map((m) => `${m.kind === 'merge' ? 'Merges with' : 'Joins'} ${m.name}`).join(' · ')}
                  {trail.sharedM > 0 ? `. The ${ft(trail.sharedM)} it shares is already cleared, so you only pay for the new ${ft(trail.lengthM)}.` : '.'}
                </p>
              )}
              <div className="mini-stats">
                <span><b>{ft(trail.lengthM)}</b> {trail.sharedM > 0 ? 'new' : 'long'}</span>
                <span><b>{ft(trail.verticalM)}</b> vertical</span>
                <span><b>{degToPct(trail.steepSlopeDeg)}%</b> steep sections</span>
                <span><b>{trail.acres}</b> acres cleared</span>
              </div>
            </>
          )}

          {mode === 'lift' && (
            <>
              <div className="chips">
                {LIFT_TYPES.map((t) => (
                  <button key={t} className={t === liftType ? 'chip on' : 'chip'} onClick={() => setLiftType(t)}>
                    {BUILD.lifts[t].name}
                  </button>
                ))}
              </div>
              {!lift && <p className="hint">{stations.length ? 'Now tap the other station.' : 'Tap where the two lift stations go.'}</p>}
              {lift && (
                <>
                  <h3>{BUILD.lifts[lift.type].name} · {usd(lift.costUsd)}</h3>
                  <div className="mini-stats">
                    <span><b>{ft(lift.lengthM)}</b> long</span>
                    <span><b>{ft(lift.verticalM)}</b> rise</span>
                    <span><b>{lift.rideMin}</b> min ride</span>
                    <span><b>{lift.capacityPph.toLocaleString()}</b> riders/hr</span>
                  </div>
                </>
              )}
            </>
          )}
          {(problem || message) && <p className={problem ? 'warn' : 'ok'}>{problem ?? message}</p>}
        </section>
      }
      actions={
        pending ? (
          <div className="row">
            <button className="btn" onClick={reset}>Discard</button>
            <button className="btn primary" disabled={!!problem} onClick={confirm}>Build · {usd(pending.costUsd)}</button>
          </div>
        ) : (
          <button className="btn" onClick={onBack}>Done building</button>
        )
      }
    />
  )
}

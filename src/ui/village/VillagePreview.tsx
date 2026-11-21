/**
 * PREVIEW ONLY (owner review): the proposed bird's-eye home view, base-village siting,
 * and building level art. Reached with ?preview=village. Nothing here touches saves.
 * The resorts drawn are sample layouts generated from the real terrain, not a game state.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  computeParcels, decodeDem, elevAt, planTrail, slopeDeg, suggestBaseSites, VILLAGE,
  type BaseSite, type Parcel, type Pt, type Terrain, type TerrainMeta,
} from '../../sim'
import { MapView, RENDER_SCALE } from '../MapView'
import {
  BUILDING_LEVELS, drawBuilding, drawDiffSign, drawLift, drawParking, drawTrailSwath, paintTerrain,
  type BuildingKind, type Diff, type LiftKind,
} from './art'

const TERRAIN_ID = 'co-berthoud-pass'
const ACCESS = 'r1c1'
const FT = 3.28084

type View = 'home1' | 'home2' | 'site' | 'levels'

function useTerrain() {
  const [t, setT] = useState<Terrain | null>(null)
  useEffect(() => {
    const base = `${import.meta.env.BASE_URL}sites/${TERRAIN_ID}`
    ;(async () => {
      const meta: TerrainMeta = await (await fetch(`${base}.json`)).json()
      const buf = await (await fetch(`${base}.dem.bin`)).arrayBuffer()
      setT(decodeDem(buf, meta.width, meta.height, meta.cellM))
    })()
  }, [])
  return t
}

// ---------- sample resort layout from real terrain ----------

interface SampleLift { kind: LiftKind; bottom: Pt; top: Pt; name: string }
interface SampleTrail { pts: Pt[]; diff: Diff; name: string }
interface Layout {
  base: BaseSite
  /** Uphill unit vector (cells). */
  u: [number, number]
  lifts: SampleLift[]
  trails: SampleTrail[]
}

function inParcels(ps: Parcel[], x: number, y: number) {
  return ps.some((p) => x >= p.x0 + 3 && x < p.x1 - 3 && y >= p.y0 + 3 && y < p.y1 - 3)
}

/** Best lift top from `from`: most vertical within reach, on land in `ps`, avoiding given headings. */
function findTop(t: Terrain, from: Pt, ps: Parcel[], avoid: number[], maxM: number): { top: Pt; ang: number } | null {
  let best: { top: Pt; ang: number; score: number } | null = null
  for (let ang = 0; ang < 360; ang += 5) {
    if (avoid.some((a) => Math.abs(((ang - a + 540) % 360) - 180) < 70)) continue
    const rad = (ang * Math.PI) / 180
    for (let m = 400; m <= maxM; m += 50) {
      const x = from[0] + (Math.sin(rad) * m) / t.cellM
      const y = from[1] - (Math.cos(rad) * m) / t.cellM
      if (!inParcels(ps, x, y)) break
      if (slopeDeg(t, Math.round(x), Math.round(y)) > 30) continue
      const gain = elevAt(t, x, y) - elevAt(t, ...from)
      const score = gain - m * 0.05
      if (!best || score > best.score) best = { top: [x, y], ang, score }
    }
  }
  return best && { top: best.top, ang: best.ang }
}

/** Trails from a lift top back to the base, curving to either side; keeps skiable ones. */
function trailsFor(t: Terrain, top: Pt, end: Pt, parcels: Parcel[], owned: string[], names: string[]): SampleTrail[] {
  const out: SampleTrail[] = []
  const dx = end[0] - top[0], dy = end[1] - top[1]
  const len = Math.hypot(dx, dy)
  for (const side of [0.35, -0.35, 0.6, -0.6, 0.15]) {
    if (out.length >= names.length) break
    const cx = top[0] + dx * 0.5 - (dy / len) * len * side
    const cy = top[1] + dy * 0.5 + (dx / len) * len * side
    const raw: Pt[] = []
    for (let i = 0; i <= 30; i++) {
      const s = i / 30
      // Gentle meanders (±~25 m) so sample runs don't look ruler-drawn.
      const wob = Math.sin(s * Math.PI * 3 + side * 7) * Math.sin(s * Math.PI) * (25 / t.cellM)
      raw.push([
        (1 - s) ** 2 * top[0] + 2 * (1 - s) * s * cx + s * s * end[0] - (dy / len) * wob,
        (1 - s) ** 2 * top[1] + 2 * (1 - s) * s * cy + s * s * end[1] + (dx / len) * wob,
      ])
    }
    const plan = planTrail(t, raw, parcels, owned)
    if (plan.problems.length) continue
    out.push({ pts: plan.points, diff: plan.difficulty, name: names[out.length] })
  }
  return out
}

function makeLayout(t: Terrain, stage: 1 | 2): Layout | null {
  const parcels = computeParcels(t)
  const access = parcels.find((p) => p.id === ACCESS)!
  const [base] = suggestBaseSites(t, access, 1)
  if (!base) return null
  const land = stage === 1 ? [access] : parcels.filter((p) => ['r1c1', 'r0c1', 'r1c2', 'r1c0'].includes(p.id))
  const owned = land.map((p) => p.id)
  const b: Pt = [base.x, base.y]
  const first = findTop(t, b, land, [], stage === 1 ? 900 : 1200)
  if (!first) return null
  const rad = (first.ang * Math.PI) / 180
  const u: [number, number] = [Math.sin(rad), -Math.cos(rad)]
  const n: [number, number] = [-u[1], u[0]]
  const at = (along: number, side: number): Pt => [b[0] + (u[0] * along + n[0] * side) / t.cellM, b[1] + (u[1] * along + n[1] * side) / t.cellM]
  const lifts: SampleLift[] = []
  const trails: SampleTrail[] = []
  const b1 = at(55, -15)
  lifts.push({ kind: 'fixedDouble', bottom: b1, top: first.top, name: 'Summit Double' })
  trails.push(...trailsFor(t, first.top, at(40, 20), parcels, owned, stage === 1 ? ['Pass Run', 'Easy Street'] : ['Pass Run', 'Easy Street', 'Cornice']))
  if (stage === 2) {
    const second = findTop(t, at(30, -60), land, [first.ang], 1100)
    if (second) {
      lifts.push({ kind: 'fixedQuad', bottom: at(30, -60), top: second.top, name: 'Divide Quad' })
      trails.push(...trailsFor(t, second.top, at(10, -40), parcels, owned, ['Continental', 'Timberline', 'Headwall']))
    }
    lifts.push({ kind: 'ropeTow', bottom: at(-10, 80), top: at(230, 95), name: 'Bunny Tow' })
    trails.push(...trailsFor(t, at(230, 95), at(-5, 70), parcels, owned, ['Bunny Hill']))
  }
  return { base, u, lifts, trails }
}

// ---------- drawing the resort ----------

interface VillageLevels { lodge: number; rentals: number; school: number; housing: number; parking: number; shop: number }

function drawResort(ctx: CanvasRenderingContext2D, t: Terrain, L: Layout, lv: VillageLevels, scale: number) {
  const S = RENDER_SCALE
  const k = S / t.cellM // overlay px per metre
  const px = (p: Pt): [number, number] => [(p[0] + 0.5) * S, (p[1] + 0.5) * S]
  const { u } = L
  const n: [number, number] = [-u[1], u[0]]
  const b: Pt = [L.base.x, L.base.y]
  const at = (along: number, side: number) => px([b[0] + (u[0] * along + n[0] * side) / t.cellM, b[1] + (u[1] * along + n[1] * side) / t.cellM])

  for (const tr of L.trails) drawTrailSwath(ctx, tr.pts.map(px), k, tr.diff)
  // Plowed base area and access road (toward the downhill side).
  ctx.fillStyle = 'rgba(232, 226, 214, 0.97)'
  const c = at(-20, 20)
  const rr = (60 + 30 * lv.lodge) * k
  ctx.beginPath(); ctx.ellipse(c[0], c[1], rr * 1.15, rr, 0, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = '#8f8a82'
  ctx.lineWidth = 9 * k
  const r0 = at(-60, 0), r1 = at(-420, -140)
  ctx.beginPath(); ctx.moveTo(...r0); ctx.quadraticCurveTo(...at(-250, 60), ...r1); ctx.stroke()
  drawParking(ctx, lv.parking, ...at(-95 - 15 * lv.lodge, 10), k, 0.7, u[0], u[1])

  // Draw buildings back (north) to front (south) so overlaps look right.
  const items: { kind: BuildingKind; level: number; p: [number, number] }[] = [
    { kind: 'lodge', level: lv.lodge, p: at(-30, 0) },
    { kind: 'ticket', level: 1, p: at(25, 20) },
    { kind: 'rentals', level: lv.rentals, p: at(-15, 85) },
    { kind: 'school', level: lv.school, p: at(15, 130) },
    { kind: 'housing', level: lv.housing, p: at(-90, 190) },
    { kind: 'shop', level: lv.shop, p: at(-50, -55 - 20 * lv.lodge) },
  ]
  items.sort((a, b2) => a.p[1] - b2.p[1])
  for (const it of items) drawBuilding(ctx, it.kind, it.level, it.p[0], it.p[1], k)
  for (const l of L.lifts) drawLift(ctx, px(l.bottom), px(l.top), k, l.kind)
  // Trail signs at the top of each run; sized to stay readable at any zoom.
  const sign = 7 / scale
  for (const tr of L.trails) {
    const p = px(tr.pts[Math.min(2, tr.pts.length - 1)])
    drawDiffSign(ctx, p[0], p[1], sign, tr.diff, scale > 2.5 ? tr.name : undefined)
  }
}

// ---------- screens ----------

function Hud({ stage }: { stage: 1 | 2 }) {
  return (
    <div className="hud">
      <div className="hud-row">
        <b>Berthoud Pass</b>
        <span>{stage === 1 ? 'Year 1 · Off-season' : 'Year 8 · Jan 14 · Open'}</span>
      </div>
      <div className="hud-chips">
        <span>Cash {stage === 1 ? '$1.4M' : '$6.2M'}</span>
        <span>Rep {stage === 1 ? '100%' : '108%'}</span>
        {stage === 2 && <span>3,140 skiers</span>}
        {stage === 2 && <span>46″ base</span>}
      </div>
    </div>
  )
}

function TabBar({ active = 'resort' }: { active?: string }) {
  const tabs = [['resort', 'Resort'], ['build', 'Build'], ['village', 'Village'], ['prices', 'Prices'], ['staff', 'Staff'], ['money', 'Money']]
  return (
    <nav className="tabbar">
      {tabs.map(([id, label]) => <button key={id} className={id === active ? 'on' : ''}>{label}</button>)}
    </nav>
  )
}

function HomePreview({ t, stage }: { t: Terrain; stage: 1 | 2 }) {
  const layout = useMemo(() => makeLayout(t, stage), [t, stage])
  const levels: VillageLevels = stage === 1
    ? { lodge: 1, rentals: 0, school: 0, housing: 0, parking: 0, shop: 1 }
    : { lodge: 3, rentals: 2, school: 2, housing: 2, parking: 2, shop: 1 }
  const q = new URLSearchParams(window.location.search)
  const [showCard, setShowCard] = useState(stage === 2 && q.get('card') !== '0')
  if (!layout) return <p className="note">No base site found.</p>
  return (
    <MapView
      terrainId={TERRAIN_ID}
      bare
      base={paintTerrain}
      zoomBoost={3}
      focus={{ x: layout.base.x + layout.u[0] * 4, y: layout.base.y + layout.u[1] * 4 + 3, metresAcross: Number(q.get('across')) || (stage === 1 ? 420 : 800) }}
      onBack={() => {}}
      onTapCell={() => setShowCard((v) => !v)}
      overlay={(ctx, scale) => drawResort(ctx, t, layout, levels, scale)}
      actions={<TabBar />}
    >
      <Hud stage={stage} />
      {showCard ? (
        <div className="bcard">
          <div><b>Day Lodge · Level 3</b><small>Food spend ×1.35 · seats 240 (PLACEHOLDER)</small></div>
          <button className="btn primary">Upgrade to 4 · $3.2M</button>
        </div>
      ) : (
        <button className="btn primary fab">{stage === 1 ? 'Start winter ▸' : 'Next day ▸'}</button>
      )}
    </MapView>
  )
}

function SitePreview({ t }: { t: Terrain }) {
  const parcels = useMemo(() => computeParcels(t), [t])
  const access = parcels.find((p) => p.id === ACCESS)!
  const sites = useMemo(() => suggestBaseSites(t, access, 3), [t, access])
  const [pick, setPick] = useState(0)
  const flat = useMemo(() => {
    // Buildable ground: footprint-mean slope under the limit (sampled, cheap).
    const cv = document.createElement('canvas')
    cv.width = t.width
    cv.height = t.height
    const ctx = cv.getContext('2d')!
    const img = ctx.createImageData(t.width, t.height)
    for (let y = access.y0; y < access.y1; y++) for (let x = access.x0; x < access.x1; x++) {
      const s = slopeDeg(t, x, y)
      if (s < VILLAGE.maxMeanSlopeDeg) {
        const i = (y * t.width + x) * 4
        img.data[i] = 58; img.data[i + 1] = 145; img.data[i + 2] = 80; img.data[i + 3] = 120 * (1 - s / VILLAGE.maxMeanSlopeDeg) + 40
      }
    }
    ctx.putImageData(img, 0, 0)
    return cv
  }, [t, access])
  const s = sites[pick]
  return (
    <MapView
      terrainId={TERRAIN_ID}
      focus={{ x: (access.x0 + access.x1) / 2, y: (access.y0 + access.y1) / 2, metresAcross: 1500 }}
      zoomBoost={2}
      onBack={() => {}}
      overlay={(ctx, scale) => {
        const S = RENDER_SCALE
        ctx.fillStyle = 'rgba(60,50,40,0.32)'
        for (const p of parcels) if (p.id !== ACCESS) ctx.fillRect(p.x0 * S, p.y0 * S, (p.x1 - p.x0) * S, (p.y1 - p.y0) * S)
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(flat, 0, 0, t.width * S, t.height * S)
        sites.forEach((b, i) => {
          const x = (b.x + 0.5) * S, y = (b.y + 0.5) * S
          const r = (VILLAGE.footprintM / t.cellM) * S
          ctx.strokeStyle = i === pick ? '#2a5a92' : 'rgba(42,90,146,0.5)'
          ctx.lineWidth = (i === pick ? 3 : 2) / scale
          ctx.setLineDash(i === pick ? [] : [6 / scale, 4 / scale])
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke()
          ctx.setLineDash([])
          ctx.fillStyle = i === pick ? '#2a5a92' : '#fff'
          ctx.beginPath(); ctx.arc(x, y, 11 / scale, 0, Math.PI * 2); ctx.fill()
          ctx.fillStyle = i === pick ? '#fff' : '#2a5a92'
          ctx.font = `800 ${13 / scale}px Nunito, sans-serif`
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
          ctx.fillText(String(i + 1), x, y + 0.5 / scale)
        })
      }}
      panel={
        <section className="map-panel">
          <h3>Where should your base village go?</h3>
          <div className="seg">
            {sites.map((b, i) => (
              <button key={i} className={i === pick ? 'on' : ''} onClick={() => setPick(i)}>#{i + 1} · {b.score}</button>
            ))}
          </div>
          {s && (
            <p className="hint">
              {Math.round(s.elevM * FT).toLocaleString()} ft · {s.meanSlopeDeg.toFixed(1)}° average slope ·
              {' '}{Math.round(s.nearVerticalM * FT).toLocaleString()} ft of lift vertical within {VILLAGE.nearReachM} m,
              {' '}{Math.round(s.verticalAboveM * FT).toLocaleString()} ft within {(VILLAGE.reachM / 1000).toFixed(1)} km.
              Green = flat enough to build on.
            </p>
          )}
        </section>
      }
      actions={
        <>
          <button className="btn primary">Build base village here</button>
          <button className="btn">Place it myself</button>
        </>
      }
    />
  )
}

function LevelsSheet() {
  const ref = useRef<HTMLCanvasElement>(null)
  const rows: { kind: BuildingKind | 'parking'; name: string; from: number; to: number }[] = [
    { kind: 'lodge', name: 'Day lodge', from: 1, to: BUILDING_LEVELS.lodge },
    { kind: 'rentals', name: 'Rental shop', from: 1, to: BUILDING_LEVELS.rentals },
    { kind: 'school', name: 'Ski school', from: 1, to: BUILDING_LEVELS.school },
    { kind: 'housing', name: 'Staff housing', from: 1, to: BUILDING_LEVELS.housing },
    { kind: 'parking', name: 'Parking', from: 0, to: 4 },
  ]
  const lifts: [LiftKind, string][] = [['ropeTow', 'Rope tow'], ['fixedDouble', 'Fixed double'], ['fixedQuad', 'Fixed quad']]
  const cellW = 170, cellH = 150, labelH = 26
  const W = cellW * 5 + 20
  const H = (rows.length + 1) * (cellH + labelH) + 20
  useEffect(() => {
    const cv = ref.current!
    const dpr = window.devicePixelRatio || 1
    cv.width = W * dpr
    cv.height = H * dpr
    const ctx = cv.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.fillStyle = '#f6f1e6'
    ctx.fillRect(0, 0, W, H)
    const cellBg = (x: number, y: number) => {
      ctx.fillStyle = '#eef2f7'
      ctx.beginPath(); ctx.roundRect(x + 4, y + 4, cellW - 8, cellH - 8, 14); ctx.fill()
      ctx.fillStyle = 'rgba(214,205,188,0.8)'
      ctx.beginPath(); ctx.ellipse(x + cellW / 2, y + cellH * 0.6, cellW * 0.42, cellH * 0.3, 0, 0, Math.PI * 2); ctx.fill()
    }
    const label = (x: number, y: number, text: string, bold = false) => {
      ctx.fillStyle = bold ? '#2b3a46' : '#6b7882'
      ctx.font = `${bold ? 800 : 400} 13px Nunito, sans-serif`
      ctx.textAlign = bold ? 'left' : 'center'
      ctx.fillText(text, x, y)
    }
    rows.forEach((r, ri) => {
      const y0 = 10 + ri * (cellH + labelH)
      label(14, y0 + 16, r.name, true)
      for (let lv = r.from; lv <= r.to; lv++) {
        const x0 = 10 + (lv - r.from) * cellW
        const y = y0 + labelH
        cellBg(x0, y)
        if (r.kind === 'parking') drawParking(ctx, lv, x0 + cellW / 2, y + cellH * 0.45, 0.55, 0.7, 0, -1)
        else drawBuilding(ctx, r.kind, lv, x0 + cellW / 2, y + cellH * 0.62, r.kind === 'lodge' ? 0.8 : 1.4)
        label(x0 + cellW / 2, y + cellH - 12, r.kind === 'parking' && lv === 0 ? 'Gravel lot (included)' : `Level ${lv}`)
      }
    })
    const y0 = 10 + rows.length * (cellH + labelH)
    label(14, y0 + 16, 'Lifts (bottom → top)', true)
    lifts.forEach(([kind, name], i) => {
      const x0 = 10 + i * cellW
      const y = y0 + labelH
      cellBg(x0, y)
      drawLift(ctx, [x0 + cellW * 0.3, y + cellH * 0.78], [x0 + cellW * 0.72, y + cellH * 0.18], 1.3, kind)
      label(x0 + cellW / 2, y + cellH - 12, name)
    })
  })
  return (
    <main className="screen wide">
      <h2 className="screen-title">Building levels</h2>
      <p className="note">Each upgrade changes how the building looks on the resort map. Level counts and
        stats are proposals; all costs are PLACEHOLDER. Sizes are exaggerated ×2 on the map for readability.</p>
      <div className="sheet-scroll"><canvas ref={ref} style={{ width: W, height: H }} /></div>
    </main>
  )
}

export function VillagePreview() {
  const params = new URLSearchParams(window.location.search)
  const [view, setView] = useState<View>((params.get('view') as View) || 'home1')
  const t = useTerrain()
  const views: [View, string][] = [['home1', 'Home · yr 1'], ['home2', 'Home · yr 8'], ['site', 'Base site'], ['levels', 'Levels']]
  return (
    <>
      {params.get('chrome') !== '0' && (
        <div className="preview-switch">
          {views.map(([v, l]) => <button key={v} className={v === view ? 'on' : ''} onClick={() => setView(v)}>{l}</button>)}
        </div>
      )}
      {view === 'levels' ? <LevelsSheet /> : !t ? <p className="note">Loading terrain…</p>
        : view === 'site' ? <SitePreview key="site" t={t} />
        : <HomePreview key={view} t={t} stage={view === 'home1' ? 1 : 2} />}
    </>
  )
}

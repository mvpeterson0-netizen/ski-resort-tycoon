/**
 * PREVIEW ONLY (owner review): the proposed bird's-eye home view, base-village siting,
 * and building level art. Reached with ?preview=village. Nothing here touches saves.
 * The resorts drawn are sample layouts generated from the real terrain, not a game state.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  accessRoadCostUsd, computeParcels, decodeDem, elevAt, planTrail, slopeDeg, suggestBaseSites, VILLAGE,
  type BaseSite, type Parcel, type Pt, type Road, type Terrain, type TerrainMeta,
} from '../../sim'
import { MapView, RENDER_SCALE } from '../MapView'
import {
  drawDiffSign, drawLabel, drawLift, drawParking, drawRoad, drawRoadLabel, drawSprite, drawTrailSwath, loadSprites,
  paintGround, paintTreeLayer, plantTrees, TREE_SCALE,
  type Diff, type LiftKind, type Sprites,
} from './art'
import { usd } from '../format'

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

/** Real roads (USGS NTD) for the site, preprocessed by scripts/build-site-roads.mjs. */
function useRoads() {
  const [roads, setRoads] = useState<Road[] | null>(null)
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}sites/${TERRAIN_ID}.roads.json`).then((r) => r.json()).then((d) => setRoads(d.roads)).catch(() => setRoads([]))
  }, [])
  return roads
}

function useSprites() {
  const [sp, setSp] = useState<Sprites | null>(null)
  useEffect(() => { loadSprites().then(setSp) }, [])
  return sp
}

/** The data names the south-west stretch of US-40 "W Park Ave"; show both as US-40. */
const roadLabel = (r: Road) => (/hwy 40|park ave/i.test(r.name) ? 'US-40' : r.name.replace(/\b(\w)(\w*)/g, (_, a, b) => a + b.toLowerCase()))

// ---------- sample resort layout from real terrain ----------

interface SampleLift { kind: LiftKind; bottom: Pt; top: Pt; name: string }
interface SampleTrail { pts: Pt[]; diff: Diff; name: string }
interface Layout {
  base: BaseSite
  /** Village centre (cells): the base spot pushed back from the road to leave room for parking. */
  v: Pt
  /** Unit vector from the road toward the village (cells), and along the road. */
  r: [number, number]
  tg: [number, number]
  join: Pt
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

function makeLayout(t: Terrain, stage: 1 | 2, roads: Road[]): Layout | null {
  const parcels = computeParcels(t)
  const access = parcels.find((p) => p.id === ACCESS)!
  const [base] = suggestBaseSites(t, access, 1, roads)
  if (!base) return null
  const land = stage === 1 ? [access] : parcels.filter((p) => ['r1c1', 'r0c1', 'r1c2', 'r1c0'].includes(p.id))
  const owned = land.map((p) => p.id)
  // Orientation from the road: r points from the road to the base, tg runs along the road.
  const join: Pt = base.roadJoin ?? [base.x, base.y + 10]
  let r: [number, number] = [base.x - join[0], base.y - join[1]]
  const rl = Math.hypot(...r) || 1
  r = [r[0] / rl, r[1] / rl]
  const tg: [number, number] = [-r[1], r[0]]
  const off = Math.max(rl * t.cellM, 110) // leave room for parking between road and lodge
  const v: Pt = [join[0] + (r[0] * off) / t.cellM, join[1] + (r[1] * off) / t.cellM]
  const at = (away: number, along: number): Pt => [v[0] + (r[0] * away + tg[0] * along) / t.cellM, v[1] + (r[1] * away + tg[1] * along) / t.cellM]
  const roadward = (Math.atan2(-r[0], r[1]) * 180) / Math.PI // heading back toward the road
  const lifts: SampleLift[] = []
  const trails: SampleTrail[] = []
  const b1 = at(60, -25)
  const first = findTop(t, b1, land, [roadward], stage === 1 ? 900 : 1200)
  if (!first) return null
  lifts.push({ kind: 'fixedDouble', bottom: b1, top: first.top, name: 'Summit Double' })
  trails.push(...trailsFor(t, first.top, at(45, 10), parcels, owned, ['Pass Run', 'Easy Street']))
  if (stage === 2) {
    const b2 = at(55, 45)
    const second = findTop(t, b2, land, [first.ang, roadward], 1100)
    if (second) {
      lifts.push({ kind: 'fixedQuad', bottom: b2, top: second.top, name: 'Divide Quad' })
      trails.push(...trailsFor(t, second.top, at(40, 60), parcels, owned, ['Continental', 'Timberline']))
    }
    lifts.push({ kind: 'ropeTow', bottom: at(30, -120), top: at(250, -130), name: 'Bunny Tow' })
    trails.push(...trailsFor(t, at(250, -130), at(25, -110), parcels, owned, ['Bunny Hill']))
  }
  return { base, v, r, tg, join, lifts, trails }
}

// ---------- drawing the resort ----------

interface VillageLevels { lodge: number; rentals: number; school: number; housing: number; parking: number; shop: number }

const NAMES: Record<string, string> = { lodge: 'Day Lodge', rentals: 'Rentals', school: 'Ski School', housing: 'Staff Housing', ticket: 'Tickets', shop: 'Maintenance' }
const TERMINAL: Record<LiftKind, number> = { ropeTow: 1, fixedDouble: 2, fixedQuad: 3 }

interface Item { kind: string; level: number; c: Pt; r: number }

/** Where each base-area building sits (cells) and its clearing radius (m). */
function villageItems(t: Terrain, L: Layout, lv: VillageLevels): { items: Item[]; lot: Pt } {
  const at = (away: number, along: number): Pt => [L.v[0] + (L.r[0] * away + L.tg[0] * along) / t.cellM, L.v[1] + (L.r[1] * away + L.tg[1] * along) / t.cellM]
  // Spacing grows with the lodge so a small base stays compact.
  const f = 0.55 + 0.12 * lv.lodge
  const items: Item[] = [
    { kind: 'lodge', level: lv.lodge, c: at(5, 0), r: 25 + 14 * lv.lodge },
    { kind: 'ticket', level: 1, c: at(45, 40 * f), r: 14 },
    { kind: 'rentals', level: lv.rentals, c: at(0, 95 * f), r: 32 },
    { kind: 'school', level: lv.school, c: at(22, -100 * f), r: 40 },
    { kind: 'housing', level: lv.housing, c: at(-30, 185 * f), r: 48 },
    { kind: 'shop', level: lv.shop, c: at(-30, -175 * f), r: 36 },
  ].filter((it) => it.level > 0)
  for (const l of L.lifts) items.push({ kind: 'terminal', level: TERMINAL[l.kind], c: l.bottom, r: 22 })
  return { items, lot: at(-70, 0) }
}

const segDist = (x: number, y: number, a: Pt, b: Pt) => {
  const vx = b[0] - a[0], vy = b[1] - a[1]
  const l2 = vx * vx + vy * vy
  const u = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / l2)) : 0
  return Math.hypot(x - a[0] - vx * u, y - a[1] - vy * u)
}

/** Trees that survive clearing for trails, lifts, roads, the village and parking. */
function clearTrees(t: Terrain, trees: Float32Array, L: Layout, lv: VillageLevels, roads: Road[]): Float32Array {
  const lines: [Pt, Pt, number][] = []
  const add = (pts: Pt[], halfM: number) => { for (let i = 1; i < pts.length; i++) lines.push([pts[i - 1], pts[i], halfM / t.cellM]) }
  for (const tr of L.trails) add(tr.pts, 26)
  for (const l of L.lifts) add([l.bottom, l.top], 10)
  for (const r of roads) for (const p of r.parts) add(p, 14)
  add([L.join, L.v], 12)
  const { items, lot } = villageItems(t, L, lv)
  const discs: [Pt, number][] = [...items.map((it): [Pt, number] => [it.c, (it.r + 16) / t.cellM]), [lot, (60 + 22 * lv.parking) / t.cellM]]
  const keep: number[] = []
  for (let i = 0; i < trees.length; i += 3) {
    const x = trees[i], y = trees[i + 1]
    if (discs.some(([c, r]) => Math.hypot(x - c[0], y - c[1]) < r)) continue
    if (lines.some(([a, b, h]) => Math.abs(x - a[0]) < 200 && segDist(x, y, a, b) < h)) continue
    keep.push(x, y, trees[i + 2])
  }
  return new Float32Array(keep)
}

/** Above this view scale, trees are drawn as 3D sprites instead of the painted layer. */
const TREE_SPRITE_SCALE = 2.6

function drawResort(ctx: CanvasRenderingContext2D, t: Terrain, L: Layout, lv: VillageLevels, scale: number, roads: Road[], sprites: Sprites, forest: { layer: HTMLCanvasElement; kept: Float32Array }) {
  const S = RENDER_SCALE
  const k = S / t.cellM // overlay px per metre
  const px = (p: Pt): [number, number] => [(p[0] + 0.5) * S, (p[1] + 0.5) * S]
  const at = (away: number, along: number) => px([L.v[0] + (L.r[0] * away + L.tg[0] * along) / t.cellM, L.v[1] + (L.r[1] * away + L.tg[1] * along) / t.cellM])

  const sprite = scale > TREE_SPRITE_SCALE
  if (!sprite) ctx.drawImage(forest.layer, 0, 0, t.width * S, t.height * S)
  for (const tr of L.trails) drawTrailSwath(ctx, tr.pts.map(px), k, tr.diff)
  const vi = villageItems(t, L, lv)
  const items = vi.items.map((it) => ({ ...it, p: px(it.c) }))
  const lot = px(vi.lot)

  // Plowed, trodden snow around everything built: soft overlapping discs.
  ctx.save()
  ctx.fillStyle = 'rgba(229, 232, 236, 0.97)'
  ctx.shadowColor = 'rgba(229, 232, 236, 0.95)'
  ctx.shadowBlur = 8 * k * scale
  for (const it of [...items, { p: lot, r: 48 + 18 * lv.parking }]) {
    ctx.beginPath(); ctx.arc(it.p[0], it.p[1], (it.r + 8) * k, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
  drawParking(ctx, lv.parking, ...lot, k, 0.7, -L.r[0], -L.r[1])

  // Real roads, then the access drive from the highway into the village.
  for (const road of roads) for (const part of road.parts) drawRoad(ctx, part.map(px), k, road.cls, scale)
  drawRoad(ctx, [px(L.join), at(-90, 0), at(-25, 0)], k, 5, scale)
  if (scale < 3) {
    const seen = new Set<string>()
    for (const road of [...roads].sort((a, b) => b.parts[0].length - a.parts[0].length)) {
      const name = roadLabel(road)
      if (!name || seen.has(name)) continue
      seen.add(name)
      drawRoadLabel(ctx, road.parts[0].map(px), name, scale)
    }
  }

  // Buildings: drawn north to south so nearer ones overlap farther ones.
  for (const l of L.lifts) drawLift(ctx, px(l.bottom), px(l.top), k, l.kind, 0, false)
  // Visible trees (sprite mode) join the buildings in one back-to-front list.
  const draw: { y: number; fn: () => void }[] = []
  const labels: [number, number, string, string][] = []
  for (const it of items) {
    draw.push({ y: it.p[1], fn: () => { drawSprite(ctx, sprites, `${it.kind}-${it.level}`, it.p[0], it.p[1], k) } })
    if (NAMES[it.kind]) labels.push([it.p[0], it.p[1] + 4 * k, NAMES[it.kind], it.kind === 'ticket' || it.kind === 'shop' ? '' : `Lv ${it.level}`])
  }
  if (sprite) {
    const m = ctx.getTransform().inverse()
    const a = m.transformPoint(new DOMPoint(0, 0)), b = m.transformPoint(new DOMPoint(ctx.canvas.width, ctx.canvas.height))
    const pad = 20 * k
    const kept = forest.kept
    for (let i = 0; i < kept.length; i += 3) {
      const x = (kept[i] + 0.5) * S, y = (kept[i + 1] + 0.5) * S
      if (x < a.x - pad || x > b.x + pad || y < a.y - pad || y > b.y + pad * 3) continue
      const v = 1 + ((i / 3) % 3)
      const sz = kept[i + 2] / 0.55
      draw.push({ y, fn: () => { drawSprite(ctx, sprites, `tree-${v}`, x, y, k, (TREE_SCALE / 2.4) * sz) } })
    }
  }
  draw.sort((p, q) => p.y - q.y)
  for (const d of draw) d.fn()
  for (const l of L.lifts) drawSprite(ctx, sprites, `terminal-${TERMINAL[l.kind]}`, ...px(l.top), k, 0.7)
  // Labels last so nothing covers them; skip any that would overlap one already placed,
  // and hide them all when zoomed far out.
  if (scale > 1.6) {
    for (const l of L.lifts) { const [x, y] = px(l.bottom); labels.push([x, y + 4 * k, l.name, '']) }
    const placed: [number, number, number, number][] = []
    const fs = 11 / scale
    ctx.font = `800 ${fs}px Nunito, sans-serif`
    for (const [x, y, text, sub] of labels) {
      const w = ctx.measureText(`${text} ${sub}`).width + fs * 1.4, h = fs * 1.8
      let yy = y
      // Nudge down up to twice to dodge a neighbour before giving up.
      for (let tries = 0; tries < 3; tries++, yy += h * 1.05) {
        const rect: [number, number, number, number] = [x - w / 2, yy, x + w / 2, yy + h]
        if (placed.some((q) => rect[0] < q[2] && rect[2] > q[0] && rect[1] < q[3] && rect[3] > q[1])) continue
        placed.push(rect)
        drawLabel(ctx, x, yy, text, scale, sub || undefined)
        break
      }
    }
  }
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

function HomePreview({ t, stage, roads, sprites }: { t: Terrain; stage: 1 | 2; roads: Road[]; sprites: Sprites }) {
  const layout = useMemo(() => makeLayout(t, stage, roads), [t, stage, roads])
  const levels: VillageLevels = stage === 1
    ? { lodge: 1, rentals: 0, school: 0, housing: 0, parking: 0, shop: 1 }
    : { lodge: 3, rentals: 2, school: 2, housing: 2, parking: 2, shop: 1 }
  const forest = useMemo(() => {
    const trees = plantTrees(t)
    return { layer: paintTreeLayer(t, trees), kept: layout ? clearTrees(t, trees, layout, levels, roads) : trees }
    // levels is constant per stage
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, layout, roads])
  const q = new URLSearchParams(window.location.search)
  const [showCard, setShowCard] = useState(stage === 2 && q.get('card') !== '0')
  if (!layout) return <p className="note">No base site found.</p>
  return (
    <MapView
      terrainId={TERRAIN_ID}
      bare
      base={paintGround}
      zoomBoost={3}
      focus={{ x: layout.v[0] + layout.r[0] * 1, y: layout.v[1] + layout.r[1] * 1 + 2, metresAcross: Number(q.get('across')) || (stage === 1 ? 230 : 420) }}
      onBack={() => {}}
      onTapCell={() => setShowCard((v) => !v)}
      overlay={(ctx, scale) => drawResort(ctx, t, layout, levels, scale, roads, sprites, forest)}
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

function SitePreview({ t, roads }: { t: Terrain; roads: Road[] }) {
  const parcels = useMemo(() => computeParcels(t), [t])
  const access = parcels.find((p) => p.id === ACCESS)!
  const sites = useMemo(() => suggestBaseSites(t, access, 3, roads), [t, access, roads])
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
        ctx.imageSmoothingEnabled = true
        const k = S / t.cellM
        for (const road of roads) for (const part of road.parts) drawRoad(ctx, part.map(([x, y]) => [(x + 0.5) * S, (y + 0.5) * S] as [number, number]), k, road.cls, scale)
        const named = new Set<string>()
        for (const road of [...roads].sort((a, b) => b.parts[0].length - a.parts[0].length)) {
          const nm = roadLabel(road)
          if (!nm || named.has(nm)) continue
          named.add(nm)
          drawRoadLabel(ctx, road.parts[0].map(([x, y]) => [(x + 0.5) * S, (y + 0.5) * S] as [number, number]), nm, scale)
        }
        // Planned access drive for each suggestion.
        for (const b of sites) if (b.roadJoin) {
          ctx.strokeStyle = '#2a5a92'
          ctx.lineWidth = 2.5 / scale
          ctx.setLineDash([5 / scale, 4 / scale])
          ctx.beginPath(); ctx.moveTo((b.roadJoin[0] + 0.5) * S, (b.roadJoin[1] + 0.5) * S); ctx.lineTo((b.x + 0.5) * S, (b.y + 0.5) * S); ctx.stroke()
          ctx.setLineDash([])
        }
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
              {s.roadName ? ` Access: ${s.roadM} m drive from ${/hwy 40|park ave/i.test(s.roadName) ? 'US-40' : s.roadName} (${usd(accessRoadCostUsd(s))}, PLACEHOLDER rate).` : ''}
              {' '}Green = flat enough to build on.
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
  const rows: [string, string, number][] = [
    ['lodge', 'Day lodge', 5], ['rentals', 'Rental shop', 3], ['school', 'Ski school', 3], ['housing', 'Staff housing', 4],
    ['terminal', 'Lift terminal (tow, double, quad)', 3], ['ticket', 'Ticket booth', 1], ['shop', 'Maintenance garage', 1],
  ]
  const base = `${import.meta.env.BASE_URL}sprites/`
  return (
    <main className="screen wide">
      <h2 className="screen-title">Building levels</h2>
      <p className="note">Pre-rendered 3D buildings: each upgrade changes how the building looks on the resort map.
        Level counts are proposals; all costs are PLACEHOLDER. Drawn ×2.4 life size on the map for readability.</p>
      {rows.map(([kind, name, n]) => (
        <section key={kind}>
          <h3 className="group">{name}</h3>
          <div className="sprite-row">
            {Array.from({ length: n }, (_, i) => (
              <figure key={i}><img src={`${base}${kind}-${i + 1}.png`} alt={`${name} level ${i + 1}`} /><figcaption>Level {i + 1}</figcaption></figure>
            ))}
          </div>
        </section>
      ))}
    </main>
  )
}

export function VillagePreview() {
  const params = new URLSearchParams(window.location.search)
  const [view, setView] = useState<View>((params.get('view') as View) || 'home1')
  const t = useTerrain()
  const roads = useRoads()
  const sprites = useSprites()
  const views: [View, string][] = [['home1', 'Home · yr 1'], ['home2', 'Home · yr 8'], ['site', 'Base site'], ['levels', 'Levels']]
  return (
    <>
      {params.get('chrome') !== '0' && (
        <div className="preview-switch">
          {views.map(([v, l]) => <button key={v} className={v === view ? 'on' : ''} onClick={() => setView(v)}>{l}</button>)}
        </div>
      )}
      {view === 'levels' ? <LevelsSheet /> : !t || !roads || !sprites ? <p className="note">Loading terrain…</p>
        : view === 'site' ? <SitePreview key="site" t={t} roads={roads} />
        : <HomePreview key={view} t={t} stage={view === 'home1' ? 1 : 2} roads={roads} sprites={sprites} />}
    </>
  )
}

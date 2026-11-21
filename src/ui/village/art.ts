/**
 * Bird's-eye art for the resort home view: painted terrain with trees, trail swaths,
 * lifts with towers and chairs, and base-village buildings whose look changes by level.
 *
 * All drawing is plain 2D canvas. Buildings use a simple oblique view (roof seen from
 * above, south wall visible) so they read as buildings on a top-down map without any
 * 3D engine. Building sizes are exaggerated (BUILDING_SCALE) so they stay readable on a
 * phone; this is a map convention, not real footprints.
 */
import { contourSegments, hillshade, slopeDeg, elevAtCell, type Road, type Terrain } from '../../sim'

/** Base image pixels per terrain cell for the painted terrain (higher = crisper trees). */
export const PAINT_SCALE = 5
/** PLACEHOLDER: approximate treeline (m). We have no land-cover data; trees are drawn
 *  below this elevation on skiable slopes, with noise. Not a measured forest boundary. */
export const TREELINE_M = 3500
/** Drawn buildings are this many times larger than life, for legibility. */
export const BUILDING_SCALE = 2

// ---------- deterministic noise (UI only; keeps trees stable between loads) ----------
function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function smooth(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1)
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
const fbm = (x: number, y: number) => 0.6 * smooth(x / 9, y / 9) + 0.4 * smooth(x / 3.5, y / 3.5)

// ---------- terrain ----------

/** Painted winter terrain with the forest baked in (zoomed-out views). */
export function paintTerrain(t: Terrain): HTMLCanvasElement {
  const cv = paintGround(t)
  cv.getContext('2d')!.drawImage(paintTreeLayer(t, plantTrees(t)), 0, 0, cv.width, cv.height)
  return cv
}

/**
 * Tree positions: [x, y, r] triples in cells (r = crown radius in cells), on a jittered
 * grid below the PLACEHOLDER treeline, thinning near it, absent on cliffs and in meadows.
 */
export function plantTrees(t: Terrain): Float32Array {
  const out: number[] = []
  const spacing = 0.9 // cells (~9 m)
  for (let gy = 0; gy < t.height; gy += spacing) {
    for (let gx = 0; gx < t.width; gx += spacing) {
      const jx = gx + (hash(gx * 10, gy * 10) - 0.5) * spacing
      const jy = gy + (hash(gy * 10 + 7, gx * 10) - 0.5) * spacing
      const cx = Math.round(jx), cy = Math.round(jy)
      if (cx < 1 || cy < 1 || cx >= t.width - 1 || cy >= t.height - 1) continue
      const e = elevAtCell(t, cx, cy)
      const n = fbm(jx, jy)
      const line = TREELINE_M + (n - 0.5) * 80
      if (e > line) continue
      const density = Math.min(1, (line - e) / 60) * (n > 0.32 ? 1 : 0.15)
      if (hash(gx * 13 + 1, gy * 17 + 3) > density) continue
      if (slopeDeg(t, cx, cy) > 36) continue
      out.push(jx, jy, (0.42 + 0.25 * hash(gx * 3, gy * 5)) * (e > line - 40 ? 0.75 : 1))
    }
  }
  return new Float32Array(out)
}

/** Forest as a transparent layer at PAINT_SCALE, batched by colour so it draws quickly. */
export function paintTreeLayer(t: Terrain, trees: Float32Array): HTMLCanvasElement {
  const S = PAINT_SCALE
  const cv = document.createElement('canvas')
  cv.width = t.width * S
  cv.height = t.height * S
  const ctx = cv.getContext('2d')!
  const shadows = new Path2D()
  const crowns = [new Path2D(), new Path2D(), new Path2D()]
  const tips = new Path2D()
  for (let i = 0; i < trees.length; i += 3) {
    const px = trees[i] * S, py = trees[i + 1] * S, r = trees[i + 2] * S
    shadows.moveTo(px + r * 0.8 + r, py + r * 0.6)
    shadows.ellipse(px + r * 0.8, py + r * 0.6, r * 1.05, r * 0.8, 0, 0, Math.PI * 2)
    const c = crowns[i % 3]
    c.moveTo(px + r, py)
    c.arc(px, py, r, 0, Math.PI * 2)
    tips.moveTo(px - r * 0.25 + r * 0.35, py - r * 0.3)
    tips.arc(px - r * 0.25, py - r * 0.3, r * 0.35, 0, Math.PI * 2)
  }
  ctx.fillStyle = 'rgba(40, 60, 90, 0.28)'
  ctx.fill(shadows)
  const greens = ['#2f5d45', '#36684b', '#2a5240']
  crowns.forEach((p, i) => { ctx.fillStyle = greens[i]; ctx.fill(p) })
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.fill(tips)
  return cv
}

/** Painted winter ground: snowy relief, rock on cliffs, faint contours; no trees. */
export function paintGround(t: Terrain): HTMLCanvasElement {
  const S = PAINT_SCALE
  // Two lights (strong north-west, soft south-west) and a contrast curve give the
  // slopes more definition than a single hillshade.
  const hsA = hillshade(t, 315, 35, 2.4)
  const hsB = hillshade(t, 225, 50, 1.5)
  const shade = new Float32Array(hsA.length)
  for (let i = 0; i < shade.length; i++) shade[i] = Math.max(0, Math.min(1, (0.72 * hsA[i] + 0.28 * hsB[i] - 0.5) * 1.35 + 0.56))
  const img = new ImageData(t.width, t.height)
  for (let y = 0; y < t.height; y++) {
    for (let x = 0; x < t.width; x++) {
      const i = y * t.width + x
      const s = shade[i]
      const steep = slopeDeg(t, x, y)
      // Snow: blue-grey in shadow to warm white in sun. Cliffs show rock.
      let r = 168 + 87 * s, g = 182 + 72 * s, b = 210 + 44 * s
      if (steep > 38) {
        const k = Math.min(1, (steep - 38) / 12) * 0.7
        r += (120 + 60 * s - r) * k; g += (112 + 55 * s - g) * k; b += (108 + 50 * s - b) * k
      }
      img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255
    }
  }
  const tmp = document.createElement('canvas')
  tmp.width = t.width
  tmp.height = t.height
  tmp.getContext('2d')!.putImageData(img, 0, 0)
  const cv = document.createElement('canvas')
  cv.width = t.width * S
  cv.height = t.height * S
  const ctx = cv.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(tmp, 0, 0, cv.width, cv.height)

  // Faint contours: a hint of the landform under the snow.
  let lo = Infinity, hi = -Infinity
  for (const e of t.elev) { lo = Math.min(lo, e); hi = Math.max(hi, e) }
  for (let lvl = Math.ceil(lo / 20) * 20; lvl <= hi; lvl += 20) {
    ctx.strokeStyle = lvl % 100 === 0 ? 'rgba(90,110,140,0.22)' : 'rgba(90,110,140,0.1)'
    ctx.lineWidth = lvl % 100 === 0 ? 1.6 : 1
    ctx.beginPath()
    for (const [x1, y1, x2, y2] of contourSegments(t, lvl)) {
      ctx.moveTo((x1 + 0.5) * S, (y1 + 0.5) * S)
      ctx.lineTo((x2 + 0.5) * S, (y2 + 0.5) * S)
    }
    ctx.stroke()
  }

  return cv
}

// ---------- trails and lifts (in overlay px; k = px per metre) ----------

export const DIFF = { green: '#3a9150', blue: '#2a68c4', black: '#26313a' } as const
export type Diff = keyof typeof DIFF

export function drawTrailSwath(ctx: CanvasRenderingContext2D, pts: [number, number][], k: number, diff: Diff, widthM = 40) {
  if (pts.length < 2) return
  const path = new Path2D()
  path.moveTo(...pts[0])
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2
    path.quadraticCurveTo(pts[i][0], pts[i][1], mx, my)
  }
  path.lineTo(...pts[pts.length - 1])
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // Cleared swath: groomed snow over the trees.
  ctx.strokeStyle = 'rgba(250, 252, 255, 0.92)'
  ctx.lineWidth = widthM * k
  ctx.stroke(path)
  // Corduroy hint and difficulty colour along the fall line.
  // Thin difficulty colour along the fall line.
  ctx.strokeStyle = DIFF[diff]
  ctx.globalAlpha = 0.7
  ctx.lineWidth = Math.max(1, widthM * k * 0.07)
  ctx.stroke(path)
  ctx.globalAlpha = 1
}

export function drawDiffSign(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, diff: Diff, label?: string) {
  ctx.save()
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = 'rgba(30,40,60,0.35)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(x - size * 0.7, y - size * 0.7, size * 1.4, size * 1.4, size * 0.3)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = DIFF[diff]
  const r = size * 0.42
  ctx.beginPath()
  if (diff === 'green') ctx.arc(x, y, r, 0, Math.PI * 2)
  else if (diff === 'blue') ctx.rect(x - r, y - r, r * 2, r * 2)
  else { ctx.moveTo(x, y - r * 1.25); ctx.lineTo(x + r * 1.25, y); ctx.lineTo(x, y + r * 1.25); ctx.lineTo(x - r * 1.25, y) }
  ctx.fill()
  if (label) {
    ctx.font = `800 ${size * 1.05}px Nunito, sans-serif`
    ctx.textBaseline = 'middle'
    ctx.lineWidth = size * 0.35
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.strokeText(label, x + size * 1.0, y)
    ctx.fillStyle = '#2b3a46'
    ctx.fillText(label, x + size * 1.0, y)
  }
  ctx.restore()
}

export type LiftKind = 'ropeTow' | 'fixedDouble' | 'fixedQuad'

/** A lift line from bottom to top (overlay px) with towers, cable and chairs. */
export function drawLift(ctx: CanvasRenderingContext2D, a: [number, number], b: [number, number], k: number, kind: LiftKind, phase = 0, terminals = true) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const len = Math.hypot(dx, dy)
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux
  const gauge = (kind === 'ropeTow' ? 2 : kind === 'fixedDouble' ? 4 : 5.5) * k * BUILDING_SCALE
  ctx.save()
  ctx.lineCap = 'round'
  // Narrow cut through the trees under the line.
  ctx.strokeStyle = 'rgba(248, 250, 253, 0.85)'
  ctx.lineWidth = (kind === 'ropeTow' ? 8 : 16) * k
  ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke()
  // Cable shadow, then the two cable lines.
  ctx.strokeStyle = 'rgba(30,40,60,0.18)'
  ctx.lineWidth = Math.max(1, gauge * 0.5)
  ctx.beginPath(); ctx.moveTo(a[0] + 3 * k, a[1] + 3 * k); ctx.lineTo(b[0] + 3 * k, b[1] + 3 * k); ctx.stroke()
  ctx.strokeStyle = '#3b4652'
  ctx.lineWidth = Math.max(0.6, 0.35 * k * BUILDING_SCALE)
  for (const s of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(a[0] + nx * gauge * s, a[1] + ny * gauge * s)
    ctx.lineTo(b[0] + nx * gauge * s, b[1] + ny * gauge * s)
    ctx.stroke()
  }
  // Towers.
  const spanPx = (kind === 'ropeTow' ? 60 : 110) * k
  const towers = Math.max(1, Math.round(len / spanPx))
  for (let i = 1; i < towers; i++) {
    const tx = a[0] + dx * (i / towers), ty = a[1] + dy * (i / towers)
    ctx.fillStyle = 'rgba(30,40,60,0.22)'
    ctx.fillRect(tx - gauge * 1.2 + 4 * k, ty - 1.2 * k + 4 * k, gauge * 2.4, 2.4 * k)
    ctx.strokeStyle = '#59636e'
    ctx.lineWidth = Math.max(1, 1.4 * k * BUILDING_SCALE)
    ctx.beginPath(); ctx.moveTo(tx - nx * gauge * 1.3, ty - ny * gauge * 1.3); ctx.lineTo(tx + nx * gauge * 1.3, ty + ny * gauge * 1.3); ctx.stroke()
    ctx.fillStyle = '#e4b33a'
    ctx.beginPath(); ctx.arc(tx, ty, Math.max(1, 1.3 * k * BUILDING_SCALE), 0, Math.PI * 2); ctx.fill()
  }
  // Chairs: up on one side, down on the other.
  if (kind !== 'ropeTow') {
    const gapPx = (kind === 'fixedQuad' ? 30 : 36) * k
    const seat = (kind === 'fixedQuad' ? 3.2 : 2.2) * k * BUILDING_SCALE
    for (let d = (phase * gapPx) % gapPx; d < len; d += gapPx) {
      for (const s of [-1, 1]) {
        const p = s < 0 ? d : len - d
        const cx = a[0] + ux * p + nx * gauge * s, cy = a[1] + uy * p + ny * gauge * s
        ctx.fillStyle = s < 0 ? '#c0503f' : '#7a3a30'
        ctx.fillRect(cx - seat / 2, cy - seat * 0.3, seat, seat * 0.6)
      }
    }
  }
  ctx.restore()
  if (!terminals) return
  // Terminals.
  const big = kind === 'ropeTow' ? 0.5 : kind === 'fixedDouble' ? 1 : 1.3
  box(ctx, a[0], a[1], 12 * big, 8 * big, 4 * big, k, { wall: '#6d7884', roof: 'flat', trim: '#3b4652' })
  box(ctx, b[0], b[1], 9 * big, 6 * big, 3.5 * big, k, { wall: '#6d7884', roof: 'flat', trim: '#3b4652' })
}

// ---------- buildings ----------

interface BoxStyle {
  wall: string
  roof: 'gable' | 'flat' | 'aframe'
  /** Metal roof colour showing at the eaves under the snow. */
  roofColour?: string
  trim?: string
  windows?: number
  stone?: boolean
  chimney?: boolean
}

/**
 * One building in oblique view. (x, y) = footprint centre on the ground, in overlay px.
 * w = east-west, d = north-south, h = wall height, all in metres (scaled by k and
 * BUILDING_SCALE). Depth is foreshortened so the south wall reads clearly.
 */
export function box(ctx: CanvasRenderingContext2D, x: number, y: number, wM: number, dM: number, hM: number, k: number, st: BoxStyle) {
  const s = k * BUILDING_SCALE
  const w = wM * s, d = dM * s * 0.6, h = hM * s * 1.25
  const L = x - w / 2, R = x + w / 2, N = y - d / 2, Sth = y + d / 2
  const top = N - h // roof's north edge (eave line)
  const eave = Sth - h // roof's south edge = top of the south wall
  const rise = st.roof === 'flat' ? 0 : st.roof === 'aframe' ? Math.min(w * 0.45, h * 1.4) : d * 0.35
  const metal = st.roofColour ?? '#7a3a30'
  ctx.save()
  // Soft shadow toward the south-east (sun from the north-west, as in the hillshade).
  ctx.fillStyle = 'rgba(30, 45, 70, 0.2)'
  const sh = (h + rise) * 0.45
  ctx.beginPath()
  ctx.moveTo(R, top); ctx.lineTo(R + sh, top + sh * 0.6); ctx.lineTo(R + sh, Sth + sh * 0.6); ctx.lineTo(L + sh, Sth + sh * 0.6); ctx.lineTo(L, Sth)
  ctx.lineTo(R, Sth); ctx.closePath()
  ctx.fill()

  if (st.roof === 'aframe') {
    // Ridge runs north-south: west slope lit, east slope shaded, triangular gable on the south face.
    const ridgeTop = top - rise, ridgeFront = eave - rise
    ctx.fillStyle = metal
    ctx.beginPath(); ctx.moveTo(L - s, eave + s * 0.6); ctx.lineTo(x, ridgeFront); ctx.lineTo(R + s, eave + s * 0.6); ctx.lineTo(R + s, top + s * 0.6); ctx.lineTo(x, ridgeTop); ctx.lineTo(L - s, top + s * 0.6); ctx.closePath(); ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.moveTo(L + s * 0.2, eave - s * 0.2); ctx.lineTo(x, ridgeFront); ctx.lineTo(x, ridgeTop); ctx.lineTo(L + s * 0.2, top - s * 0.2); ctx.closePath(); ctx.fill()
    ctx.fillStyle = '#d4dde9'
    ctx.beginPath(); ctx.moveTo(R - s * 0.2, eave - s * 0.2); ctx.lineTo(x, ridgeFront); ctx.lineTo(x, ridgeTop); ctx.lineTo(R - s * 0.2, top - s * 0.2); ctx.closePath(); ctx.fill()
    // South wall with the gable triangle and a tall window.
    ctx.fillStyle = st.wall
    ctx.beginPath(); ctx.moveTo(L, Sth); ctx.lineTo(L, eave); ctx.lineTo(x, ridgeFront + s * 1.2); ctx.lineTo(R, eave); ctx.lineTo(R, Sth); ctx.closePath(); ctx.fill()
    ctx.fillStyle = '#ffd98a'
    ctx.beginPath(); ctx.moveTo(x - w * 0.18, eave + h * 0.15); ctx.lineTo(x, ridgeFront + rise * 0.45); ctx.lineTo(x + w * 0.18, eave + h * 0.15); ctx.closePath(); ctx.fill()
  } else {
    // South wall first; the roof sits on top of it.
    ctx.fillStyle = st.wall
    ctx.fillRect(L, eave, w, h)
    if (st.roof === 'flat') {
      ctx.fillStyle = '#e9eef5'
      ctx.fillRect(L, top, w, d)
      ctx.strokeStyle = st.trim ?? '#5a3d2b'
      ctx.lineWidth = Math.max(0.6, s * 0.4)
      ctx.strokeRect(L, top, w, d)
    } else {
      // Ridge east-west: lit north slope behind, shaded south slope in front, metal at the eaves.
      const ridge = top + d * 0.5 - rise
      ctx.fillStyle = metal
      ctx.beginPath(); ctx.moveTo(L - s, top); ctx.lineTo(R + s, top); ctx.lineTo(R + s, ridge); ctx.lineTo(L - s, ridge); ctx.closePath(); ctx.fill()
      ctx.beginPath(); ctx.moveTo(L - s, ridge); ctx.lineTo(R + s, ridge); ctx.lineTo(R + s, eave + s * 0.8); ctx.lineTo(L - s, eave + s * 0.8); ctx.closePath(); ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(L, top + s * 0.3, w, ridge - top - s * 0.3)
      ctx.fillStyle = '#d4dde9'
      ctx.fillRect(L, ridge, w, eave - ridge - s * 0.2)
      ctx.strokeStyle = 'rgba(60,70,90,0.4)'
      ctx.lineWidth = Math.max(0.5, s * 0.25)
      ctx.beginPath(); ctx.moveTo(L - s, ridge); ctx.lineTo(R + s, ridge); ctx.stroke()
    }
  }
  if (st.stone) {
    ctx.fillStyle = '#9a9488'
    ctx.fillRect(L, Sth - h * 0.3, w, h * 0.3)
  }
  // Windows (warm light) and a door.
  const nWin = st.windows ?? Math.max(1, Math.round(wM / 7))
  if (st.roof !== 'aframe' && h > 3) {
    ctx.fillStyle = '#ffd98a'
    const ww = Math.max(1, (w / nWin) * 0.36), wh = Math.max(1, h * 0.3)
    for (let i = 0; i < nWin; i++) ctx.fillRect(L + (w / nWin) * (i + 0.5) - ww / 2, eave + h * 0.22, ww, wh)
  }
  ctx.fillStyle = '#4a3324'
  ctx.fillRect(x - s * 0.9, Sth - h * 0.38, s * 1.8, h * 0.38)
  if (st.chimney) {
    ctx.fillStyle = '#8b7d6e'
    ctx.fillRect(L + w * 0.75, top - rise * 0.5 - s * 2.2, s * 1.6, s * 2.6)
  }
  ctx.restore()
}

function deck(ctx: CanvasRenderingContext2D, x: number, y: number, wM: number, dM: number, k: number, tables: number) {
  const s = k * BUILDING_SCALE
  ctx.fillStyle = '#b98b5e'
  ctx.fillRect(x - (wM * s) / 2, y, wM * s, dM * s)
  ctx.fillStyle = '#7a5537'
  for (let i = 0; i < tables; i++) {
    const tx = x - (wM * s) / 2 + ((i % 6) + 0.5) * ((wM * s) / 6)
    const ty = y + (Math.floor(i / 6) + 0.5) * s * 3
    ctx.beginPath(); ctx.arc(tx, ty, s * 0.7, 0, Math.PI * 2); ctx.fill()
  }
}

function flag(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, colour = '#c0503f') {
  const s = k * BUILDING_SCALE
  ctx.strokeStyle = '#59636e'
  ctx.lineWidth = Math.max(0.6, s * 0.3)
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - s * 9); ctx.stroke()
  ctx.fillStyle = colour
  ctx.fillRect(x, y - s * 9, s * 3.5, s * 2.2)
}

export type BuildingKind = 'lodge' | 'rentals' | 'school' | 'housing' | 'ticket' | 'shop'

/** Number of visual levels per building (level 0 = not built). */
export const BUILDING_LEVELS: Record<BuildingKind, number> = { lodge: 5, rentals: 3, school: 3, housing: 4, ticket: 1, shop: 1 }

/** Draw a base-area building at its level. (x, y) = ground centre, overlay px. */
export function drawBuilding(ctx: CanvasRenderingContext2D, kind: BuildingKind, level: number, x: number, y: number, k: number) {
  const s = k * BUILDING_SCALE
  const wood = '#8a5a3c', red = '#a8473a', cream = '#d9c8a5', navy = '#3b5570'
  if (level <= 0) return
  switch (kind) {
    case 'lodge':
      if (level === 1) {
        box(ctx, x, y, 14, 10, 4, k, { wall: wood, roof: 'gable', chimney: true, windows: 2 })
      } else if (level === 2) {
        deck(ctx, x, y + 9 * s, 26, 6, k, 6)
        box(ctx, x, y, 28, 16, 6, k, { wall: wood, roof: 'aframe', chimney: true, windows: 4 })
      } else if (level === 3) {
        deck(ctx, x - 4 * s, y + 11 * s, 32, 8, k, 10)
        box(ctx, x + 20 * s, y + 2 * s, 16, 12, 5, k, { wall: wood, roof: 'gable', windows: 2 })
        box(ctx, x - 4 * s, y, 32, 20, 7, k, { wall: wood, roof: 'aframe', chimney: true, windows: 5 })
        flag(ctx, x - 26 * s, y + 10 * s, k)
      } else if (level === 4) {
        deck(ctx, x, y + 13 * s, 52, 9, k, 16)
        box(ctx, x - 30 * s, y + 3 * s, 18, 14, 6, k, { wall: wood, roof: 'gable', stone: true, windows: 2 })
        box(ctx, x + 30 * s, y + 3 * s, 18, 14, 6, k, { wall: wood, roof: 'gable', stone: true, windows: 2 })
        box(ctx, x, y, 42, 24, 10, k, { wall: wood, roof: 'gable', stone: true, chimney: true, windows: 6 })
        box(ctx, x, y - 14 * s, 6, 6, 6, k, { wall: cream, roof: 'aframe', windows: 1 }) // cupola
        flag(ctx, x - 42 * s, y + 13 * s, k)
      } else {
        // Plaza with pavers and a fire pit, then the grand lodge.
        ctx.fillStyle = '#d8cbb4'
        ctx.beginPath(); ctx.roundRect(x - 48 * s, y + 10 * s, 96 * s, 26 * s, 6 * s); ctx.fill()
        ctx.fillStyle = '#e07a3a'
        ctx.beginPath(); ctx.arc(x, y + 26 * s, 2.4 * s, 0, Math.PI * 2); ctx.fill()
        deck(ctx, x - 22 * s, y + 13 * s, 30, 8, k, 12)
        deck(ctx, x + 22 * s, y + 13 * s, 30, 8, k, 12)
        box(ctx, x - 38 * s, y + 2 * s, 20, 16, 8, k, { wall: wood, roof: 'gable', stone: true, windows: 3 })
        box(ctx, x + 38 * s, y + 2 * s, 20, 16, 8, k, { wall: wood, roof: 'gable', stone: true, windows: 3 })
        box(ctx, x, y - 4 * s, 56, 28, 12, k, { wall: wood, roof: 'gable', stone: true, chimney: true, windows: 8 })
        box(ctx, x, y - 20 * s, 8, 8, 8, k, { wall: cream, roof: 'aframe', windows: 1 })
        flag(ctx, x - 50 * s, y + 12 * s, k)
        flag(ctx, x + 50 * s, y + 12 * s, k, navy)
      }
      return
    case 'rentals':
      if (level === 1) {
        box(ctx, x, y, 10, 7, 3.5, k, { wall: navy, roof: 'gable', roofColour: '#26313a', windows: 1 })
      } else if (level === 2) {
        box(ctx, x, y, 18, 10, 4.5, k, { wall: navy, roof: 'gable', roofColour: '#26313a', windows: 3 })
      } else {
        box(ctx, x, y, 26, 12, 5.5, k, { wall: navy, roof: 'gable', roofColour: '#26313a', stone: true, windows: 4 })
      }
      // Ski rack in front.
      ctx.fillStyle = '#c0503f'
      for (let i = 0; i < 2 + level * 2; i++) ctx.fillRect(x - level * 4 * s + i * 2.2 * s, y + 7 * s, s * 0.6, s * 2.5)
      return
    case 'school': {
      // Magic carpet running uphill (north) plus a hut, growing with level.
      const len = (8 + level * 5) * s
      ctx.fillStyle = 'rgba(58,145,80,0.18)'
      ctx.beginPath(); ctx.roundRect(x + 6 * s, y - len - 2 * s, (6 + level * 3) * s, len + 4 * s, 3 * s); ctx.fill()
      ctx.fillStyle = '#4a5866'
      for (let i = 0; i < Math.min(level, 2); i++) ctx.fillRect(x + (8 + i * 4) * s, y - len, 1.2 * s, len)
      // Little cones marking the learning area.
      ctx.fillStyle = '#e07a3a'
      for (let i = 0; i < level * 2; i++) ctx.fillRect(x + (7 + (i % 2) * (4 + level * 2)) * s, y - len + (i >> 1) * (len / level / 2), 0.8 * s, 0.8 * s)
      if (level === 1) box(ctx, x, y, 9, 7, 3.5, k, { wall: red, roof: 'gable', windows: 1 })
      else if (level === 2) box(ctx, x - 2 * s, y, 16, 10, 4.5, k, { wall: red, roof: 'gable', windows: 3 })
      else box(ctx, x - 4 * s, y, 22, 12, 5.5, k, { wall: red, roof: 'aframe', windows: 4 })
      flag(ctx, x - 12 * s, y + 6 * s, k, '#3a9150')
      return
    }
    case 'housing':
      if (level === 1) {
        for (let i = 0; i < 3; i++) box(ctx, x - 12 * s + i * 12 * s, y, 4, 12, 3, k, { wall: '#c9c2b3', roof: 'flat', windows: 1, trim: '#6b7882' })
      } else {
        const n = level - 1
        const spots = n === 1 ? [[0, 0]] : n === 2 ? [[-13, -4], [13, 4]] : [[-13, -10], [13, -10], [0, 6]]
        for (const [ox, oy] of spots) {
          box(ctx, x + ox * s, y + oy * s, 22, 12, 5 + level, k, { wall: cream, roof: 'gable', roofColour: '#3b5570', windows: 4, trim: '#6b5a44' })
        }
      }
      return
    case 'ticket':
      box(ctx, x, y, 6, 5, 3, k, { wall: red, roof: 'gable', windows: 1 })
      return
    case 'shop':
      box(ctx, x, y, 14, 10, 4.5, k, { wall: '#7a7f86', roof: 'flat', windows: 1, trim: '#3b4652' })
      return
  }
}

/** Parking: a gravel lot (level 0) plus paved lots per level, with cars by fullness. */
export function drawParking(ctx: CanvasRenderingContext2D, level: number, x: number, y: number, k: number, fullness = 0.6, ux = 0, uy = -1) {
  const s = k // parking is drawn at true scale; it is already large
  // Lots stack downhill (away from the mountain) and to the side.
  const lots: [number, number, number, number][] = [[0, 0, 70, 40]]
  const slots: [number, number][] = [[-75, 0], [75, 0], [-150, 0], [150, 0]]
  for (let i = 0; i < level; i++) lots.push([...slots[i], 70, 40])
  const nx = -uy, ny = ux
  lots.forEach(([ox, oy, w, d], i) => {
    // ox = sideways, oy = downhill; rotate into the map frame.
    const cx = x + (nx * ox - ux * oy) * s, cy = y + (ny * ox - uy * oy) * s
    ctx.fillStyle = i === 0 ? '#cdbfa6' : '#a9adb2'
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth = Math.max(1, 2 * s)
    ctx.beginPath(); ctx.roundRect(cx - (w * s) / 2, cy - (d * s) / 2, w * s, d * s, 4 * s); ctx.fill(); ctx.stroke()
    const colours = ['#c0503f', '#2a68c4', '#e4b33a', '#ffffff', '#26313a', '#7a8590']
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 12; c++) {
        if (hash(i * 97 + r * 13, c * 7) > fullness) continue
        ctx.fillStyle = colours[Math.floor(hash(c + i * 5, r * 3) * colours.length)]
        ctx.fillRect(cx - (w * s) / 2 + (c + 0.6) * ((w * s) / 12.5), cy - (d * s) / 2 + (r * 9 + 4) * s, 3 * s, 5 * s)
      }
    }
  })
}

// ---------- pre-rendered building sprites (see tools/sprites/) ----------

export interface SpriteMeta { w: number; h: number; ax: number; ay: number; pxPerM: number }
export type Sprites = Map<string, { img: HTMLImageElement; meta: SpriteMeta }>
/** Sprites are drawn this many times larger than life on the map (legibility). */
export const SPRITE_SCALE = 2.0
/** Trees are drawn a little larger than life too, so they sit with the buildings. */
export const TREE_SCALE = 1.3

/** Load all building sprites listed in public/sprites/sprites.json. */
export async function loadSprites(): Promise<Sprites> {
  const base = `${import.meta.env.BASE_URL}sprites/`
  const manifest: Record<string, SpriteMeta> = await (await fetch(`${base}sprites.json`)).json()
  const out: Sprites = new Map()
  await Promise.all(Object.entries(manifest).map(([name, meta]) => new Promise<void>((resolve) => {
    const img = new Image()
    img.onload = () => { out.set(name, { img, meta }); resolve() }
    img.onerror = () => resolve()
    img.src = `${base}${name}.png`
  })))
  return out
}

/** Draw a sprite with its ground anchor at (x, y); k = overlay px per metre. Returns its top y. */
export function drawSprite(ctx: CanvasRenderingContext2D, sprites: Sprites, name: string, x: number, y: number, k: number, extra = 1): number | null {
  const s = sprites.get(name)
  if (!s) return null
  const f = (k * SPRITE_SCALE * extra) / s.meta.pxPerM
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(s.img, x - s.meta.ax * f, y - s.meta.ay * f, s.meta.w * f, s.meta.h * f)
  return y - s.meta.ay * f
}

/** A name label pill, drawn at constant screen size (fontPx / view scale). */
export function drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, scale: number, sub?: string) {
  const fs = 11 / scale
  ctx.save()
  ctx.font = `800 ${fs}px Nunito, sans-serif`
  const w = ctx.measureText(text).width + (sub ? ctx.measureText(` ${sub}`).width : 0) + fs * 1.2
  const h = fs * 1.7
  ctx.fillStyle = 'rgba(255,253,248,0.94)'
  ctx.strokeStyle = 'rgba(43,58,70,0.25)'
  ctx.lineWidth = 1 / scale
  ctx.beginPath(); ctx.roundRect(x - w / 2, y, w, h, h / 2); ctx.fill(); ctx.stroke()
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillStyle = '#2b3a46'
  const tx = x - w / 2 + fs * 0.6
  ctx.fillText(text, tx, y + h / 2 + fs * 0.05)
  if (sub) {
    ctx.fillStyle = '#2a5a92'
    ctx.fillText(` ${sub}`, tx + ctx.measureText(text).width, y + h / 2 + fs * 0.05)
  }
  ctx.restore()
}

// ---------- roads ----------

function roadPath(pts: [number, number][]): Path2D {
  const p = new Path2D()
  p.moveTo(...pts[0])
  for (let i = 1; i < pts.length; i++) p.lineTo(...pts[i])
  return p
}

/**
 * A plowed winter road: snowbanks, asphalt, and a centre line on big roads.
 * pts in overlay px; k = px per metre. cls = NTD class (lower = bigger road).
 */
export function drawRoad(ctx: CanvasRenderingContext2D, pts: [number, number][], k: number, cls: number, scale: number) {
  if (pts.length < 2) return
  const major = cls <= 3
  const wM = major ? 9 : 6
  const path = roadPath(pts)
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = 'rgba(214, 222, 232, 0.95)' // plowed banks
  ctx.lineWidth = Math.max(wM * k + 8 * k, 3 / scale)
  ctx.stroke(path)
  ctx.strokeStyle = major ? '#6f747a' : '#8a8e93'
  ctx.lineWidth = Math.max(wM * k, 2 / scale)
  ctx.stroke(path)
  if (major && scale * k > 0.4) {
    ctx.strokeStyle = '#e4b33a'
    ctx.lineWidth = Math.max(0.35 * k, 0.6 / scale)
    ctx.setLineDash([3 * k, 3 * k])
    ctx.stroke(path)
    ctx.setLineDash([])
  }
  ctx.restore()
}

/** Road name at the middle of its longest part, along the road. */
export function drawRoadLabel(ctx: CanvasRenderingContext2D, pts: [number, number][], text: string, scale: number) {
  if (pts.length < 2 || !text) return
  const i = Math.floor(pts.length / 2)
  const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]
  let ang = Math.atan2(b[1] - a[1], b[0] - a[0])
  if (ang > Math.PI / 2) ang -= Math.PI
  if (ang < -Math.PI / 2) ang += Math.PI
  const fs = 10 / scale
  ctx.save()
  ctx.translate(...pts[i])
  ctx.rotate(ang)
  ctx.font = `800 ${fs}px Nunito, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = fs * 0.35
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  ctx.strokeText(text, 0, -fs * 1.1)
  ctx.fillStyle = '#4a5866'
  ctx.fillText(text, 0, -fs * 1.1)
  ctx.restore()
}

export type { Road }

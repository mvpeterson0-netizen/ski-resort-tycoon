import { useEffect, useRef, useState, type ReactNode } from 'react'
import { contourSegments, decodeDem, elevAt, hillshade, slopeDeg, type Terrain, type TerrainMeta } from '../sim'

/** Offscreen pixels per terrain cell. Overlays draw in these units. */
export const RENDER_SCALE = 2
const MINOR_CONTOUR_M = 20
const INDEX_CONTOUR_M = 100
const MAX_ZOOM = 8

/** Where the map opens: a terrain cell and how many metres fit across the screen. */
export interface MapFocus { x: number; y: number; metresAcross: number }

type View = { scale: number; tx: number; ty: number }
type Probe = { x: number; y: number; elev: number; slope: number }

async function loadTerrain(id: string): Promise<{ meta: TerrainMeta; terrain: Terrain }> {
  const base = `${import.meta.env.BASE_URL}sites/${id}`
  const meta: TerrainMeta = await (await fetch(`${base}.json`)).json()
  const buf = await (await fetch(`${base}.dem.bin`)).arrayBuffer()
  return { meta, terrain: decodeDem(buf, meta.width, meta.height, meta.cellM) }
}

/** Read an "r g b" CSS custom property from the active theme. */
function cssRgb(name: string, fallback: [number, number, number]): [number, number, number] {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).map(Number)
  return v.length === 3 && v.every((n) => Number.isFinite(n)) ? (v as [number, number, number]) : fallback
}

/** Canvas background outside the terrain; read from the theme when the map renders. */
let mapBg = '#e9e3d4'

/** Render shaded relief + contours once into an offscreen canvas, in the theme's map colours. */
function renderBase(t: Terrain): HTMLCanvasElement {
  mapBg = getComputedStyle(document.documentElement).getPropertyValue('--map-bg').trim() || mapBg
  const lit = cssRgb('--map-light', [255, 253, 250])
  const dark = cssRgb('--map-shadow', [120, 135, 165])
  const [cr, cg, cb] = cssRgb('--contour', [110, 80, 50])
  const S = RENDER_SCALE
  const cv = document.createElement('canvas')
  cv.width = t.width * S
  cv.height = t.height * S
  const ctx = cv.getContext('2d')!
  const shade = hillshade(t, 315, 40, 1.4)
  const img = ctx.createImageData(t.width, t.height)
  for (let i = 0; i < shade.length; i++) {
    // Blend from the theme's shadow colour (s = 0) to its lit colour (s = 1).
    const s = shade[i]
    img.data[i * 4] = dark[0] + (lit[0] - dark[0]) * s
    img.data[i * 4 + 1] = dark[1] + (lit[1] - dark[1]) * s
    img.data[i * 4 + 2] = dark[2] + (lit[2] - dark[2]) * s
    img.data[i * 4 + 3] = 255
  }
  const tmp = document.createElement('canvas')
  tmp.width = t.width
  tmp.height = t.height
  tmp.getContext('2d')!.putImageData(img, 0, 0)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(tmp, 0, 0, cv.width, cv.height)

  let min = Infinity
  let max = -Infinity
  for (const e of t.elev) { min = Math.min(min, e); max = Math.max(max, e) }
  for (let lvl = Math.ceil(min / MINOR_CONTOUR_M) * MINOR_CONTOUR_M; lvl <= max; lvl += MINOR_CONTOUR_M) {
    const index = lvl % INDEX_CONTOUR_M === 0
    ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, ${index ? 0.75 : 0.35})`
    ctx.lineWidth = index ? 1.4 : 0.7
    ctx.beginPath()
    // +0.5: grid values sit at cell centres.
    for (const [x1, y1, x2, y2] of contourSegments(t, lvl)) {
      ctx.moveTo((x1 + 0.5) * S, (y1 + 0.5) * S)
      ctx.lineTo((x2 + 0.5) * S, (y2 + 0.5) * S)
    }
    ctx.stroke()
  }
  return cv
}

export interface MapViewProps {
  terrainId: string
  onBack: () => void
  backLabel?: string
  /** Draws on top of the terrain, in base-image pixels (RENDER_SCALE per cell). */
  overlay?: (ctx: CanvasRenderingContext2D, viewScale: number) => void
  /** If set, taps go here (terrain cell coords) instead of the elevation readout. */
  onTapCell?: (x: number, y: number) => void
  onTerrain?: (t: Terrain) => void
  /** Content shown between the map and the action bar. */
  panel?: ReactNode
  /** Replaces the default Back button. */
  actions?: ReactNode
  /** Drawing mode: one finger draws a stroke (cells), two fingers still pan/zoom. */
  drawing?: boolean
  onStrokeMove?: (pts: [number, number][]) => void
  onStrokeEnd?: (pts: [number, number][]) => void
  /** Custom base image covering the whole terrain (any resolution). Default: relief + contours. */
  base?: (t: Terrain) => HTMLCanvasElement
  /** Open centred here instead of filling the screen with the whole terrain. */
  focus?: MapFocus
  /** Hide the title header (the home view draws its own HUD). */
  bare?: boolean
  /** Extra zoom allowed beyond the default (multiplies MAX_ZOOM). */
  zoomBoost?: number
  /** Overlays above the canvas (HUD, popups). */
  children?: ReactNode
}

export function MapView({
  terrainId, onBack, backLabel = 'Back to site', overlay, onTapCell, onTerrain, panel, actions,
  drawing, onStrokeMove, onStrokeEnd, base: makeBase, focus, bare, zoomBoost = 1, children,
}: MapViewProps) {
  const maxZoom = MAX_ZOOM * zoomBoost
  const focusRef = useRef(focus)
  const makeBaseRef = useRef(makeBase)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const baseRef = useRef<HTMLCanvasElement | null>(null)
  const terrainRef = useRef<Terrain | null>(null)
  const viewRef = useRef<View>({ scale: 1, tx: 0, ty: 0 })
  const fitRef = useRef(1)
  const [meta, setMeta] = useState<TerrainMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [probe, setProbe] = useState<Probe | null>(null)
  const [, setTick] = useState(0) // re-render overlay (scale bar) after zoom
  const overlayRef = useRef(overlay)
  const onTapRef = useRef(onTapCell)
  const onTerrainRef = useRef(onTerrain)
  const drawRef = useRef({ drawing, onStrokeMove, onStrokeEnd })
  useEffect(() => {
    overlayRef.current = overlay
    onTapRef.current = onTapCell
    onTerrainRef.current = onTerrain
    drawRef.current = { drawing, onStrokeMove, onStrokeEnd }
    focusRef.current = focus
    draw()
  })

  const draw = () => {
    const cv = canvasRef.current
    const base = baseRef.current
    if (!cv || !base) return
    const dpr = window.devicePixelRatio || 1
    const ctx = cv.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = mapBg
    ctx.fillRect(0, 0, cv.width, cv.height)
    const { scale, tx, ty } = viewRef.current
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * tx, dpr * ty)
    ctx.imageSmoothingQuality = 'high'
    const t = terrainRef.current!
    ctx.drawImage(base, 0, 0, t.width * RENDER_SCALE, t.height * RENDER_SCALE)
    overlayRef.current?.(ctx, scale)
  }

  /** Keep at least part of the map on screen and zoom within limits. */
  const clampView = () => {
    const cv = canvasRef.current
    const base = baseRef.current
    if (!cv || !base) return
    const v = viewRef.current
    const w = cv.clientWidth
    const h = cv.clientHeight
    const t = terrainRef.current!
    v.scale = Math.min(Math.max(v.scale, fitRef.current), fitRef.current * maxZoom)
    const mw = t.width * RENDER_SCALE * v.scale
    const mh = t.height * RENDER_SCALE * v.scale
    v.tx = mw <= w ? (w - mw) / 2 : Math.min(0, Math.max(w - mw, v.tx))
    v.ty = mh <= h ? (h - mh) / 2 : Math.min(0, Math.max(h - mh, v.ty))
  }

  // Load data and build the base image.
  useEffect(() => {
    let cancelled = false
    loadTerrain(terrainId)
      .then(({ meta, terrain }) => {
        if (cancelled) return
        terrainRef.current = terrain
        baseRef.current = makeBaseRef.current ? makeBaseRef.current(terrain) : renderBase(terrain)
        onTerrainRef.current?.(terrain)
        setMeta(meta)
      })
      .catch((e: unknown) => !cancelled && setError(String(e)))
    return () => { cancelled = true }
  }, [terrainId])

  // Size canvas to its box, fit the map, and wire up gestures.
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !meta) return

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      cv.width = Math.round(cv.clientWidth * dpr)
      cv.height = Math.round(cv.clientHeight * dpr)
      const t = terrainRef.current!
      const bw = t.width * RENDER_SCALE
      const bh = t.height * RENDER_SCALE
      fitRef.current = Math.min(cv.clientWidth / bw, cv.clientHeight / bh)
      if (first) {
        first = false
        const f = focusRef.current
        if (f) {
          // Centre on the focus cell with the requested width of ground on screen.
          const scale = (cv.clientWidth * t.cellM) / (f.metresAcross * RENDER_SCALE)
          viewRef.current = {
            scale,
            tx: cv.clientWidth / 2 - (f.x + 0.5) * RENDER_SCALE * scale,
            ty: cv.clientHeight / 2 - (f.y + 0.5) * RENDER_SCALE * scale,
          }
        } else {
          // Open filling the screen (cover); pinching out still shows the whole parcel.
          const cover = Math.max(cv.clientWidth / bw, cv.clientHeight / bh)
          viewRef.current = { scale: cover, tx: (cv.clientWidth - bw * cover) / 2, ty: (cv.clientHeight - bh * cover) / 2 }
        }
      }
      clampView()
      draw()
      setTick((n) => n + 1)
    }
    let first = true
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(cv)

    const pointers = new Map<number, { x: number; y: number }>()
    let moved = 0
    let last: { cx: number; cy: number; dist: number } | null = null
    const local = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const summary = () => {
      const ps = [...pointers.values()]
      const cx = ps.reduce((s, p) => s + p.x, 0) / ps.length
      const cy = ps.reduce((s, p) => s + p.y, 0) / ps.length
      const dist = ps.length > 1 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0
      return { cx, cy, dist }
    }
    const zoomAt = (cx: number, cy: number, factor: number) => {
      const v = viewRef.current
      const old = v.scale
      v.scale = Math.min(Math.max(old * factor, fitRef.current), fitRef.current * maxZoom)
      const k = v.scale / old
      v.tx = cx - (cx - v.tx) * k
      v.ty = cy - (cy - v.ty) * k
    }
    const toCell = (p: { x: number; y: number }): [number, number] => {
      const v = viewRef.current
      const t = terrainRef.current!
      const gx = (p.x - v.tx) / v.scale / RENDER_SCALE - 0.5
      const gy = (p.y - v.ty) / v.scale / RENDER_SCALE - 0.5
      return [Math.min(Math.max(gx, 0), t.width - 1), Math.min(Math.max(gy, 0), t.height - 1)]
    }
    let stroke: [number, number][] | null = null
    const down = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, local(e))
      if (pointers.size === 1) moved = 0
      last = summary()
      if (drawRef.current.drawing && pointers.size === 1) {
        stroke = [toCell(local(e))]
      } else if (stroke) {
        stroke = null // second finger: switch to pan/zoom
        drawRef.current.onStrokeMove?.([])
      }
    }
    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId) || !last) return
      pointers.set(e.pointerId, local(e))
      if (stroke) {
        stroke.push(toCell(local(e)))
        drawRef.current.onStrokeMove?.(stroke.slice())
        last = summary()
        return
      }
      const now = summary()
      const v = viewRef.current
      moved += Math.hypot(now.cx - last.cx, now.cy - last.cy)
      v.tx += now.cx - last.cx
      v.ty += now.cy - last.cy
      if (pointers.size > 1 && last.dist > 0) {
        moved += 100 // a pinch is never a tap
        zoomAt(now.cx, now.cy, now.dist / last.dist)
      }
      last = now
      clampView()
      draw()
    }
    const up = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return
      const p = local(e)
      pointers.delete(e.pointerId)
      last = pointers.size ? summary() : null
      if (stroke) {
        const done = stroke
        stroke = null
        drawRef.current.onStrokeEnd?.(done)
        return
      }
      setTick((n) => n + 1)
      if (pointers.size === 0 && moved < 8) {
        // Tap: read elevation and slope at that point.
        const v = viewRef.current
        const t = terrainRef.current!
        const gx = (p.x - v.tx) / v.scale / RENDER_SCALE - 0.5
        const gy = (p.y - v.ty) / v.scale / RENDER_SCALE - 0.5
        if (gx < 0 || gy < 0 || gx > t.width - 1 || gy > t.height - 1) { setProbe(null); return }
        if (onTapRef.current) { onTapRef.current(Math.round(gx), Math.round(gy)); return }
        setProbe({ x: p.x, y: p.y, elev: elevAt(t, gx, gy), slope: slopeDeg(t, Math.round(gx), Math.round(gy)) })
      } else {
        setProbe(null)
      }
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = cv.getBoundingClientRect()
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015))
      clampView()
      draw()
      setProbe(null)
      setTick((n) => n + 1)
    }
    cv.addEventListener('pointerdown', down)
    cv.addEventListener('pointermove', move)
    cv.addEventListener('pointerup', up)
    cv.addEventListener('pointercancel', up)
    cv.addEventListener('wheel', wheel, { passive: false })
    return () => {
      ro.disconnect()
      cv.removeEventListener('pointerdown', down)
      cv.removeEventListener('pointermove', move)
      cv.removeEventListener('pointerup', up)
      cv.removeEventListener('pointercancel', up)
      cv.removeEventListener('wheel', wheel)
    }
    // draw/clampView only read refs, so they are safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta])

  // Scale bar: pick a round distance that is ~80-160 px on screen.
  const metresPerPx = meta ? meta.cellM / RENDER_SCALE / viewRef.current.scale : 0
  const barM = metresPerPx ? [50, 100, 200, 250, 500, 1000, 2000].find((m) => m / metresPerPx >= 80) ?? 2000 : 0

  return (
    <main className={bare ? 'map-screen bare' : 'map-screen'}>
      {!bare && <header className="map-head">
        <h2>{meta?.name ?? 'Loading terrain…'}</h2>
        {meta && (
          <span>
            {Math.round(meta.minElevM * 3.28084).toLocaleString()}–{Math.round(meta.maxElevM * 3.28084).toLocaleString()} ft
          </span>
        )}
      </header>}
      <div className="map-wrap">
        <canvas ref={canvasRef} className={drawing ? 'map-canvas drawing' : 'map-canvas'} />
        {error && <p className="note map-error">Could not load terrain: {error}</p>}
        {probe && (
          <div className="probe" style={{ left: probe.x, top: probe.y }}>
            <b>{Math.round(probe.elev * 3.28084).toLocaleString()} ft</b>
            <span>{Math.round(probe.slope)}° slope</span>
          </div>
        )}
        <div className="north" aria-label="North is up">N<br />▲</div>
        {barM > 0 && (
          <div className="scalebar">
            <i style={{ width: barM / metresPerPx }} />
            <span>{barM >= 1000 ? `${barM / 1000} km` : `${barM} m`}</span>
          </div>
        )}
        <p className="credit">Elevation: USGS 3DEP{makeBase ? '' : ` · contours ${MINOR_CONTOUR_M} m`}</p>
        {children}
      </div>
      {panel}
      <nav className="actions map-actions">
        {actions ?? <button className="btn" onClick={onBack}>{backLabel}</button>}
      </nav>
    </main>
  )
}

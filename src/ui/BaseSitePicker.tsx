/**
 * Choose where the base village goes on the starter parcel: up to three suggestions
 * scored on flat ground, lift vertical and road access, or tap a spot yourself.
 */
import { useMemo, useState } from 'react'
import {
  VILLAGE, computeParcels, scoreBaseSite, slopeDeg, suggestBaseSites, toPlacement, villagePackageUsd,
  type BasePlacement, type BaseSite, type Parcel, type Site, type Terrain,
} from '../sim'
import { ft, usd } from './format'
import { MapView, RENDER_SCALE } from './MapView'
import { drawRoad, drawRoadLabel } from './village/art'
import { roadLabel, useRoads } from './village/layout'

const S = RENDER_SCALE

export function BaseSitePicker({ site, parcel, onBack, onChoose }: {
  site: Site; parcel: Parcel; onBack: () => void; onChoose: (b: BasePlacement) => void
}) {
  const roads = useRoads(site.terrainId!)
  const [t, setT] = useState<Terrain | null>(null)
  const [pick, setPick] = useState(0)
  const [own, setOwn] = useState<BaseSite | null>(null)
  const [placing, setPlacing] = useState(false)
  const [why, setWhy] = useState<string | null>(null)
  const p = useMemo(() => (t ? computeParcels(t).find((q) => q.id === parcel.id) ?? null : null), [t, parcel.id])
  const sites = useMemo(() => (t && p && roads ? suggestBaseSites(t, p, 3, roads) : []), [t, p, roads])
  const flat = useMemo(() => {
    if (!t || !p) return null
    const cv = document.createElement('canvas')
    cv.width = t.width
    cv.height = t.height
    const ctx = cv.getContext('2d')!
    const img = ctx.createImageData(t.width, t.height)
    for (let y = p.y0; y < p.y1; y++) for (let x = p.x0; x < p.x1; x++) {
      const sl = slopeDeg(t, x, y)
      if (sl < VILLAGE.maxMeanSlopeDeg) {
        const i = (y * t.width + x) * 4
        img.data[i] = 58; img.data[i + 1] = 145; img.data[i + 2] = 80; img.data[i + 3] = 120 * (1 - sl / VILLAGE.maxMeanSlopeDeg) + 40
      }
    }
    ctx.putImageData(img, 0, 0)
    return cv
  }, [t, p])
  const chosen = own ?? sites[pick] ?? null
  const roadName = (n?: string) => (n ? roadLabel({ name: n, cls: 0, parts: [] }) : '')

  return (
    <MapView
      terrainId={site.terrainId!}
      focus={{ x: (parcel.x0 + parcel.x1) / 2, y: (parcel.y0 + parcel.y1) / 2, metresAcross: 1500 }}
      zoomBoost={2}
      onBack={onBack}
      onTerrain={setT}
      onTapCell={(x, y) => {
        if (!placing || !t || !p || !roads) return
        const r = Math.round(VILLAGE.footprintM / t.cellM)
        if (x < p.x0 + r || x >= p.x1 - r || y < p.y0 + r || y >= p.y1 - r) { setWhy('Pick a spot inside your parcel, away from its edge.'); return }
        const s = scoreBaseSite(t, x, y, roads)
        if (!s) { setWhy(`Too steep there, or more than ${(VILLAGE.maxRoadM / 1000).toFixed(1)} km from a road. Try the green ground.`); return }
        setWhy(null)
        setOwn(s)
      }}
      overlay={(ctx, scale) => {
        if (!t) return
        const k = S / t.cellM
        ctx.fillStyle = 'rgba(60,50,40,0.32)'
        const parcels = computeParcels(t)
        for (const q of parcels) if (q.id !== parcel.id) ctx.fillRect(q.x0 * S, q.y0 * S, (q.x1 - q.x0) * S, (q.y1 - q.y0) * S)
        if (flat) {
          ctx.imageSmoothingEnabled = false
          ctx.drawImage(flat, 0, 0, t.width * S, t.height * S)
          ctx.imageSmoothingEnabled = true
        }
        const px = ([x, y]: [number, number]): [number, number] => [(x + 0.5) * S, (y + 0.5) * S]
        for (const road of roads ?? []) for (const part of road.parts) drawRoad(ctx, part.map(px), k, road.cls, scale)
        const named = new Set<string>()
        for (const road of [...(roads ?? [])].sort((a, b) => b.parts[0].length - a.parts[0].length)) {
          const nm = roadLabel(road)
          if (!nm || named.has(nm)) continue
          named.add(nm)
          drawRoadLabel(ctx, road.parts[0].map(px), nm, scale)
        }
        const pins: [BaseSite, string, boolean][] = sites.map((b, i) => [b, String(i + 1), !own && i === pick])
        if (own) pins.push([own, '★', true])
        for (const [b, label, on] of pins) {
          const [x, y] = px([b.x, b.y])
          if (b.roadJoin) {
            ctx.strokeStyle = '#2a5a92'
            ctx.lineWidth = 2.5 / scale
            ctx.setLineDash([5 / scale, 4 / scale])
            ctx.beginPath(); ctx.moveTo(...px(b.roadJoin)); ctx.lineTo(x, y); ctx.stroke()
            ctx.setLineDash([])
          }
          ctx.strokeStyle = on ? '#2a5a92' : 'rgba(42,90,146,0.5)'
          ctx.lineWidth = (on ? 3 : 2) / scale
          ctx.beginPath(); ctx.arc(x, y, (VILLAGE.footprintM / t.cellM) * S, 0, Math.PI * 2); ctx.stroke()
          ctx.fillStyle = on ? '#2a5a92' : '#fff'
          ctx.beginPath(); ctx.arc(x, y, 11 / scale, 0, Math.PI * 2); ctx.fill()
          ctx.fillStyle = on ? '#fff' : '#2a5a92'
          ctx.font = `800 ${13 / scale}px Nunito, sans-serif`
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
          ctx.fillText(label, x, y + 0.5 / scale)
        }
      }}
      panel={
        <section className="map-panel">
          <h3>Where should your base village go?</h3>
          <div className="seg">
            {sites.map((b, i) => (
              <button key={i} className={!own && i === pick ? 'on' : ''} onClick={() => { setOwn(null); setPick(i); setPlacing(false) }}>#{i + 1} · {b.score}</button>
            ))}
            <button className={placing || own ? 'on' : ''} onClick={() => { setPlacing(true); setWhy(null) }}>{own ? `★ · ${own.score}` : 'My own'}</button>
          </div>
          {placing && !own && !why && <p className="hint">Tap the map where you want the village. Green ground is flat enough to build on.</p>}
          {why && <p className="hint">{why}</p>}
          {chosen && (
            <p className="hint">
              {ft(Math.round(chosen.elevM * 3.28084))} · {chosen.meanSlopeDeg.toFixed(1)}° average slope · {ft(Math.round(chosen.nearVerticalM * 3.28084))} of lift vertical within {VILLAGE.nearReachM} m
              {chosen.roadName ? ` · ${chosen.roadM} m drive from ${roadName(chosen.roadName)}` : ''}.
              {' '}Village package {usd(villagePackageUsd(chosen.roadM))} (est.)
            </p>
          )}
          {!sites.length && t && roads && <p className="hint">No flat ground near a road on this parcel. Try placing it yourself.</p>}
        </section>
      }
      actions={
        <>
          <button className="btn primary" disabled={!chosen} onClick={() => chosen && onChoose(toPlacement(chosen))}>Build base village here</button>
          <button className="btn" onClick={onBack}>Back</button>
        </>
      }
    />
  )
}

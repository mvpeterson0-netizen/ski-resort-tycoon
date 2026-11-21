import { useState } from 'react'
import {
  computeParcels, landPrice, parcelAtCell, parcelLabel, siteForParcel,
  type Parcel, type Region, type Site,
} from '../sim'
import { MapView, RENDER_SCALE } from './MapView'
import { ft, usd } from './format'

const S = RENDER_SCALE

function drawParcels(
  ctx: CanvasRenderingContext2D, scale: number, parcels: Parcel[],
  style: (p: Parcel) => { fill?: string; stroke: string; width: number; dash?: number[]; label?: string },
) {
  for (const p of parcels) {
    const st = style(p)
    const x = p.x0 * S, y = p.y0 * S, w = (p.x1 - p.x0) * S, h = (p.y1 - p.y0) * S
    if (st.fill) { ctx.fillStyle = st.fill; ctx.fillRect(x, y, w, h) }
    ctx.strokeStyle = st.stroke
    ctx.lineWidth = st.width / scale // constant on-screen width
    ctx.setLineDash((st.dash ?? []).map((d) => d / scale))
    ctx.strokeRect(x, y, w, h)
    if (st.label) {
      const fontPx = 13 / scale
      ctx.font = `600 ${fontPx}px Georgia, serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const tw = ctx.measureText(st.label).width
      ctx.fillStyle = 'rgba(255,253,247,0.9)'
      ctx.fillRect(x + w / 2 - tw / 2 - 5 / scale, y + h / 2 - fontPx * 0.8, tw + 10 / scale, fontPx * 1.6)
      ctx.fillStyle = '#23303b'
      ctx.fillText(st.label, x + w / 2, y + h / 2)
    }
  }
  ctx.setLineDash([])
}

/** Pick a starter parcel on the real terrain map. */
export function ParcelPicker({ site, region, onBack, onChoose }: {
  site: Site; region: Region; onBack: () => void; onChoose: (p: Parcel) => void
}) {
  const [parcels, setParcels] = useState<Parcel[]>([])
  const [selected, setSelected] = useState<Parcel | null>(null)
  const price = (p: Parcel) => landPrice(siteForParcel(site, p), region).totalUsd

  return (
    <MapView
      terrainId={site.terrainId!}
      onBack={onBack}
      onTerrain={(t) => setParcels(computeParcels(t))}
      onTapCell={(x, y) => setSelected(parcelAtCell(parcels, x, y) ?? null)}
      overlay={(ctx, scale) =>
        drawParcels(ctx, scale, parcels, (p) =>
          p.id === selected?.id
            ? { fill: 'rgba(29,78,137,0.18)', stroke: '#1d4e89', width: 3, label: usd(price(p)) }
            : { stroke: 'rgba(35,48,59,0.7)', width: 1.5, dash: [6, 4], label: usd(price(p)) },
        )
      }
      panel={
        <section className="map-panel">
          {selected ? (
            <>
              <h3>{parcelLabel(selected)} · {usd(price(selected))}</h3>
              <div className="mini-stats">
                <span><b>{selected.acres}</b> acres</span>
                <span><b>{ft(selected.verticalFt)}</b> vertical</span>
                <span><b>{selected.aspect}</b> facing</span>
                <span><b>{Math.round(selected.northShare * 100)}%</b> north-facing</span>
                <span><b>{Math.round(selected.meanSlopeDeg)}°</b> avg slope</span>
              </div>
            </>
          ) : (
            <p className="hint">Tap a parcel to see its terrain and price. Start with one; buy neighbours later.</p>
          )}
        </section>
      }
      actions={
        <div className="row">
          <button className="btn" onClick={onBack}>Back</button>
          <button className="btn primary" disabled={!selected} onClick={() => selected && onChoose(selected)}>
            Buy this parcel…
          </button>
        </div>
      }
    />
  )
}

/** The player's resort map: owned parcels highlighted, the rest available. */
export function ResortMap({ site, owned, onBack }: { site: Site; owned: string[]; onBack: () => void }) {
  const [parcels, setParcels] = useState<Parcel[]>([])
  return (
    <MapView
      terrainId={site.terrainId!}
      onBack={onBack}
      backLabel="Back to resort"
      onTerrain={(t) => setParcels(computeParcels(t))}
      overlay={(ctx, scale) =>
        drawParcels(ctx, scale, parcels, (p) =>
          owned.includes(p.id)
            ? { stroke: '#1d4e89', width: 3 }
            : { fill: 'rgba(60,50,40,0.28)', stroke: 'rgba(35,48,59,0.6)', width: 1, dash: [6, 4], label: 'For sale' },
        )
      }
    />
  )
}

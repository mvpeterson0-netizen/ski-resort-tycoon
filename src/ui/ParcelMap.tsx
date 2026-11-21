import { useState } from 'react'
import {
  buyParcel, buyableParcels, computeParcels, expansionPremium, landPrice, parcelAtCell, parcelLabel, siteForParcel,
  type GameState, type Parcel, type Region, type Site, type SlopeClass,
} from '../sim'
import { CLASS_LABEL, CLASS_RGB, renderDifficultyLayer } from './difficultyLayer'
import { MapView, RENDER_SCALE } from './MapView'
import { ft, usd } from './format'

const S = RENDER_SCALE

function drawParcels(
  ctx: CanvasRenderingContext2D, scale: number, parcels: Parcel[],
  style: (p: Parcel) => { fill?: string; stroke: string; width: number; dash?: number[]; label?: string },
) {
  const css = getComputedStyle(document.documentElement)
  const labelBg = css.getPropertyValue('--surface').trim() || 'rgba(255,253,247,0.9)'
  const labelInk = css.getPropertyValue('--ink').trim() || '#23303b'
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
      ctx.font = `600 ${fontPx}px ${getComputedStyle(document.documentElement).getPropertyValue('--font').trim() || 'Georgia, serif'}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const tw = ctx.measureText(st.label).width
      ctx.fillStyle = labelBg
      ctx.fillRect(x + w / 2 - tw / 2 - 5 / scale, y + h / 2 - fontPx * 0.8, tw + 10 / scale, fontPx * 1.6)
      ctx.fillStyle = labelInk
      ctx.fillText(st.label, x + w / 2, y + h / 2)
    }
  }
  ctx.setLineDash([])
}

const ORDER: SlopeClass[] = ['green', 'blue', 'black', 'hazard']
const rgb = (c: SlopeClass) => `rgb(${CLASS_RGB[c].join(',')})`

/** Stacked bar of the parcel's potential run mix, with a legend. */
function MixBar({ mix }: { mix: Record<SlopeClass, number> }) {
  return (
    <div className="mix">
      <div className="mix-bar" role="img" aria-label={ORDER.map((c) => `${CLASS_LABEL[c]} ${Math.round(mix[c] * 100)}%`).join(', ')}>
        {ORDER.map((c) => mix[c] > 0 && <i key={c} style={{ width: `${mix[c] * 100}%`, background: rgb(c) }} />)}
      </div>
      <div className="mix-legend">
        {ORDER.map((c) => (
          <span key={c}><i style={{ background: rgb(c) }} />{CLASS_LABEL[c]} {Math.round(mix[c] * 100)}%</span>
        ))}
      </div>
    </div>
  )
}

/** Show the parcel grid; the starter is always the site's road-access parcel. */
export function ParcelPicker({ site, region, onBack, onChoose }: {
  site: Site; region: Region; onBack: () => void; onChoose: (p: Parcel) => void
}) {
  const [parcels, setParcels] = useState<Parcel[]>([])
  const [layer, setLayer] = useState<HTMLCanvasElement | null>(null)
  const [showRuns, setShowRuns] = useState(true)
  const [focusId, setFocusId] = useState<string | null>(null)
  const price = (p: Parcel) => landPrice(siteForParcel(site, p), region).totalUsd
  const starter = parcels.find((p) => p.id === site.accessParcel)
  const focus = parcels.find((p) => p.id === (focusId ?? site.accessParcel)) ?? null
  const isStarter = focus?.id === starter?.id

  return (
    <MapView
      terrainId={site.terrainId!}
      onBack={onBack}
      onTerrain={(t) => { setParcels(computeParcels(t)); setLayer(renderDifficultyLayer(t)) }}
      onTapCell={(x, y) => setFocusId(parcelAtCell(parcels, x, y)?.id ?? null)}
      overlay={(ctx, scale) => {
        const runs = showRuns && layer && focus
        drawParcels(ctx, scale, parcels, (p) => {
          if (runs && p.id === focus.id) return { stroke: 'transparent', width: 0 }
          return p.id === starter?.id
            ? { fill: 'rgba(29,78,137,0.18)', stroke: '#1d4e89', width: 3, label: `Road access · ${usd(price(p))}` }
            : { fill: 'rgba(60,50,40,0.22)', stroke: 'rgba(35,48,59,0.6)', width: 1, dash: [6, 4], label: 'Expansion' }
        })
        if (runs) {
          // Run-difficulty overlay, clipped to the selected parcel, one pixel per 10 m cell.
          const x = focus.x0 * S, y = focus.y0 * S, w = (focus.x1 - focus.x0) * S, h = (focus.y1 - focus.y0) * S
          ctx.save()
          ctx.beginPath()
          ctx.rect(x, y, w, h)
          ctx.clip()
          ctx.imageSmoothingEnabled = false
          ctx.drawImage(layer, 0, 0, layer.width * S, layer.height * S)
          ctx.restore()
          ctx.imageSmoothingEnabled = true
          ctx.strokeStyle = focus.id === starter?.id ? '#1d4e89' : '#23303b'
          ctx.lineWidth = 3 / scale
          ctx.strokeRect(x, y, w, h)
        }
      }}
      panel={
        <section className="map-panel">
          {focus && (
            <>
              <h3>
                {parcelLabel(focus)} · {usd(price(focus))}
                {isStarter ? <span className="tag">Starter</span> : <span className="tag muted">Expansion, buy later</span>}
              </h3>
              {isStarter && site.accessRoad && <p className="hint">{site.accessRoad}. Your base area and parking go here.</p>}
              <MixBar mix={focus.terrainMix} />
              <div className="mini-stats">
                <span><b>{focus.acres}</b> acres</span>
                <span><b>{ft(focus.verticalFt)}</b> vertical</span>
                <span><b>{focus.aspect}</b> facing</span>
                <span><b>{Math.round(focus.northShare * 100)}%</b> north-facing</span>
                <span><b>{Math.round(focus.meanSlopeDeg)}°</b> avg slope</span>
              </div>
            </>
          )}
        </section>
      }
      actions={
        <div className="row">
          <button className="btn" onClick={onBack}>Back</button>
          <button className={showRuns ? 'btn toggle on' : 'btn toggle'} aria-pressed={showRuns} onClick={() => setShowRuns((v) => !v)}>
            Runs
          </button>
          <button className="btn primary grow" disabled={!starter} onClick={() => starter && onChoose(starter)}>
            Buy starter parcel…
          </button>
        </div>
      }
    />
  )
}

/** The player's land: owned parcels outlined; tap a neighbouring parcel to buy it. */
export function ResortMap({ site, region, game, onChange, onBack }: {
  site: Site; region: Region; game: GameState; onChange: (g: GameState) => void; onBack: () => void
}) {
  const [parcels, setParcels] = useState<Parcel[]>([])
  const [focusId, setFocusId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const owned = game.ownedParcels
  const buyable = new Set(buyableParcels(parcels, owned).map((p) => p.id))
  // Neighbours ask more once you run a resort (holdout premium).
  const price = (p: Parcel) =>
    Math.round(landPrice(siteForParcel(site, p), region).totalUsd * expansionPremium(owned.length) / 10_000) * 10_000
  const focus = parcels.find((p) => p.id === focusId) ?? null
  const canBuy = focus && buyable.has(focus.id)
  return (
    <MapView
      terrainId={site.terrainId!}
      onBack={onBack}
      backLabel="Back to resort"
      onTerrain={(t) => setParcels(computeParcels(t))}
      onTapCell={(x, y) => { setMessage(null); setFocusId(parcelAtCell(parcels, x, y)?.id ?? null) }}
      overlay={(ctx, scale) =>
        drawParcels(ctx, scale, parcels, (p) =>
          owned.includes(p.id)
            ? { stroke: '#2a5a92', width: 3 }
            : buyable.has(p.id)
              ? {
                  fill: p.id === focusId ? 'rgba(42,90,146,0.18)' : 'rgba(60,50,40,0.2)',
                  stroke: p.id === focusId ? '#2a5a92' : 'rgba(35,48,59,0.7)', width: p.id === focusId ? 3 : 1.5,
                  dash: [6, 4], label: `For sale · ${usd(price(p))}`,
                }
              : { fill: 'rgba(60,50,40,0.38)', stroke: 'rgba(35,48,59,0.5)', width: 1, dash: [6, 4] },
        )
      }
      panel={
        <section className="map-panel">
          {focus ? (
            <>
              <h3>
                {parcelLabel(focus)}
                {owned.includes(focus.id) ? <span className="tag">Owned</span>
                  : canBuy ? <span className="tag muted">For sale · {usd(price(focus))}</span>
                  : <span className="tag muted">Not adjacent yet</span>}
              </h3>
              <MixBar mix={focus.terrainMix} />
              <div className="mini-stats">
                <span><b>{focus.acres}</b> acres</span>
                <span><b>{ft(focus.verticalFt)}</b> vertical</span>
                <span><b>{focus.aspect}</b> facing</span>
              </div>
            </>
          ) : (
            <p className="hint">Tap a parcel next to your land to see it and buy it. Price rises {Math.round((expansionPremium(1) - 1) * 100)}% for each parcel you own.</p>
          )}
          {message && <p className={message.ok ? 'ok' : 'warn'}>{message.text}</p>}
        </section>
      }
      actions={
        <div className="row">
          <button className="btn" onClick={onBack}>Back</button>
          {canBuy && (
            <button
              className="btn primary grow"
              disabled={game.phase === 'season'}
              onClick={() => {
                const r = buyParcel(game, focus.id, price(focus))
                if (r.ok) { onChange(r.game); setMessage({ text: `Bought the ${parcelLabel(focus).toLowerCase()}`, ok: true }) }
                else setMessage({ text: r.reason, ok: false })
              }}
            >
              Buy · {usd(price(focus))}
            </button>
          )}
        </div>
      }
    />
  )
}

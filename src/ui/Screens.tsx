import type { ReactNode } from 'react'
import { REGIONS, SIM_VERSION, aspectSnowRetention, landPrice, regionById, sitesInRegion, type Region, type Site, type SiteTraits } from '../sim'
import { MountainArt } from './MountainArt'
import { drive, ft, usd } from './format'

/** Page frame: scrollable content, with the controls pinned at the bottom for one-thumb use. */
function Frame({ title, children, bar }: { title?: string; children: ReactNode; bar: ReactNode }) {
  return (
    <main className="screen">
      {title && <h2 className="screen-title">{title}</h2>}
      <div className="content">{children}</div>
      <nav className="actions">{bar}</nav>
    </main>
  )
}

export function TitleScreen({ onNew, onContinue, canContinue }: { onNew: () => void; onContinue: () => void; canContinue: boolean }) {
  return (
    <main className="screen">
      <section className="hero">
        <MountainArt />
        <h1>Ski Resort Tycoon</h1>
        <p className="tagline">Pick a real mountain. Buy the land. Build the lifts. Survive the warm years.</p>
        <div className="legend">
          <span><i className="dot g" /> Easier</span>
          <span><i className="dot b" /> More difficult</span>
          <span><i className="dot k" /> Most difficult</span>
        </div>
      </section>
      <nav className="actions">
        {canContinue && <button className="btn primary" onClick={onContinue}>Continue</button>}
        <button className={canContinue ? 'btn' : 'btn primary'} onClick={onNew}>New game</button>
      </nav>
      <p className="foot">Prototype · sim v{SIM_VERSION}</p>
    </main>
  )
}

export function RegionPicker({ onPick, onBack }: { onPick: (r: Region) => void; onBack: () => void }) {
  const group = (country: Region['country'], label: string) => (
    <>
      <h3 className="group">{label}</h3>
      <ul className="cards">
        {REGIONS.filter((r) => r.country === country).map((r) => {
          const n = sitesInRegion(r.id).length
          return (
            <li key={r.id}>
              <button className="card" disabled={n === 0} onClick={() => onPick(r)}>
                <span className="card-title">{r.name}</span>
                <span className="card-sub">{r.blurb}</span>
                <span className="badge">{n ? `${n} sites` : 'Coming soon'}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
  return (
    <Frame title="Choose a region" bar={<button className="btn" onClick={onBack}>Back</button>}>
      {group('US', 'United States')}
      {group('INTL', 'International')}
    </Frame>
  )
}

export function SitePicker({ region, onPick, onBack }: { region: Region; onPick: (s: Site) => void; onBack: () => void }) {
  return (
    <Frame title={region.name} bar={<button className="btn" onClick={onBack}>Back to regions</button>}>
      {sitesInRegion(region.id).some((s) => s.placeholder) && (
        <p className="note">Sites marked (placeholder) are invented for testing.</p>
      )}
      <ul className="cards">
        {sitesInRegion(region.id).map((s) => (
          <li key={s.id}>
            <button className="card" onClick={() => onPick(s)}>
              <span className="card-title">{s.name}</span>
              <span className="stats">
                <span><b>{ft(s.traits.verticalDropFt)}</b> vertical</span>
                <span><b>{s.traits.avgSnowfallIn}"</b> snow/yr</span>
                <span><b>{s.traits.aspect}</b> facing</span>
                <span><b>{usd(landPrice(s, regionById(s.regionId)!).totalUsd)}</b> asking</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Frame>
  )
}

const RATING_CLASS = { poor: 'bad', fair: 'mid', good: 'good', easy: 'good', moderate: 'mid', hard: 'bad' } as const

export function SiteDetail({ site, region, onBack, onMap, onBuy }: {
  site: Site; region: Region; onBack: () => void; onMap: () => void; onBuy: () => void
}) {
  const t = site.traits
  const ret = aspectSnowRetention(t.aspect)
  const aspectHint = ret > 0.7 ? 'Holds snow well' : ret < 0.3 ? 'Sun melts snow fast' : 'Average sun exposure'
  const rows: [string, ReactNode, string?, (keyof SiteTraits)?][] = [
    ['Vertical drop', ft(t.verticalDropFt), site.terrainId ? 'Max in parcel, from USGS data' : undefined],
    ['Slope aspect', `${t.aspect}-facing`, aspectHint, 'aspect'],
    ['Average snowfall', `${t.avgSnowfallIn} in / year`, undefined, 'avgSnowfallIn'],
    ['Asking price', usd(landPrice(site, region).totalUsd), `${t.acres.toLocaleString()} acres · breakdown on next screen`],
    ['To interstate', drive(t.driveToInterstateMin), undefined, 'driveToInterstateMin'],
    ['To nearest metro', drive(t.driveToMetroMin), t.nearestMetro, 'driveToMetroMin'],
    ['Water rights', <span key="w" className={`pill ${RATING_CLASS[t.waterRights]}`}>{t.waterRights}</span>, 'For snowmaking', 'waterRights'],
    ['Permits', <span key="p" className={`pill ${RATING_CLASS[t.permitDifficulty]}`}>{t.permitDifficulty}</span>, undefined, 'permitDifficulty'],
    ['Adjacent parcels', `${t.adjacentParcels}`, 'Room to expand later', 'adjacentParcels'],
  ]
  return (
    <Frame
      title={site.name}
      bar={
        <>
          <div className="row">
            <button className="btn" onClick={onBack}>Back</button>
            {site.terrainId && <button className="btn" onClick={onMap}>Map</button>}
          </div>
          <button className="btn primary" onClick={onBuy}>Buy this land…</button>
        </>
      }
    >
      {site.placeholder && <p className="note">Placeholder site: every number below is made up.</p>}
      {site.notes && <p className="note">{site.notes} Values marked <span className="est">est.</span> are placeholders.</p>}
      <dl className="traits">
        {rows.map(([k, v, hint, key]) => (
          <div key={k} className="trait">
            <dt>{k}</dt>
            <dd>
              {v}
              {key && site.unverified?.includes(key) && <span className="est">est.</span>}
              {hint && <small>{hint}</small>}
            </dd>
          </div>
        ))}
      </dl>
    </Frame>
  )
}

/**
 * Home screen: a bird's-eye view of the resort on its real terrain. Buildings change
 * look as they level up; tap one to see it and upgrade it. Tabs along the bottom lead
 * to the management screens.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AMENITIES, AMENITY_TUNING, BUILD, amenityEffects, buyAmenity, computeParcels, nextAmenityCost, placeBase, seasonBlocker,
  suggestBaseSites, toPlacement, totalDebt,
  type AmenityId, type GameState, type Site, type Terrain,
} from '../sim'
import { effectLine } from './amenityText'
import { usd } from './format'
import { MapView } from './MapView'
import { paintGround, paintTreeLayer, plantTrees } from './village/art'
import { drawResortScene, ITEM_NAMES } from './village/drawResort'
import { clearTrees, useRoads, useSprites, villageFrame, villageItems, type VillageItem } from './village/layout'

export type ResortTab = 'build' | 'village' | 'prices' | 'staff' | 'money'

const AMENITY_KINDS = ['lodge', 'rentals', 'school', 'housing', 'parking'] as const

export function ResortView({ game, site, onChange, onTab, onSeason, onLand, onSettings, onQuit }: {
  game: GameState; site: Site; onChange: (g: GameState) => void; onTab: (t: ResortTab) => void
  onSeason: () => void; onLand: () => void; onSettings: () => void; onQuit: () => void
}) {
  const terrainId = site.terrainId!
  const [t, setT] = useState<Terrain | null>(null)
  const roads = useRoads(terrainId)
  const sprites = useSprites()
  const [selKey, setSelKey] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const inSeason = game.phase === 'season'

  // Saves from before base villages get one placed at the best suggested spot.
  useEffect(() => {
    if (!t || !roads || game.base) return
    const parcels = computeParcels(t)
    const id = site.accessParcel && game.ownedParcels.includes(site.accessParcel) ? site.accessParcel : game.ownedParcels[0]
    const p = parcels.find((q) => q.id === id)
    const [b] = p ? suggestBaseSites(t, p, 1, roads) : []
    if (b) onChange(placeBase(game, toPlacement(b)))
  }, [t, roads, game, site, onChange])

  const frame = useMemo(() => (t && game.base ? villageFrame(t, game.base) : null), [t, game.base])
  const vi = useMemo(() => (t && frame ? villageItems(t, frame, game.amenities, game.lifts) : null), [t, frame, game.amenities, game.lifts])
  const trees = useMemo(() => (t ? plantTrees(t) : null), [t])
  const layer = useMemo(() => (t && trees ? paintTreeLayer(t, trees) : null), [t, trees])
  const kept = useMemo(() => (t && trees && roads
    ? clearTrees(t, trees, roads, game.trails, game.lifts, frame && vi ? { F: frame, ...vi, parking: game.amenities.parking } : null)
    : null), [t, trees, roads, game.trails, game.lifts, frame, vi, game.amenities.parking])

  // Tappable things: buildings, lift terminals and the parking lot.
  const tappable: VillageItem[] = useMemo(() => (vi ? [...vi.items, { kind: 'parking', art: game.amenities.parking, c: vi.lot, r: 45 }] : []), [vi, game.amenities.parking])
  const key = (it: VillageItem) => it.liftId ?? it.kind
  const selected = tappable.find((it) => key(it) === selKey) ?? null

  // Parking looks busier on busy days.
  const lastDay = game.season?.days.at(-1)
  const cap = amenityEffects(game.amenities, false).parkingCapGuests
  const fullness = inSeason && lastDay ? Math.min(0.95, 0.1 + lastDay.guests / cap) : 0.2

  const blocker = seasonBlocker(game)
  const focus = game.base && frame
    ? { x: frame.v[0] + frame.r[0], y: frame.v[1] + frame.r[1] + 2, metresAcross: 230 + 45 * game.amenities.lodge }
    : undefined

  const ready = !!(t && layer && kept && sprites && roads)
  return (
    <MapView
      terrainId={terrainId}
      bare
      base={paintGround}
      zoomBoost={3}
      focus={focus}
      onBack={onQuit}
      onTerrain={setT}
      onTapCell={(x, y) => {
        setMsg(null)
        const hit = tappable
          .map((it) => ({ it, d: Math.hypot(it.c[0] - x, it.c[1] - y) * (t?.cellM ?? 10) }))
          .filter(({ it, d }) => d < it.r + 12)
          .sort((a, b) => a.d - b.d)[0]
        setSelKey(hit ? key(hit.it) : null)
      }}
      overlay={(ctx, scale) => {
        if (!ready) return
        drawResortScene(ctx, scale, {
          t: t!, roads: roads!, trails: game.trails, lifts: game.lifts, amenities: game.amenities,
          village: frame && vi ? { F: frame, ...vi } : null, forest: { layer: layer!, kept: kept! }, sprites: sprites!,
          fullness, selected,
        })
      }}
      actions={
        <nav className="tabbar">
          <button className="on">Resort</button>
          <button disabled={inSeason} onClick={() => onTab('build')}>Build</button>
          <button disabled={inSeason} onClick={() => onTab('village')}>Village</button>
          <button onClick={() => onTab('prices')}>Prices</button>
          <button onClick={() => onTab('staff')}>Staff</button>
          <button onClick={() => onTab('money')}>Money</button>
        </nav>
      }
    >
      <div className="hud">
        <div className="hud-row">
          <b>{site.name}</b>
          <span>Year {game.year} · {inSeason ? `Winter, day ${game.season?.day ?? 0}` : 'Off-season'}</span>
          <button className="hud-menu" aria-label="Menu" onClick={() => setMenu((m) => !m)}>☰</button>
        </div>
        <div className="hud-chips">
          <span>Cash {usd(game.cashUsd)}</span>
          <span>Debt {usd(totalDebt(game))}</span>
          <span>Rep {Math.round(game.reputation * 100)}%</span>
          {inSeason && lastDay && <span>{lastDay.guests.toLocaleString()} skiers</span>}
        </div>
      </div>
      {menu && (
        <div className="hud-sheet">
          <button className="btn" onClick={() => { setMenu(false); onLand() }}>Land</button>
          <button className="btn" onClick={() => { setMenu(false); onSettings() }}>Settings</button>
          <button className="btn" onClick={() => { setMenu(false); onQuit() }}>Main menu</button>
        </div>
      )}
      {!ready && <p className="note map-loading">Drawing your resort…</p>}
      {selected ? (
        <ItemCard
          game={game} item={selected} inSeason={inSeason} msg={msg}
          onClose={() => setSelKey(null)}
          onUpgrade={(id) => {
            const r = buyAmenity(game, id)
            if (r.ok) { onChange(r.game); setMsg(null) } else setMsg(r.reason)
          }}
        />
      ) : inSeason ? (
        <button className="btn primary fab" onClick={onSeason}>Continue season ▸</button>
      ) : blocker ? (
        <button className="btn primary fab" onClick={() => onTab('build')}>{blocker} ▸</button>
      ) : (
        <button className="btn primary fab" onClick={onSeason}>Start winter ▸</button>
      )}
    </MapView>
  )
}

function ItemCard({ game, item, inSeason, msg, onClose, onUpgrade }: {
  game: GameState; item: VillageItem; inSeason: boolean; msg: string | null; onClose: () => void; onUpgrade: (id: AmenityId) => void
}) {
  let title: string
  let detail: string
  let action: ReactNode = null
  if ((AMENITY_KINDS as readonly string[]).includes(item.kind)) {
    const id = item.kind as AmenityId
    const level = game.amenities[id]
    const spec = AMENITIES[id]
    title = `${id === 'parking' ? 'Parking' : ITEM_NAMES[id]} · ${id === 'lodge' && level === 0 ? 'Warming hut' : `Level ${level}`}`
    detail = effectLine(id, level)
    const cost = nextAmenityCost(game.amenities, id)
    action = cost === null ? <p className="hint">Fully built.</p>
      : inSeason ? <p className="hint">Upgrades are built in the off-season.</p>
      : <button className="btn primary" onClick={() => onUpgrade(id)}>Upgrade to level {level + 1} · {usd(cost)}</button>
    if (cost !== null && !inSeason) detail += ` · next: ${spec.blurb.toLowerCase()}`
  } else if (item.kind === 'terminal') {
    const lift = game.lifts.find((l) => l.id === item.liftId)
    title = lift?.name ?? 'Lift'
    detail = lift ? `${BUILD.lifts[lift.type].name} · ${lift.capacityPph.toLocaleString()} riders/hr · ${lift.lengthM.toLocaleString()} m long` : ''
  } else {
    title = ITEM_NAMES[item.kind] ?? item.kind
    detail = 'Part of the starter base village.'
  }
  return (
    <div className="bcard">
      <button className="bcard-x" aria-label="Close" onClick={onClose}>×</button>
      <div><b>{title}</b><small>{detail}</small></div>
      {msg && <p className="hint">{msg}</p>}
      {action}
      {item.kind === 'parking' && <small className="hint">Each level adds {AMENITY_TUNING.spacesPerLevel} spaces.</small>}
    </div>
  )
}

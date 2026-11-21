/**
 * Parcels: a site's terrain window split into an N×N grid. The player buys one starter
 * parcel and can expand into adjacent ones later. Per-parcel vertical drop and aspect
 * are derived from the real elevation data; other traits come from the site.
 */
import type { Aspect, Site, SiteTraits } from './sites'
import { slopeClass, type SlopeClass } from './difficulty'
import { gradient, type Terrain } from './terrain'

export const PARCEL_GRID = 3
const M2_PER_ACRE = 4046.8564224 // exact definition of the international acre
const FT_PER_M = 3.28084

export interface Parcel {
  id: string
  col: number
  row: number
  /** Cell bounds in the terrain grid: [x0, x1) × [y0, y1). */
  x0: number
  y0: number
  x1: number
  y1: number
  acres: number
  verticalFt: number
  /** Dominant downslope direction, slope-weighted. */
  aspect: Aspect
  /** Share of cells (0-1) whose downslope faces N, NE or NW. */
  northShare: number
  meanSlopeDeg: number
  /** Share of cells (0-1) in each slope class: the parcel's potential run mix. */
  terrainMix: Record<SlopeClass, number>
}

const ASPECTS: Aspect[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

export function aspectFromDeg(deg: number): Aspect {
  const d = ((deg % 360) + 360) % 360
  return ASPECTS[Math.round(d / 45) % 8]
}

export const parcelId = (col: number, row: number) => `r${row}c${col}`

/** Human label, e.g. "North-west parcel", "Centre parcel". */
export function parcelLabel(p: Pick<Parcel, 'col' | 'row'>, n = PARCEL_GRID): string {
  const v = p.row === 0 ? 'North' : p.row === n - 1 ? 'South' : ''
  const h = p.col === 0 ? 'west' : p.col === n - 1 ? 'east' : ''
  if (!v && !h) return 'Centre parcel'
  if (!v) return `${h[0].toUpperCase()}${h.slice(1)} parcel`
  return `${v}${h ? `-${h}` : ''} parcel`
}

export function computeParcels(t: Terrain, n = PARCEL_GRID): Parcel[] {
  const parcels: Parcel[] = []
  const edgesX = Array.from({ length: n + 1 }, (_, i) => Math.round((i * t.width) / n))
  const edgesY = Array.from({ length: n + 1 }, (_, i) => Math.round((i * t.height) / n))
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const x0 = edgesX[col], x1 = edgesX[col + 1], y0 = edgesY[row], y1 = edgesY[row + 1]
      let min = Infinity, max = -Infinity, sumE = 0, sumN = 0, north = 0, slopeSum = 0, cells = 0
      const mix: Record<SlopeClass, number> = { green: 0, blue: 0, black: 0, hazard: 0 }
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const e = t.elev[y * t.width + x]
          min = Math.min(min, e)
          max = Math.max(max, e)
          const [gx, gyS] = gradient(t, x, y)
          // Downslope vector: east = -dz/dx, north = +dz/dy_south.
          const de = -gx
          const dn = gyS
          sumE += de
          sumN += dn
          const deg = (Math.atan(Math.hypot(gx, gyS)) * 180) / Math.PI
          slopeSum += deg
          mix[slopeClass(deg)]++
          const a = aspectFromDeg((Math.atan2(de, dn) * 180) / Math.PI)
          if (a === 'N' || a === 'NE' || a === 'NW') north++
          cells++
        }
      }
      parcels.push({
        id: parcelId(col, row), col, row, x0, y0, x1, y1,
        acres: Math.round((cells * t.cellM * t.cellM) / M2_PER_ACRE),
        verticalFt: Math.round(((max - min) * FT_PER_M) / 10) * 10,
        aspect: aspectFromDeg((Math.atan2(sumE, sumN) * 180) / Math.PI),
        northShare: north / cells,
        meanSlopeDeg: slopeSum / cells,
        terrainMix: { green: mix.green / cells, blue: mix.blue / cells, black: mix.black / cells, hazard: mix.hazard / cells },
      })
    }
  }
  return parcels
}

export const areAdjacent = (a: Parcel, b: Parcel) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1

/** Parcel at a terrain cell, if any. */
export function parcelAtCell(parcels: Parcel[], x: number, y: number): Parcel | undefined {
  return parcels.find((p) => x >= p.x0 && x < p.x1 && y >= p.y0 && y < p.y1)
}

/** Site traits as they apply to one parcel (for pricing). */
export function parcelTraits(site: Site, p: Parcel): SiteTraits {
  return { ...site.traits, acres: p.acres, verticalDropFt: p.verticalFt, aspect: p.aspect }
}

/** A copy of the site whose traits describe just this parcel. */
export const siteForParcel = (site: Site, p: Parcel): Site => ({ ...site, traits: parcelTraits(site, p) })

/** Parcels the owner may buy next: not owned, and sharing an edge with an owned parcel. */
export function buyableParcels(parcels: Parcel[], owned: string[]): Parcel[] {
  const own = parcels.filter((p) => owned.includes(p.id))
  return parcels.filter((p) => !owned.includes(p.id) && own.some((o) => areAdjacent(o, p)))
}

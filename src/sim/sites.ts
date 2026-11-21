/**
 * Region and site catalogue. Pure data + types, no UI.
 *
 * Every site in this file is a PLACEHOLDER: the names are invented and the trait
 * values are made up for layout and gameplay testing. They do not describe real land.
 * Real curated sites (with sourced traits and preprocessed elevation) replace these
 * from step 3 onward.
 */

export type Aspect = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW'
export type Rating = 'poor' | 'fair' | 'good'
export type PermitDifficulty = 'easy' | 'moderate' | 'hard'

export interface Region {
  id: string
  name: string
  country: 'US' | 'INTL'
  blurb: string
}

export interface SiteTraits {
  verticalDropFt: number
  aspect: Aspect
  avgSnowfallIn: number
  landPriceUsd: number
  driveToInterstateMin: number
  nearestMetro: string
  driveToMetroMin: number
  waterRights: Rating
  permitDifficulty: PermitDifficulty
  adjacentParcels: number
}

export interface Site {
  id: string
  regionId: string
  name: string
  /** True while the site and its numbers are invented. */
  placeholder: boolean
  traits: SiteTraits
  /** Static elevation file in public/sites/, if this site has real terrain. */
  terrainId?: string
  /** Trait values that are PLACEHOLDER guesses rather than sourced or derived. */
  unverified?: (keyof SiteTraits)[]
  /** Where the verified values came from. */
  notes?: string
}

// Region list is a proposal for the owner to review (step 2).
export const REGIONS: Region[] = [
  { id: 'new-england', name: 'New England', country: 'US', blurb: 'Big crowds, icy snow, short drives from Boston and New York.' },
  { id: 'mid-atlantic', name: 'Mid-Atlantic & Appalachia', country: 'US', blurb: 'Low vertical, marginal climate, huge metro demand.' },
  { id: 'upper-midwest', name: 'Upper Midwest', country: 'US', blurb: 'Small hills, cold winters, loyal locals.' },
  { id: 'colorado', name: 'Colorado Rockies', country: 'US', blurb: 'Dry snow, high altitude, expensive land.' },
  { id: 'utah', name: 'Utah & Wasatch', country: 'US', blurb: 'Deep snow close to a major airport.' },
  { id: 'northern-rockies', name: 'Northern Rockies', country: 'US', blurb: 'Montana, Idaho, Wyoming. Remote and cheap.' },
  { id: 'sierra', name: 'Sierra Nevada', country: 'US', blurb: 'Heavy wet storms, then drought years.' },
  { id: 'pacific-nw', name: 'Pacific Northwest', country: 'US', blurb: 'Lots of snowfall, rain risk at the base.' },
  { id: 'southwest', name: 'Southwest', country: 'US', blurb: 'High peaks, sunny, boom-or-bust snow.' },
  { id: 'alps', name: 'European Alps', country: 'INTL', blurb: 'Destination travel and strict permitting.' },
  { id: 'canada-west', name: 'Western Canada', country: 'INTL', blurb: 'British Columbia and Alberta. Big terrain.' },
  { id: 'japan', name: 'Japan', country: 'INTL', blurb: 'Famous powder, strong international demand.' },
  { id: 'andes', name: 'Southern Andes', country: 'INTL', blurb: 'Chile and Argentina. Seasons are flipped.' },
]

export const SITES: Site[] = [
  {
    id: 'co-berthoud-pass', regionId: 'colorado', name: 'Berthoud Pass', placeholder: false,
    terrainId: 'co-berthoud-pass',
    // verticalDropFt = max - min elevation in the 4 km x 4 km USGS 3DEP window
    // (3022-3808 m), i.e. an upper bound for the parcel, not a measured ski run.
    traits: { verticalDropFt: 2580, aspect: 'N', avgSnowfallIn: 300, landPriceUsd: 3_000_000,
      driveToInterstateMin: 20, nearestMetro: 'Denver', driveToMetroMin: 75,
      waterRights: 'fair', permitDifficulty: 'hard', adjacentParcels: 2 },
    unverified: ['aspect', 'avgSnowfallIn', 'landPriceUsd', 'driveToInterstateMin', 'driveToMetroMin',
      'waterRights', 'permitDifficulty', 'adjacentParcels'],
    notes: 'Real terrain from USGS 3DEP. Former ski area on a US-40 mountain pass. Vertical drop is derived from the elevation data; all other values are PLACEHOLDER estimates.',
  },
  {
    id: 'ph-north-knob', regionId: 'new-england', name: 'North Knob (placeholder)', placeholder: true,
    traits: { verticalDropFt: 1200, aspect: 'N', avgSnowfallIn: 140, landPriceUsd: 2_500_000,
      driveToInterstateMin: 20, nearestMetro: 'Placeholder City', driveToMetroMin: 150,
      waterRights: 'good', permitDifficulty: 'moderate', adjacentParcels: 2 },
  },
  {
    id: 'ph-sunny-ridge', regionId: 'new-england', name: 'Sunny Ridge (placeholder)', placeholder: true,
    traits: { verticalDropFt: 1800, aspect: 'S', avgSnowfallIn: 110, landPriceUsd: 1_600_000,
      driveToInterstateMin: 45, nearestMetro: 'Placeholder City', driveToMetroMin: 200,
      waterRights: 'fair', permitDifficulty: 'easy', adjacentParcels: 3 },
  },
  {
    id: 'ph-big-hollow', regionId: 'new-england', name: 'Big Hollow (placeholder)', placeholder: true,
    traits: { verticalDropFt: 2600, aspect: 'NE', avgSnowfallIn: 190, landPriceUsd: 4_200_000,
      driveToInterstateMin: 70, nearestMetro: 'Placeholder City', driveToMetroMin: 260,
      waterRights: 'poor', permitDifficulty: 'hard', adjacentParcels: 1 },
  },
]

export function sitesInRegion(regionId: string): Site[] {
  return SITES.filter((s) => s.regionId === regionId)
}

export function regionById(id: string): Region | undefined {
  return REGIONS.find((r) => r.id === id)
}

export function siteById(id: string): Site | undefined {
  return SITES.find((s) => s.id === id)
}

/** North-ish aspects hold snow better. Returns 0 (south) .. 1 (north). */
export function aspectSnowRetention(aspect: Aspect): number {
  const deg: Record<Aspect, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 }
  return (1 + Math.cos((deg[aspect] * Math.PI) / 180)) / 2
}

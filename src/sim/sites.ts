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
  /** PLACEHOLDER: base price of raw mountain land per acre, before site factors. */
  baseLandUsdPerAcre: number
}

export interface SiteTraits {
  verticalDropFt: number
  aspect: Aspect
  avgSnowfallIn: number
  /** Parcel size. Real sites: area of the preprocessed terrain window. */
  acres: number
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
  /**
   * Parcel id with road access. It is always the starter parcel: base area,
   * parking and the access road go here, and the resort expands outward from it.
   */
  accessParcel?: string
  /** Short description of the road that reaches the access parcel. */
  accessRoad?: string
}

// Region list approved by owner (step 2). baseLandUsdPerAcre values are PLACEHOLDERS:
// only their rough ordering (resort regions near big metros cost more) is intended.
export const REGIONS: Region[] = [
  { id: 'new-england', name: 'New England', country: 'US', blurb: 'Big crowds, icy snow, short drives from Boston and New York.', baseLandUsdPerAcre: 1800 },
  { id: 'mid-atlantic', name: 'Mid-Atlantic & Appalachia', country: 'US', blurb: 'Low vertical, marginal climate, huge metro demand.', baseLandUsdPerAcre: 2000 },
  { id: 'upper-midwest', name: 'Upper Midwest', country: 'US', blurb: 'Small hills, cold winters, loyal locals.', baseLandUsdPerAcre: 1200 },
  { id: 'colorado', name: 'Colorado Rockies', country: 'US', blurb: 'Dry snow, high altitude, expensive land.', baseLandUsdPerAcre: 2500 },
  { id: 'utah', name: 'Utah & Wasatch', country: 'US', blurb: 'Deep snow close to a major airport.', baseLandUsdPerAcre: 2200 },
  { id: 'northern-rockies', name: 'Northern Rockies', country: 'US', blurb: 'Montana, Idaho, Wyoming. Remote and cheap.', baseLandUsdPerAcre: 900 },
  { id: 'sierra', name: 'Sierra Nevada', country: 'US', blurb: 'Heavy wet storms, then drought years.', baseLandUsdPerAcre: 2400 },
  { id: 'pacific-nw', name: 'Pacific Northwest', country: 'US', blurb: 'Lots of snowfall, rain risk at the base.', baseLandUsdPerAcre: 1500 },
  { id: 'southwest', name: 'Southwest', country: 'US', blurb: 'High peaks, sunny, boom-or-bust snow.', baseLandUsdPerAcre: 1000 },
  { id: 'alps', name: 'European Alps', country: 'INTL', blurb: 'Destination travel and strict permitting.', baseLandUsdPerAcre: 4000 },
  { id: 'canada-west', name: 'Western Canada', country: 'INTL', blurb: 'British Columbia and Alberta. Big terrain.', baseLandUsdPerAcre: 1400 },
  { id: 'japan', name: 'Japan', country: 'INTL', blurb: 'Famous powder, strong international demand.', baseLandUsdPerAcre: 2000 },
  { id: 'andes', name: 'Southern Andes', country: 'INTL', blurb: 'Chile and Argentina. Seasons are flipped.', baseLandUsdPerAcre: 700 },
]

export const SITES: Site[] = [
  {
    id: 'co-berthoud-pass', regionId: 'colorado', name: 'Berthoud Pass', placeholder: false,
    terrainId: 'co-berthoud-pass',
    // The terrain window is centred on the pass summit, where US-40 crosses, so the
    // highway runs through the centre parcel.
    accessParcel: 'r1c1',
    accessRoad: 'US-40 crosses the pass here',
    // verticalDropFt = max - min elevation in the 4 km x 4 km USGS 3DEP window
    // (3022-3808 m), i.e. an upper bound for the parcel, not a measured ski run.
    // acres = the 4 km x 4 km window (16 km^2 = 3954 acres).
    traits: { verticalDropFt: 2580, aspect: 'N', avgSnowfallIn: 300, acres: 3954,
      driveToInterstateMin: 20, nearestMetro: 'Denver', driveToMetroMin: 75,
      waterRights: 'fair', permitDifficulty: 'hard', adjacentParcels: 2 },
    unverified: ['aspect', 'avgSnowfallIn', 'driveToInterstateMin', 'driveToMetroMin',
      'waterRights', 'permitDifficulty', 'adjacentParcels'],
    notes: 'Real terrain from USGS 3DEP. Former ski area on a US-40 mountain pass. Vertical drop and acreage are derived from the elevation data; other values are PLACEHOLDER estimates.',
  },
  {
    id: 'ph-north-knob', regionId: 'new-england', name: 'North Knob (placeholder)', placeholder: true,
    traits: { verticalDropFt: 1200, aspect: 'N', avgSnowfallIn: 140, acres: 900,
      driveToInterstateMin: 20, nearestMetro: 'Placeholder City', driveToMetroMin: 150,
      waterRights: 'good', permitDifficulty: 'moderate', adjacentParcels: 2 },
  },
  {
    id: 'ph-sunny-ridge', regionId: 'new-england', name: 'Sunny Ridge (placeholder)', placeholder: true,
    traits: { verticalDropFt: 1800, aspect: 'S', avgSnowfallIn: 110, acres: 1400,
      driveToInterstateMin: 45, nearestMetro: 'Placeholder City', driveToMetroMin: 200,
      waterRights: 'fair', permitDifficulty: 'easy', adjacentParcels: 3 },
  },
  {
    id: 'ph-big-hollow', regionId: 'new-england', name: 'Big Hollow (placeholder)', placeholder: true,
    traits: { verticalDropFt: 2600, aspect: 'NE', avgSnowfallIn: 190, acres: 2600,
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

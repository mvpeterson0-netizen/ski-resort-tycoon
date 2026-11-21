#!/usr/bin/env node
/**
 * One-time preprocessing: cut a square window of USGS 3DEP elevation around a curated
 * site, resample it to a north-up grid of square cells, and write a small static file.
 *
 *   NODE_USE_ENV_PROXY=1 node scripts/build-site-dem.mjs co-berthoud-pass
 *
 * Output (committed to the repo):
 *   public/sites/<id>.dem.bin   Uint16 little-endian, elevation in decimetres, row 0 = north
 *   public/sites/<id>.json      metadata (size, cell size, bounds, source, retrieval date)
 *
 * Only the needed internal tiles of the GeoTIFF are fetched (HTTP range requests).
 */
import { fromUrl } from 'geotiff'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const id = process.argv[2]
const cfg = JSON.parse(await readFile(new URL('./site-sources.json', import.meta.url), 'utf8'))
const site = cfg.sites.find((s) => s.id === id)
if (!site) {
  console.error(`Unknown site "${id}". Known: ${cfg.sites.map((s) => s.id).join(', ')}`)
  process.exit(1)
}

const url = `https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/${site.tile}/USGS_13_${site.tile}.tif`
console.log(`Reading ${url}`)
const tiff = await fromUrl(url)
const img = await tiff.getImage()
const [x0, , , y1] = img.getBoundingBox()
const [rx, ry] = img.getResolution() // degrees per pixel (ry negative)

// Square window in metres around the centre, converted to degrees (spherical approx,
// fine at this scale).
const mPerDegLat = 111_320
const mPerDegLon = 111_320 * Math.cos((site.centerLat * Math.PI) / 180)
const half = site.sizeM / 2
const north = site.centerLat + half / mPerDegLat
const south = site.centerLat - half / mPerDegLat
const west = site.centerLon - half / mPerDegLon
const east = site.centerLon + half / mPerDegLon

// Source pixel window (with a 1px margin for bilinear sampling).
const px0 = Math.floor((west - x0) / rx) - 1
const px1 = Math.ceil((east - x0) / rx) + 1
const py0 = Math.floor((north - y1) / ry) - 1
const py1 = Math.ceil((south - y1) / ry) + 1
const sw = px1 - px0
const sh = py1 - py0
console.log(`Source window ${sw}x${sh} px`)
const [src] = await img.readRasters({ window: [px0, py0, px1, py1] })
const noData = img.getGDALNoData()

const n = Math.round(site.sizeM / site.cellM)
const out = new Uint16Array(n * n)
let min = Infinity
let max = -Infinity
for (let row = 0; row < n; row++) {
  const lat = north - ((row + 0.5) * site.cellM) / mPerDegLat
  const fy = (lat - y1) / ry - py0
  for (let col = 0; col < n; col++) {
    const lon = west + ((col + 0.5) * site.cellM) / mPerDegLon
    const fx = (lon - x0) / rx - px0
    const ix = Math.floor(fx)
    const iy = Math.floor(fy)
    const tx = fx - ix
    const ty = fy - iy
    const at = (x, y) => {
      const v = src[y * sw + x]
      if (noData !== null && v === noData) throw new Error(`NoData at ${x},${y}`)
      return v
    }
    const e =
      at(ix, iy) * (1 - tx) * (1 - ty) +
      at(ix + 1, iy) * tx * (1 - ty) +
      at(ix, iy + 1) * (1 - tx) * ty +
      at(ix + 1, iy + 1) * tx * ty
    min = Math.min(min, e)
    max = Math.max(max, e)
    out[row * n + col] = Math.round(e * 10)
  }
}

await mkdir(new URL('../public/sites/', import.meta.url), { recursive: true })
await writeFile(new URL(`../public/sites/${id}.dem.bin`, import.meta.url), Buffer.from(out.buffer))
const meta = {
  id,
  name: site.name,
  width: n,
  height: n,
  cellM: site.cellM,
  bounds: { north, south, east, west },
  center: { lat: site.centerLat, lon: site.centerLon },
  minElevM: Math.round(min * 10) / 10,
  maxElevM: Math.round(max * 10) / 10,
  encoding: 'uint16-le-decimetres-north-up',
  source: 'USGS 3D Elevation Program (3DEP), 1/3 arc-second DEM',
  sourceUrl: url,
  retrieved: new Date().toISOString().slice(0, 10),
}
await writeFile(new URL(`../public/sites/${id}.json`, import.meta.url), JSON.stringify(meta, null, 2) + '\n')
console.log(`Wrote ${n}x${n} grid, elevation ${meta.minElevM}-${meta.maxElevM} m`)

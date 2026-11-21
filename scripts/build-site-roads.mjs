#!/usr/bin/env node
/**
 * One-time road preprocessing for a curated site (like build-site-dem.mjs).
 *
 * Source: USGS National Transportation Dataset (NTD), state shapefile zip on the public
 * bucket prd-tnm.s3.amazonaws.com/StagedProducts/Tran/Shape/. The dataset's own metadata
 * (TRAN_<State>_State_Shape.xml) describes it as public domain with no use constraints;
 * "acknowledgment of the U.S. Geological Survey would be appreciated".
 *
 * Reads the zip's directory with HTTP range requests, then streams only the road-segment
 * .shp/.dbf entries, keeping segments that cross the site's terrain window.
 *
 * Usage: npm run build:roads -- <site-id>
 * Output: public/sites/<id>.roads.json  (polylines in terrain cell coordinates)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createInflateRaw } from 'node:zlib'
import { Readable } from 'node:stream'

const id = process.argv[2]
if (!id) { console.error('usage: build-site-roads <site-id>'); process.exit(1) }
const srcs = JSON.parse(readFileSync(new URL('./site-sources.json', import.meta.url), 'utf8'))
const site = srcs.sites.find((s) => s.id === id)
if (!site?.roadsState) { console.error(`site ${id} has no "roadsState" in site-sources.json`); process.exit(1) }
const meta = JSON.parse(readFileSync(new URL(`../public/sites/${id}.json`, import.meta.url), 'utf8'))
const { north, south, east, west } = meta.bounds
const url = `https://prd-tnm.s3.amazonaws.com/StagedProducts/Tran/Shape/TRAN_${site.roadsState}_State_Shape.zip`

const range = async (a, b) => {
  const r = await fetch(url, { headers: { Range: `bytes=${a}-${b}` } })
  if (r.status !== 206) throw new Error(`range ${a}-${b}: HTTP ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}

// ---- zip directory ----
const head = await fetch(url, { method: 'HEAD' })
const size = Number(head.headers.get('content-length'))
const tail = await range(size - 65536, size - 1)
const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
const cd = await range(tail.readUInt32LE(eocd + 16), tail.readUInt32LE(eocd + 16) + tail.readUInt32LE(eocd + 12) - 1)
const entries = []
for (let p = 0; p < cd.length && cd.readUInt32LE(p) === 0x02014b50;) {
  const n = cd.readUInt16LE(p + 28), e = cd.readUInt16LE(p + 30), c = cd.readUInt16LE(p + 32)
  entries.push({ name: cd.toString('utf8', p + 46, p + 46 + n), method: cd.readUInt16LE(p + 10), csize: cd.readUInt32LE(p + 20), offset: cd.readUInt32LE(p + 42) })
  p += 46 + n + e + c
}

/** Stream one zip entry's uncompressed bytes. */
async function* entryStream(entry) {
  const lh = await range(entry.offset, entry.offset + 29)
  const start = entry.offset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28)
  const r = await fetch(url, { headers: { Range: `bytes=${start}-${start + entry.csize - 1}` } })
  const body = Readable.fromWeb(r.body)
  yield* entry.method === 8 ? body.pipe(createInflateRaw()) : body
}

/** Pull exactly n bytes at a time from a chunk stream. */
function reader(stream) {
  const it = stream[Symbol.asyncIterator]()
  let buf = Buffer.alloc(0)
  return async (n) => {
    while (buf.length < n) {
      const { value, done } = await it.next()
      if (done) return null
      buf = buf.length ? Buffer.concat([buf, value]) : value
    }
    const out = buf.subarray(0, n)
    buf = buf.subarray(n)
    return out
  }
}

// ---- shapefile: keep polylines touching the window (small margin) ----
const m = 0.002
const hit = (x0, y0, x1, y1) => x1 >= west - m && x0 <= east + m && y1 >= south - m && y0 <= north + m
const toCell = (lon, lat) => [
  Math.round(((lon - west) / (east - west)) * meta.width * 10 - 5) / 10,
  Math.round(((north - lat) / (north - south)) * meta.height * 10 - 5) / 10,
]

const kept = new Map() // record index (0-based) -> parts
let base = 0
for (const shpName of entries.filter((e) => /Trans_RoadSegment_\d+\.shp$/.test(e.name)).map((e) => e.name).sort()) {
  const read = reader(entryStream(entries.find((e) => e.name === shpName)))
  await read(100)
  let i = 0
  for (;;) {
    const rh = await read(8)
    if (!rh) break
    const rec = await read(rh.readInt32BE(4) * 2)
    const type = rec.readInt32LE(0)
    if (type !== 0) {
      const [x0, y0, x1, y1] = [4, 12, 20, 28].map((o) => rec.readDoubleLE(o))
      if (hit(x0, y0, x1, y1)) {
        const np = rec.readInt32LE(36), npts = rec.readInt32LE(40)
        const parts = []
        for (let p = 0; p < np; p++) {
          const s = rec.readInt32LE(44 + p * 4), e = p + 1 < np ? rec.readInt32LE(44 + (p + 1) * 4) : npts
          const pts = []
          for (let k = s; k < e; k++) {
            const o = 44 + np * 4 + k * 16
            pts.push(toCell(rec.readDoubleLE(o), rec.readDoubleLE(o + 8)))
          }
          parts.push(pts)
        }
        kept.set(base + i, parts)
      }
    }
    i++
  }
  console.log(`${shpName}: ${i} records, ${kept.size} kept so far`)
  // dbf for the same file
  const read2 = reader(entryStream(entries.find((e) => e.name === shpName.replace('.shp', '.dbf'))))
  const h = await read2(32)
  const nrec = h.readUInt32LE(4), hlen = h.readUInt16LE(8), rlen = h.readUInt16LE(10)
  const fh = await read2(hlen - 32)
  const fields = []
  let off = 1
  for (let p = 0; fh[p] !== 0x0d; p += 32) {
    const name = fh.toString('latin1', p, p + 11).replace(/\0.*$/, '')
    const len = fh[p + 16]
    fields.push({ name, off, len })
    off += len
  }
  const want = ['name', 'tnmfrc', 'us_route', 'state_rout', 'mtfcc_code']
  const fs = fields.filter((f) => want.includes(f.name.toLowerCase()))
  for (let r = 0; r < nrec; r++) {
    const row = await read2(rlen)
    if (!row) break
    const parts = kept.get(base + r)
    if (!parts) continue
    const attrs = {}
    for (const f of fs) attrs[f.name.toLowerCase()] = row.toString('latin1', f.off, f.off + f.len).trim()
    kept.set(base + r, { parts, attrs })
  }
  console.log(`  dbf fields used: ${fs.map((f) => f.name).join(', ') || '(none found: ' + fields.map((f) => f.name).join(',') + ')'}`)
  base += i
}

const roads = [...kept.values()].filter((v) => v.parts).map(({ parts, attrs }) => ({
  name: attrs.name || (attrs.us_route ? `US-${attrs.us_route}` : attrs.state_rout ? `CO-${attrs.state_rout}` : ''),
  /** NTD functional road class (tnmfrc); lower = bigger road. Raw value kept, meaning per NTD docs. */
  cls: Number(attrs.tnmfrc) || 5,
  mtfcc: attrs.mtfcc_code || '',
  parts,
}))
const out = {
  id,
  source: 'USGS National Transportation Dataset (NTD), roads',
  sourceUrl: url,
  retrieved: new Date().toISOString().slice(0, 10),
  coords: 'terrain cell coordinates (col, row), same grid as the DEM',
  roads,
}
writeFileSync(new URL(`../public/sites/${id}.roads.json`, import.meta.url), JSON.stringify(out))
console.log(`wrote ${roads.length} road segments: ${[...new Set(roads.map((r) => r.name))].join(' | ')}`)

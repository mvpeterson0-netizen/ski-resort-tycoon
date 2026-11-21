/**
 * Terrain grid and derived quantities (slope, hillshade, contours). Pure functions.
 * Grid is north-up: index = row * width + col, row 0 = north edge.
 */

export interface TerrainMeta {
  id: string
  name: string
  width: number
  height: number
  cellM: number
  minElevM: number
  maxElevM: number
  source: string
  retrieved: string
}

export interface Terrain {
  width: number
  height: number
  cellM: number
  /** Elevation in metres. */
  elev: Float32Array
}

/** Decode the uint16 little-endian decimetre format written by scripts/build-site-dem.mjs. */
export function decodeDem(buf: ArrayBuffer, width: number, height: number, cellM: number): Terrain {
  const view = new DataView(buf)
  if (buf.byteLength !== width * height * 2) {
    throw new Error(`DEM size mismatch: ${buf.byteLength} bytes for ${width}x${height}`)
  }
  const elev = new Float32Array(width * height)
  for (let i = 0; i < elev.length; i++) elev[i] = view.getUint16(i * 2, true) / 10
  return { width, height, cellM, elev }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Elevation at grid index, clamped to the edges. */
export function elevAtCell(t: Terrain, col: number, row: number): number {
  return t.elev[clamp(row, 0, t.height - 1) * t.width + clamp(col, 0, t.width - 1)]
}

/** Bilinear elevation at fractional grid coordinates (cell centres at integers). */
export function elevAt(t: Terrain, x: number, y: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const tx = x - ix
  const ty = y - iy
  return (
    elevAtCell(t, ix, iy) * (1 - tx) * (1 - ty) +
    elevAtCell(t, ix + 1, iy) * tx * (1 - ty) +
    elevAtCell(t, ix, iy + 1) * (1 - tx) * ty +
    elevAtCell(t, ix + 1, iy + 1) * tx * ty
  )
}

/** Surface gradient (dz/dx east, dz/dy south) in m/m, central differences. */
function gradient(t: Terrain, col: number, row: number): [number, number] {
  const dzdx = (elevAtCell(t, col + 1, row) - elevAtCell(t, col - 1, row)) / (2 * t.cellM)
  const dzdy = (elevAtCell(t, col, row + 1) - elevAtCell(t, col, row - 1)) / (2 * t.cellM)
  return [dzdx, dzdy]
}

/** Slope angle in degrees at a cell. */
export function slopeDeg(t: Terrain, col: number, row: number): number {
  const [gx, gy] = gradient(t, col, row)
  return (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI
}

/**
 * Hillshade in [0, 1] for every cell. Sun from azimuth (degrees clockwise from north)
 * and altitude (degrees above horizon). Standard Lambertian shading.
 */
export function hillshade(t: Terrain, azimuthDeg = 315, altitudeDeg = 45, zFactor = 1): Float32Array {
  const out = new Float32Array(t.width * t.height)
  const az = (azimuthDeg * Math.PI) / 180
  const alt = (altitudeDeg * Math.PI) / 180
  // Light direction vector (x east, y north, z up).
  const lx = Math.sin(az) * Math.cos(alt)
  const ly = Math.cos(az) * Math.cos(alt)
  const lz = Math.sin(alt)
  for (let row = 0; row < t.height; row++) {
    for (let col = 0; col < t.width; col++) {
      const [gx, gyS] = gradient(t, col, row)
      // Surface normal = (-dz/dx, -dz/dy_north, 1); dz/dy_north = -dz/dy_south.
      const nx = -gx * zFactor
      const ny = gyS * zFactor
      const len = Math.hypot(nx, ny, 1)
      out[row * t.width + col] = clamp((nx * lx + ny * ly + lz) / len, 0, 1)
    }
  }
  return out
}

/** A contour line segment in grid coordinates. */
export type Segment = [number, number, number, number]

/**
 * Marching-squares contour segments at a single elevation level.
 * Saddle cases are resolved with the cell-centre average.
 */
export function contourSegments(t: Terrain, level: number): Segment[] {
  const segs: Segment[] = []
  const { width: w, height: h, elev } = t
  for (let row = 0; row < h - 1; row++) {
    for (let col = 0; col < w - 1; col++) {
      const a = elev[row * w + col] // top-left
      const b = elev[row * w + col + 1] // top-right
      const c = elev[(row + 1) * w + col + 1] // bottom-right
      const d = elev[(row + 1) * w + col] // bottom-left
      const idx = (a >= level ? 8 : 0) | (b >= level ? 4 : 0) | (c >= level ? 2 : 0) | (d >= level ? 1 : 0)
      if (idx === 0 || idx === 15) continue
      const lerp = (v1: number, v2: number) => (level - v1) / (v2 - v1)
      const top: [number, number] = [col + lerp(a, b), row]
      const right: [number, number] = [col + 1, row + lerp(b, c)]
      const bottom: [number, number] = [col + lerp(d, c), row + 1]
      const left: [number, number] = [col, row + lerp(a, d)]
      const add = (p: [number, number], q: [number, number]) => segs.push([p[0], p[1], q[0], q[1]])
      switch (idx) {
        case 1: case 14: add(left, bottom); break
        case 2: case 13: add(bottom, right); break
        case 3: case 12: add(left, right); break
        case 4: case 11: add(top, right); break
        case 6: case 9: add(top, bottom); break
        case 7: case 8: add(left, top); break
        case 5: case 10: {
          const centreHigh = (a + b + c + d) / 4 >= level
          if ((idx === 5) === centreHigh) { add(left, top); add(bottom, right) }
          else { add(top, right); add(left, bottom) }
          break
        }
      }
    }
  }
  return segs
}

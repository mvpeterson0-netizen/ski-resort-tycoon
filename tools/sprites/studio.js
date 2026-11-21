/**
 * Sprite studio (dev tool, never shipped): builds each base-village building as a small
 * 3D model with three.js, lights it like a winter afternoon, and renders it to a
 * transparent PNG seen from the south at a fixed oblique angle. The game then draws these
 * images on the 2D map, so there is no 3D at runtime.
 *
 * Units are metres. three.js axes: x = east, y = up, z = south (north = -z).
 * All designs are original and generic (North American ski-lodge vernacular).
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

export const PX_PER_M = 10
const PITCH_DEG = 38 // camera elevation above the horizon

// ---------- deterministic randomness ----------
let seed = 1
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const pick = (a) => a[Math.floor(rnd() * a.length)]

// ---------- procedural textures ----------
function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(...repeat)
  t.anisotropy = 8
  return t
}
const shade = (hex, f) => {
  const c = new THREE.Color(hex)
  c.offsetHSL(0, 0, f)
  return `#${c.getHexString()}`
}

/** Horizontal logs with rounded shading and chinking. */
const logsTex = (base) => canvasTex(256, 256, (g, w, h) => {
  const n = 8
  for (let i = 0; i < n; i++) {
    const y = (i * h) / n, lh = h / n
    const grd = g.createLinearGradient(0, y, 0, y + lh)
    const b = shade(base, (rnd() - 0.5) * 0.06)
    grd.addColorStop(0, shade(b, -0.12)); grd.addColorStop(0.3, shade(b, 0.06)); grd.addColorStop(0.75, b); grd.addColorStop(1, shade(b, -0.18))
    g.fillStyle = grd
    g.fillRect(0, y, w, lh)
    g.strokeStyle = 'rgba(40,25,15,0.25)'
    for (let k = 0; k < 6; k++) { g.beginPath(); const yy = y + rnd() * lh; g.moveTo(0, yy); g.bezierCurveTo(w * 0.3, yy + 2, w * 0.6, yy - 2, w, yy + 1); g.stroke() }
    g.fillStyle = '#d9cfbf'
    g.fillRect(0, y + lh - 2, w, 2)
  }
})

/** Board-and-batten siding. */
const boardTex = (base) => canvasTex(256, 256, (g, w, h) => {
  const n = 10
  for (let i = 0; i < n; i++) {
    g.fillStyle = shade(base, (rnd() - 0.5) * 0.07)
    g.fillRect((i * w) / n, 0, w / n, h)
    g.strokeStyle = 'rgba(30,20,10,0.18)'
    for (let k = 0; k < 5; k++) { const x = (i + rnd()) * (w / n); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (rnd() - 0.5) * 4, h); g.stroke() }
    g.fillStyle = shade(base, -0.12)
    g.fillRect(((i + 1) * w) / n - 3, 0, 3, h)
    g.fillStyle = shade(base, 0.06)
    g.fillRect(((i + 1) * w) / n - 5, 0, 2, h)
  }
})

/** Fieldstone. */
const stoneTex = () => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#6f6a62'
  g.fillRect(0, 0, w, h)
  for (let y = 0; y < h; y += 26) {
    for (let x = -20; x < w; x += 30 + rnd() * 16) {
      const sw = 26 + rnd() * 18, sh = 18 + rnd() * 8
      g.fillStyle = pick(['#9a9286', '#a8a196', '#8b857b', '#b3aa9b', '#958a7c'])
      g.beginPath(); g.ellipse(x + sw / 2, y + 13 + (rnd() - 0.5) * 4, sw / 2, sh / 2, (rnd() - 0.5) * 0.3, 0, Math.PI * 2); g.fill()
      g.fillStyle = 'rgba(255,255,255,0.12)'
      g.beginPath(); g.ellipse(x + sw / 2 - 3, y + 9, sw / 3, sh / 5, 0, 0, Math.PI * 2); g.fill()
    }
  }
})

/** Standing-seam metal roof. */
const metalTex = (base) => canvasTex(256, 64, (g, w, h) => {
  g.fillStyle = base
  g.fillRect(0, 0, w, h)
  for (let x = 0; x < w; x += 16) {
    g.fillStyle = shade(base, 0.08); g.fillRect(x, 0, 2, h)
    g.fillStyle = shade(base, -0.1); g.fillRect(x + 2, 0, 2, h)
  }
})

/** Snow with faint wind texture. */
const snowTex = () => canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#f6f8fb'
  g.fillRect(0, 0, w, h)
  // Wind ripples and soft blue hollows so snow has form, not a flat white.
  for (let i = 0; i < 90; i++) {
    const y = rnd() * h, x = rnd() * w, len = 60 + rnd() * 200
    const grd = g.createLinearGradient(x, y - 6, x, y + 6)
    grd.addColorStop(0, 'rgba(170,190,220,0)'); grd.addColorStop(0.5, `rgba(170,190,220,${0.12 + rnd() * 0.15})`); grd.addColorStop(1, 'rgba(170,190,220,0)')
    g.fillStyle = grd
    g.beginPath(); g.ellipse(x, y, len / 2, 4 + rnd() * 5, (rnd() - 0.5) * 0.25, 0, Math.PI * 2); g.fill()
  }
  for (let i = 0; i < 700; i++) {
    g.fillStyle = `rgba(${rnd() < 0.6 ? '205,216,232' : '255,255,255'},${0.2 + rnd() * 0.3})`
    g.beginPath(); g.ellipse(rnd() * w, rnd() * h, 1 + rnd() * 6, 1 + rnd() * 2, rnd(), 0, Math.PI * 2); g.fill()
  }
}, [0.5, 0.5])

const deckTex = () => canvasTex(256, 256, (g, w, h) => {
  for (let i = 0; i < 16; i++) {
    g.fillStyle = shade('#a07850', (rnd() - 0.5) * 0.08)
    g.fillRect(0, (i * h) / 16, w, h / 16 - 1)
  }
  g.fillStyle = 'rgba(255,255,255,0.35)' // dusting of snow
  for (let i = 0; i < 200; i++) g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 6, 1 + rnd() * 2)
})

const pavingTex = () => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#b9ad98'
  g.fillRect(0, 0, w, h)
  for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? -12 : 0; x < w; x += 24) {
    g.fillStyle = shade('#c8bca6', (rnd() - 0.5) * 0.08)
    g.fillRect(x + 1, y + 1, 22, 14)
  }
  g.fillStyle = 'rgba(255,255,255,0.5)'
  for (let i = 0; i < 160; i++) g.fillRect(rnd() * w, rnd() * h, 3 + rnd() * 10, 2 + rnd() * 4)
})

const sidingTex = (base) => canvasTex(256, 256, (g, w, h) => {
  for (let i = 0; i < 16; i++) {
    const y = (i * h) / 16
    const grd = g.createLinearGradient(0, y, 0, y + h / 16)
    grd.addColorStop(0, shade(base, 0.05)); grd.addColorStop(1, shade(base, -0.08))
    g.fillStyle = grd
    g.fillRect(0, y, w, h / 16)
  }
})

// ---------- materials ----------
const M = {}
function mats() {
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o })
  M.logs = std({ map: logsTex('#8a5a36') })
  M.logsDark = std({ map: logsTex('#6e4528') })
  M.boardBrown = std({ map: boardTex('#7b5236') })
  M.boardBlue = std({ map: boardTex('#465d74') })
  M.boardRed = std({ map: boardTex('#9e3d31') })
  M.boardGrey = std({ map: boardTex('#7d8288') })
  M.siding = std({ map: sidingTex('#d8c9a8') })
  M.sidingGrey = std({ map: sidingTex('#c7cbd0') })
  M.stone = std({ map: stoneTex(), roughness: 0.95 })
  M.roofGreen = std({ map: metalTex('#3e5a48'), metalness: 0.35, roughness: 0.5 })
  M.roofRed = std({ map: metalTex('#7d2f28'), metalness: 0.35, roughness: 0.5 })
  M.roofBrown = std({ map: metalTex('#4c3a2d'), metalness: 0.3, roughness: 0.55 })
  M.roofSlate = std({ map: metalTex('#3b4652'), metalness: 0.35, roughness: 0.5 })
  M.snow = std({ map: snowTex(), roughness: 0.95, color: '#f4f7fb' })
  M.timber = std({ color: '#5a3b24' })
  M.trim = std({ color: '#3a2a1e' })
  M.glass = std({ color: '#ffcf7a', emissive: '#ffb347', emissiveIntensity: 0.55, roughness: 0.3 })
  M.glassCool = std({ color: '#8fa6bc', roughness: 0.15, metalness: 0.4 })
  M.deck = std({ map: deckTex() })
  M.paving = std({ map: pavingTex() })
  M.concrete = std({ color: '#a9a9a4' })
  M.steel = std({ color: '#5f6870', metalness: 0.6, roughness: 0.4 })
  M.yellow = std({ color: '#e0a92b', metalness: 0.3, roughness: 0.5 })
  M.fire = std({ color: '#ff8a3a', emissive: '#ff6a1a', emissiveIntensity: 1.4 })
  M.firewood = std({ color: '#7a5233' })
  M.belt = std({ color: '#2d3339', roughness: 0.6 })
  M.terminal = std({ color: '#4f6a86', metalness: 0.3, roughness: 0.5 })
  M.carpet = std({ color: '#8d969e', roughness: 0.7 })
  M.rail = std({ color: '#eef2f5', roughness: 0.5 })
  M.ice = std({ color: '#d8ecff', roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85 })
}

// ---------- building blocks ----------
const box = (w, h, d, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.set(x, y + h / 2, z)
  return m
}
const soft = (w, h, d, mat, r, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2)), mat)
  m.position.set(x, y + h / 2, z)
  return m
}

/** Walls with a wall material and optional stone base. */
function walls(g, w, d, h, mat, stoneH = 0) {
  if (stoneH) g.add(box(w + 0.1, stoneH, d + 0.1, M.stone))
  g.add(box(w, h - stoneH, d, mat, 0, stoneH))
}

/**
 * Gable roof. ridge 'x' = ridge runs east-west (slopes face north/south);
 * 'z' = ridge runs north-south (gable ends face south/north).
 */
function gableRoof(g, w, d, h, rise, roofMat, ridge = 'x', over = 0.7, gableMat = null) {
  const span = ridge === 'x' ? d : w // horizontal distance across the slopes
  const len = (ridge === 'x' ? w : d) + over * 2
  const half = span / 2 + over
  const slopeLen = Math.hypot(half, rise * (half / (span / 2)))
  const ang = Math.atan2(rise, span / 2)
  const t = 0.25
  for (const s of [-1, 1]) {
    const roof = new THREE.Group()
    const slab = new THREE.Mesh(new THREE.BoxGeometry(ridge === 'x' ? len : slopeLen, t, ridge === 'x' ? slopeLen : len), roofMat)
    roof.add(slab)
    // Snow blanket on the slab: slightly inset, rounded, thicker in the middle.
    // Snow blanket: stops short of the eave so a band of metal roof shows, with a soft lip.
    const bare = Math.min(0.9, slopeLen * 0.12)
    const sl = slopeLen - bare - 0.2
    const sn = new THREE.Mesh(new RoundedBoxGeometry(ridge === 'x' ? len - 0.4 : sl, 0.45, ridge === 'x' ? sl : len - 0.4, 3, 0.2), M.snow)
    sn.position.y = 0.28
    sn.position[ridge === 'x' ? 'z' : 'x'] = -s * (bare / 2)
    roof.add(sn)
    // Fascia board along the eave.
    const fas = new THREE.Mesh(new THREE.BoxGeometry(ridge === 'x' ? len : 0.18, 0.35, ridge === 'x' ? 0.18 : len), M.trim)
    fas.position[ridge === 'x' ? 'z' : 'x'] = s * (slopeLen / 2)
    fas.position.y = -0.05
    roof.add(fas)
    // Icicles hanging from the eave.
    for (let k = -len / 2 + 0.4; k < len / 2 - 0.3; k += 0.45 + rnd() * 0.4) {
      if (rnd() < 0.35) continue
      const L = 0.25 + rnd() * 0.8
      const ic = new THREE.Mesh(new THREE.ConeGeometry(0.07, L, 5), M.ice)
      ic.rotation.x = Math.PI
      const tilt = new THREE.Vector3()
      tilt[ridge === 'x' ? 'x' : 'z'] = k
      tilt[ridge === 'x' ? 'z' : 'x'] = s * (slopeLen / 2 + 0.05)
      ic.position.copy(tilt)
      ic.position.y = -L / 2 - 0.1
      // Counter the slab tilt so icicles hang straight down.
      if (ridge === 'x') ic.rotation.x = Math.PI - s * ang
      else ic.rotation.z = Math.PI + s * ang
      roof.add(ic)
    }
    const off = (slopeLen / 2) * Math.cos(ang)
    if (ridge === 'x') {
      roof.rotation.x = s * ang
      roof.position.set(0, h + rise - (slopeLen / 2) * Math.sin(ang) + 0.15, s * off)
    } else {
      roof.rotation.z = -s * ang
      roof.position.set(s * off, h + rise - (slopeLen / 2) * Math.sin(ang) + 0.15, 0)
    }
    roof.traverse((o) => { o.castShadow = o.receiveShadow = true })
    g.add(roof)
  }
  // Gable-end triangles.
  const tri = new THREE.Shape()
  tri.moveTo(-span / 2, 0); tri.lineTo(span / 2, 0); tri.lineTo(0, rise); tri.closePath()
  const tg = new THREE.ExtrudeGeometry(tri, { depth: 0.2, bevelEnabled: false })
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(tg, gableMat ?? M.boardBrown)
    if (ridge === 'x') { m.rotation.y = Math.PI / 2; m.position.set(s * (w / 2) - 0.1, h, 0) }
    else { m.position.set(0, h, s * (d / 2) - 0.1) }
    g.add(m)
  }
}

/** A window on a wall face: dark frame + warm glass. face: 's','n','e','w'. */
function win(g, face, w, d, x, y, ww = 1.2, wh = 1.4) {
  const frame = new THREE.Mesh(new THREE.BoxGeometry(face === 's' || face === 'n' ? ww + 0.2 : 0.12, wh + 0.2, face === 's' || face === 'n' ? 0.12 : ww + 0.2), M.trim)
  const glass = new THREE.Mesh(new THREE.BoxGeometry(face === 's' || face === 'n' ? ww : 0.14, wh, face === 's' || face === 'n' ? 0.14 : ww), M.glass)
  const p = face === 's' ? [x, y, d / 2 + 0.03] : face === 'n' ? [x, y, -d / 2 - 0.03] : face === 'e' ? [w / 2 + 0.03, y, x] : [-w / 2 - 0.03, y, x]
  frame.position.set(...p)
  glass.position.set(...p)
  glass.position[face === 's' ? 'z' : face === 'n' ? 'z' : 'x'] += face === 's' || face === 'e' ? 0.02 : -0.02
  // Snow on the sill.
  const sill = soft(face === 's' || face === 'n' ? ww + 0.3 : 0.35, 0.12, face === 's' || face === 'n' ? 0.35 : ww + 0.3, M.snow, 0.05, p[0], y - wh / 2 - 0.15, p[2])
  g.add(frame, glass, sill)
}
function windowRow(g, face, w, d, y, n, ww = 1.2, wh = 1.4, span = null) {
  const L = span ?? (face === 's' || face === 'n' ? w : d)
  for (let i = 0; i < n; i++) win(g, face, w, d, -L / 2 + (L / n) * (i + 0.5), y, ww, wh)
}
function door(g, d, x = 0, w = 1.4, h = 2.3) {
  g.add(box(w + 0.2, h + 0.15, 0.15, M.trim, x, 0, d / 2 + 0.05))
  g.add(box(w, h, 0.18, M.timber, x, 0, d / 2 + 0.07))
}
function chimney(g, x, z, h, top) {
  g.add(box(1.4, top, 1.4, M.stone, x, 0, z))
  g.add(soft(1.7, 0.4, 1.7, M.snow, 0.15, x, top, z))
}

/** Snowbank around a footprint: overlapping squashed spheres. */
function drift(g, w, d, amount = 1) {
  const n = Math.round((w + d) * 0.6 * amount)
  for (let i = 0; i < n; i++) {
    const side = i % 4
    const t = rnd() - 0.5
    const x = side < 2 ? t * w : (side === 2 ? 1 : -1) * (w / 2 + 0.4)
    const z = side >= 2 ? t * d : (side === 0 ? 1 : -1) * (d / 2 + 0.4)
    if (side === 0 && Math.abs(x) < 2.5) continue // keep the door clear
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.9 + rnd() * 0.8, 12, 8), M.snow)
    m.scale.y = 0.45
    m.position.set(x, 0, z)
    m.castShadow = m.receiveShadow = true
    g.add(m)
  }
}

const COATS = ['#c0392b', '#2a68c4', '#e0a92b', '#2f8f5b', '#7a3fa0', '#e86a2c', '#1d2a36', '#d94f8a', '#3aa6b9']
function person(g, x, z, scale = 1) {
  const c = new THREE.MeshStandardMaterial({ color: pick(COATS), roughness: 0.7 })
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28 * scale, 0.9 * scale, 4, 8), c)
  body.position.set(x, 0.75 * scale, z)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2 * scale, 10, 8), new THREE.MeshStandardMaterial({ color: pick(['#1d2a36', '#c0392b', '#e0a92b', '#f0f0f0']) }))
  head.position.set(x, 1.55 * scale, z)
  body.castShadow = head.castShadow = true
  g.add(body, head)
}
function crowd(g, n, x0, x1, z0, z1, scale = 1) {
  for (let i = 0; i < n; i++) person(g, x0 + rnd() * (x1 - x0), z0 + rnd() * (z1 - z0), scale)
}

function deck(g, w, d, z, tables, umbrellas = false, y = 0.6) {
  g.add(box(w, 0.25, d, M.deck, 0, y, z + d / 2))
  for (let i = 0; i <= Math.round(w / 2.5); i++) {
    const x = -w / 2 + i * (w / Math.round(w / 2.5))
    g.add(box(0.12, 1, 0.12, M.timber, x, y, z + d))
  }
  g.add(box(w, 0.12, 0.12, M.timber, 0, y + 1, z + d))
  g.add(box(w, 0.14, 0.3, M.snow, 0, y + 1.1, z + d))
  for (let i = 0; i < tables; i++) {
    const tx = -w / 2 + 1.5 + ((i % Math.max(1, Math.floor(w / 3.5))) * 3.5)
    const tz = z + 1.4 + Math.floor(i / Math.max(1, Math.floor(w / 3.5))) * 2.6
    g.add(box(1.4, 0.08, 0.9, M.timber, tx, y + 0.95, tz))
    g.add(box(0.1, 0.7, 0.1, M.timber, tx, y + 0.25, tz))
    if (umbrellas && i % 2 === 0) {
      const u = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.6, 8), new THREE.MeshStandardMaterial({ color: pick(['#c0392b', '#2a5a92', '#e0a92b']), roughness: 0.8 }))
      u.position.set(tx, y + 2.6, tz)
      u.castShadow = true
      g.add(u, box(0.06, 2.2, 0.06, M.steel, tx, y + 0.3, tz))
    }
    if (rnd() < 0.7) person(g, tx + 0.9, tz)
  }
}

function skiRack(g, x, z, n) {
  g.add(box(n * 0.35 + 0.4, 0.1, 0.4, M.timber, x, 1.1, z))
  for (let i = 0; i < n; i++) {
    const s = box(0.09, 1.7, 0.12, new THREE.MeshStandardMaterial({ color: pick(COATS), roughness: 0.5 }), x - (n * 0.35) / 2 + i * 0.35 + 0.2, 0, z + 0.15)
    s.rotation.x = -0.12
    g.add(s)
  }
}

function woodpile(g, x, z) {
  for (let r = 0; r < 3; r++) for (let i = 0; i < 6 - r; i++) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.1, 8), M.firewood)
    l.rotation.x = Math.PI / 2
    l.position.set(x - 0.5 + i * 0.32 + r * 0.16, 0.16 + r * 0.29, z)
    g.add(l)
  }
  g.add(soft(2.1, 0.18, 1.2, M.snow, 0.08, x + 0.3, 0.9, z))
}

function flagpole(g, x, z, colour = '#c0392b') {
  g.add(box(0.12, 9, 0.12, M.steel, x, 0, z))
  const f = box(2.2, 1.4, 0.05, new THREE.MeshStandardMaterial({ color: colour, side: THREE.DoubleSide }), x + 1.15, 7.4, z)
  g.add(f)
}

function conifer(g, x, z, h = 9) {
  const mat = new THREE.MeshStandardMaterial({ color: pick(['#2f5d45', '#2a5240', '#36684b']), roughness: 0.9 })
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(h * (0.32 - i * 0.07), h * 0.45, 9), mat)
    c.position.set(x, h * (0.3 + i * 0.22), z)
    c.castShadow = true
    g.add(c)
    const s = new THREE.Mesh(new THREE.ConeGeometry(h * (0.28 - i * 0.07), h * 0.12, 9), M.snow)
    s.position.set(x, h * (0.45 + i * 0.22), z)
    g.add(s)
  }
}

// ---------- buildings ----------
const B = {}

B.lodge = (lv) => {
  const g = new THREE.Group()
  if (lv === 1) {
    walls(g, 9, 7, 3.2, M.logs)
    gableRoof(g, 9, 7, 3.2, 2.4, M.roofGreen, 'x', 0.7, M.logs)
    windowRow(g, 's', 9, 7, 1.7, 2, 1.1, 1.1, 6)
    door(g, 7, 0, 1.2, 2.2)
    win(g, 'w', 9, 7, 0, 1.7, 1.1, 1.1)
    chimney(g, 3.2, -1, 0, 7.3)
    woodpile(g, -5.6, 1.5)
    skiRack(g, 2.6, 4.6, 5)
    drift(g, 9, 7)
    crowd(g, 3, -4, 4, 5, 8)
  } else if (lv === 2 || lv === 3) {
    const w = lv === 2 ? 15 : 17, d = lv === 2 ? 16 : 18, apex = lv === 2 ? 11 : 12.5
    // A-frame: roof slopes run nearly to the ground; glass gable faces south.
    g.add(box(w, 1.2, d, M.stone))
    gableRoof(g, w, d, 1.2, apex - 1.2, M.roofRed, 'z', 0.6, M.boardBrown)
    // Glass curtain in the south gable.
    const tri = new THREE.Shape()
    tri.moveTo(-w * 0.36, 0); tri.lineTo(w * 0.36, 0); tri.lineTo(0, (apex - 1.2) * 0.72); tri.closePath()
    const glass = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: 0.1, bevelEnabled: false }), M.glass)
    glass.position.set(0, 1.4, d / 2 + 0.12)
    g.add(glass)
    for (let i = -2; i <= 2; i++) g.add(box(0.18, (apex - 1.2) * 0.72 * (1 - Math.abs(i) / 3), 0.2, M.trim, (i * w * 0.36) / 3, 1.4, d / 2 + 0.25))
    for (let r = 1; r <= 2; r++) { const yy = 1.4 + (apex - 1.2) * 0.72 * (r / 3); g.add(box(w * 0.72 * (1 - r / 3), 0.16, 0.2, M.trim, 0, yy, d / 2 + 0.25)) }
    door(g, d, 0, 2.4, 2.4)
    chimney(g, -w * 0.25, -d * 0.2, 0, apex * 0.85)
    deck(g, w + 4, 6, d / 2, lv === 2 ? 6 : 8, lv === 3)
    if (lv === 3) {
      const wing = new THREE.Group()
      walls(wing, 14, 10, 4.6, M.boardBrown, 1)
      gableRoof(wing, 14, 10, 4.6, 3, M.roofRed, 'x', 0.6)
      windowRow(wing, 's', 14, 10, 2.6, 4, 1.3, 1.5)
      drift(wing, 14, 10, 0.7)
      wing.position.set(w / 2 + 7.5, 0, 2)
      g.add(wing)
      flagpole(g, -w / 2 - 3, d / 2 + 5)
      crowd(g, 6, -w / 2, w / 2, d / 2 + 6.5, d / 2 + 11)
    }
    drift(g, w, d, 0.6)
    crowd(g, lv === 2 ? 4 : 6, -w / 2, w / 2, d / 2 + 6.5, d / 2 + 10)
  } else {
    const big = lv === 5
    const w = big ? 44 : 34, d = big ? 20 : 17, h = big ? 9 : 7.5
    walls(g, w, d, h, M.logsDark, big ? 2.6 : 1.8)
    gableRoof(g, w, d, h, big ? 6.5 : 5, M.roofSlate, 'x', 1, M.logsDark)
    windowRow(g, 's', w, d, (big ? 2.6 : 1.8) + 1.4, big ? 12 : 9, 1.5, 1.6)
    windowRow(g, 's', w, d, h - 1.6, big ? 12 : 9, 1.2, 1.3)
    door(g, d, 0, 3, 2.6)
    // Dormers on the south slope.
    for (let i = 0; i < (big ? 4 : 3); i++) {
      const dg = new THREE.Group()
      walls(dg, 3, 3, 2, M.logsDark)
      gableRoof(dg, 3, 3, 2, 1.4, M.roofSlate, 'z', 0.3, M.logsDark)
      win(dg, 's', 3, 3, 0, 1.1, 1.2, 1.1)
      dg.position.set(-w / 2 + (w / (big ? 4 : 3)) * (i + 0.5), h + 0.4, d / 4 + 0.6)
      g.add(dg)
    }
    // Wings.
    for (const s of [-1, 1]) {
      const wing = new THREE.Group()
      const ww = big ? 18 : 14, wd = big ? 16 : 13, wh = big ? 7 : 5.5
      walls(wing, ww, wd, wh, M.logsDark, 1.6)
      gableRoof(wing, ww, wd, wh, 3.6, M.roofSlate, 'z', 0.8, M.logsDark)
      windowRow(wing, 's', ww, wd, 3, 3, 1.4, 1.6)
      windowRow(wing, s < 0 ? 'w' : 'e', ww, wd, 3, 3, 1.4, 1.6)
      drift(wing, ww, wd, 0.6)
      wing.position.set(s * (w / 2 + ww / 2 - 2), 0, 2.5)
      g.add(wing)
    }
    chimney(g, -w * 0.3, -d * 0.15, 0, h + 7)
    chimney(g, w * 0.3, -d * 0.15, 0, h + 7)
    // Cupola (and a clock face on the grand lodge).
    const cup = new THREE.Group()
    walls(cup, 3.4, 3.4, 3.4, M.logsDark)
    gableRoof(cup, 3.4, 3.4, 3.4, 2.4, M.roofSlate, 'z', 0.4, M.logsDark)
    win(cup, 's', 3.4, 3.4, 0, 1.8, big ? 1.6 : 1.2, big ? 1.6 : 1.4)
    cup.position.set(0, h + (big ? 6.5 : 5) - 1.2, 0)
    g.add(cup)
    if (big) {
      // Projecting entrance gable with a timber-and-glass front.
      const ent = new THREE.Group()
      walls(ent, 12, 8, 8, M.stone)
      gableRoof(ent, 12, 8, 8, 5, M.roofSlate, 'z', 0.8, M.timber)
      ent.add(box(9, 6, 0.15, M.glass, 0, 1.6, 4.05))
      for (let i = -2; i <= 2; i++) ent.add(box(0.25, 6.4, 0.3, M.timber, i * 2.2, 1.4, 4.15))
      ent.position.set(0, 0, d / 2 + 3.5)
      g.add(ent)
      // Plaza with fire pit and benches.
      g.add(box(52, 0.12, 16, M.paving, 0, 0, d / 2 + 15))
      const pit = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.7, 16), M.stone)
      pit.position.set(0, 0.35, d / 2 + 16)
      const fire = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.4, 8), M.fire)
      fire.position.set(0, 1.2, d / 2 + 16)
      g.add(pit, fire)
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        g.add(box(2.2, 0.5, 0.6, M.timber, Math.cos(a) * 4.5, 0, d / 2 + 16 + Math.sin(a) * 4.5))
      }
      for (const sx of [-1, 1]) {
        const dg = new THREE.Group()
        deck(dg, 14, 7, d / 2 - 0.5, 6, true, 0.8)
        dg.position.x = sx * 14
        g.add(dg)
      }
      crowd(g, 28, -24, 24, d / 2 + 9, d / 2 + 22)
      flagpole(g, -30, d / 2 + 8)
      flagpole(g, 30, d / 2 + 8, '#2a5a92')
    } else {
      deck(g, w, 7, d / 2, 14, true, 0.8)
      crowd(g, 14, -w / 2, w / 2, d / 2 + 8, d / 2 + 14)
      flagpole(g, -w / 2 - 4, d / 2 + 6)
    }
    drift(g, w, d, 0.5)
    conifer(g, -w / 2 - 16, -8, 11)
    conifer(g, w / 2 + 17, -10, 12)
  }
  return g
}

B.rentals = (lv) => {
  const g = new THREE.Group()
  const w = [0, 9, 16, 22][lv], d = [0, 7, 9, 12][lv], h = [0, 3.4, 4.2, 7][lv]
  walls(g, w, d, h, M.boardBlue, lv === 3 ? 1.2 : 0)
  gableRoof(g, w, d, h, lv === 3 ? 3.6 : 2.4, M.roofSlate, 'x', 0.6, M.boardBlue)
  // Shopfront: wide glass and a red sign band.
  g.add(box(w * 0.7, h * (lv === 3 ? 0.35 : 0.55), 0.12, M.glass, 0, lv === 3 ? 1.4 : 0.4, d / 2 + 0.03))
  g.add(box(w * 0.75, 0.6, 0.18, new THREE.MeshStandardMaterial({ color: '#b6382d' }), 0, h - 0.9, d / 2 + 0.06))
  if (lv === 3) windowRow(g, 's', w, d, h - 2.3, 6, 1.2, 1.3)
  skiRack(g, -w / 4, d / 2 + 2, 4 + lv * 2)
  skiRack(g, w / 4, d / 2 + 2, 4 + lv * 2)
  drift(g, w, d, 0.6)
  crowd(g, 2 + lv * 2, -w / 2, w / 2, d / 2 + 3, d / 2 + 6)
  return g
}

B.school = (lv) => {
  const g = new THREE.Group()
  const hut = new THREE.Group()
  const w = [0, 7, 12, 16][lv], d = [0, 6, 8, 10][lv]
  walls(hut, w, d, 3.4, M.boardRed)
  gableRoof(hut, w, d, 3.4, lv === 3 ? 4 : 2.2, M.roofGreen, lv === 3 ? 'z' : 'x', 0.5, M.boardRed)
  windowRow(hut, 's', w, d, 1.8, Math.max(1, lv), 1.1, 1.1)
  door(hut, d, w / 2 - 1.4, 1.1, 2.1)
  drift(hut, w, d, 0.6)
  g.add(hut)
  // Magic carpets running uphill (north), with a covered tunnel at level 3.
  const len = 16 + lv * 6
  for (let i = 0; i < Math.min(lv, 2); i++) {
    const x = w / 2 + 4 + i * 4
    g.add(box(1.2, 0.12, len, M.carpet, x, 0, -len / 2 + 2))
    g.add(box(0.12, 0.3, len, M.rail, x - 0.7, 0, -len / 2 + 2), box(0.12, 0.3, len, M.rail, x + 0.7, 0, -len / 2 + 2))
    if (lv === 3) {
      const tun = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, len, 16, 1, true, -Math.PI / 2, Math.PI), new THREE.MeshStandardMaterial({ color: '#cfe0ef', transparent: true, opacity: 0.55, side: THREE.DoubleSide, roughness: 0.2 }))
      tun.rotation.x = Math.PI / 2
      tun.position.set(x, 0.1, -len / 2 + 2)
      g.add(tun)
    }
    for (let k = 0; k < 4; k++) person(g, x, -k * (len / 4) - 1, 0.7)
  }
  // Learning area: cones and kids.
  const cone = new THREE.MeshStandardMaterial({ color: '#e86a2c' })
  for (let i = 0; i < 6 + lv * 2; i++) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.6, 8), cone)
    c.position.set(w / 2 + 6 + (i % 2) * (5 + lv * 2), 0.3, -2 - Math.floor(i / 2) * 3)
    g.add(c)
  }
  crowd(g, 4 + lv * 3, w / 2 + 6, w / 2 + 12 + lv * 2, -len + 4, 0, 0.7)
  flagpole(g, -w / 2 - 2, d / 2 + 2, '#2f8f5b')
  return g
}

B.housing = (lv) => {
  const g = new THREE.Group()
  if (lv === 1) {
    for (let i = 0; i < 3; i++) {
      const t = new THREE.Group()
      t.add(box(12, 3, 3.4, M.sidingGrey, 0, 0.5, 0))
      t.add(soft(12.2, 0.4, 3.6, M.snow, 0.15, 0, 3.5, 0))
      win(t, 's', 12, 3.4, -3, 2.1, 1.1, 0.9)
      win(t, 's', 12, 3.4, 3, 2.1, 1.1, 0.9)
      t.add(box(1.4, 0.5, 1.2, M.timber, 0, 0, 2.3))
      drift(t, 12, 3.4, 0.4)
      t.position.set(0, 0, -9 + i * 9)
      g.add(t)
    }
  } else {
    const n = lv - 1
    const spots = n === 1 ? [[0, 0]] : n === 2 ? [[-13, -3], [13, 3]] : [[-14, -8], [14, -8], [0, 9]]
    for (const [x, z] of spots) {
      const b = new THREE.Group()
      walls(b, 22, 11, 8.5, M.siding, 0.8)
      gableRoof(b, 22, 11, 8.5, 3.6, M.roofBrown, 'x', 0.6, M.siding)
      windowRow(b, 's', 22, 11, 2.2, 6, 1.2, 1.3)
      windowRow(b, 's', 22, 11, 5.6, 6, 1.2, 1.3)
      door(b, 11, 0, 1.4, 2.3)
      drift(b, 22, 11, 0.6)
      b.position.set(x, 0, z)
      g.add(b)
    }
  }
  return g
}

B.ticket = () => {
  const g = new THREE.Group()
  walls(g, 5, 3.5, 3, M.boardRed)
  gableRoof(g, 5, 3.5, 3, 1.6, M.roofGreen, 'x', 0.5, M.boardRed)
  win(g, 's', 5, 3.5, -1, 1.6, 1.6, 1.0)
  win(g, 's', 5, 3.5, 1.2, 1.6, 1.2, 1.0)
  for (let i = 0; i < 8; i++) person(g, -1 + Math.sin(i) * 0.6, 3.2 + i * 0.9)
  drift(g, 5, 3.5, 0.5)
  return g
}

B.shop = () => {
  // Maintenance garage with a snowcat parked outside.
  const g = new THREE.Group()
  walls(g, 18, 12, 6, M.boardGrey)
  gableRoof(g, 18, 12, 6, 2.2, M.roofSlate, 'x', 0.5, M.boardGrey)
  for (const x of [-4.5, 4.5]) g.add(box(5, 4.6, 0.15, M.sidingGrey, x, 0, 6.05))
  const cat = new THREE.Group()
  cat.add(box(3.2, 1.6, 5, new THREE.MeshStandardMaterial({ color: '#c0392b', roughness: 0.5 }), 0, 0.9, 0))
  cat.add(box(2.6, 1.3, 2.2, M.glassCool, 0, 2.5, -0.6))
  for (const s of [-1, 1]) cat.add(box(0.9, 1, 5.6, M.belt, s * 1.9, 0, 0))
  cat.add(box(4.6, 1.2, 0.5, M.steel, 0, 0.3, 3.1))
  cat.position.set(-3, 0, 11)
  g.add(cat)
  drift(g, 18, 12, 0.6)
  return g
}

B.terminal = (lv) => {
  // Lift bottom terminal: concrete pad, steel frame, bullwheel, operator hut.
  const g = new THREE.Group()
  const s = [0, 0.5, 1, 1.3][lv]
  if (lv === 1) {
    walls(g, 3, 2.5, 2.4, M.boardRed)
    gableRoof(g, 3, 2.5, 2.4, 1.2, M.roofGreen, 'x', 0.3, M.boardRed)
    g.add(box(0.4, 4, 0.4, M.steel, 3, 0, -1))
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.12, 8, 20), M.yellow)
    wheel.rotation.x = Math.PI / 2
    wheel.position.set(3, 4, -1)
    g.add(wheel)
    return g
  }
  g.add(box(9 * s, 0.4, 11 * s, M.concrete))
  // Steel legs carrying the terminal housing; the bullwheel turns inside it.
  for (const x of [-2.5 * s, 2.5 * s]) for (const z of [-3 * s, 1 * s]) g.add(box(0.5, 4.6 * s, 0.5, M.steel, x, 0.4, z))
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(2.6 * s, 0.22, 8, 28), M.yellow)
  wheel.rotation.x = Math.PI / 2
  wheel.position.set(0, 4.4 * s, 0)
  g.add(wheel)
  g.add(box(7 * s, 1.4 * s, 8 * s, M.terminal, 0, 4.9 * s, -1 * s))
  g.add(soft(7.2 * s, 0.4, 8.2 * s, M.snow, 0.15, 0, 4.9 * s + 1.4 * s, -1 * s))
  g.add(box(7 * s, 0.25, 0.2, M.yellow, 0, 4.9 * s + 0.3, 3 * s + 0.05))
  // Chairs in the loading area, and a maze for the line.
  const chair = new THREE.MeshStandardMaterial({ color: '#c0392b' })
  for (const x of [-2.6 * s, 2.6 * s]) {
    g.add(box(0.06, 2.2 * s, 0.06, M.steel, x, 2.3 * s, 3 * s))
    g.add(box(lv === 3 ? 2.4 : 1.4, 0.18, 0.7, chair, x, 2.1 * s, 3 * s))
  }
  for (let i = 0; i < 4; i++) g.add(box(0.06, 1, 6 * s, M.rail, -2 + i * 1.3, 0, 7 * s))
  const hut = new THREE.Group()
  walls(hut, 2.6, 2.2, 2.6, M.boardRed)
  gableRoof(hut, 2.6, 2.2, 2.6, 1.2, M.roofGreen, 'x', 0.3, M.boardRed)
  win(hut, 's', 2.6, 2.2, 0, 1.6, 1.2, 0.9)
  hut.position.set(-6 * s, 0, 3 * s)
  g.add(hut)
  for (let i = 0; i < 6 * s; i++) person(g, -1 + rnd() * 2, 6 * s + i * 0.8)
  return g
}

B.tree = (v) => {
  // Snow-laden subalpine fir: trunk, ragged stacked tiers, snow on each tier.
  const g = new THREE.Group()
  const h = [0, 13, 10, 16][v]
  const greens = ['#2c5640', '#2f5d45', '#26493a', '#335f49']
  g.add(box(0.5, h * 0.25, 0.5, M.timber))
  const tiers = 6
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers
    const r = h * 0.2 * (1 - t * 0.85) + 0.3
    const mat = new THREE.MeshStandardMaterial({ color: pick(greens), roughness: 0.95, flatShading: true })
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h * 0.26, 7 + (i % 3)), mat)
    cone.position.set((rnd() - 0.5) * 0.3, h * (0.18 + t * 0.72), (rnd() - 0.5) * 0.3)
    cone.rotation.y = rnd() * Math.PI
    g.add(cone)
    const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.82, h * 0.09, 7), M.snow)
    cap.position.set(cone.position.x - 0.05, cone.position.y + h * 0.06, cone.position.z)
    cap.rotation.y = rnd() * Math.PI
    g.add(cap)
  }
  const m = new THREE.Mesh(new THREE.SphereGeometry(h * 0.16, 10, 6), M.snow)
  m.scale.y = 0.3
  g.add(m)
  return g
}

export const SPRITES = [
  ...[1, 2, 3].map((l) => ['tree', l]),
  ...[1, 2, 3, 4, 5].map((l) => ['lodge', l]),
  ...[1, 2, 3].map((l) => ['rentals', l]),
  ...[1, 2, 3].map((l) => ['school', l]),
  ...[1, 2, 3, 4].map((l) => ['housing', l]),
  ['ticket', 1], ['shop', 1],
  ...[1, 2, 3].map((l) => ['terminal', l]),
]

// ---------- rendering ----------
let renderer
function setup() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  mats()
}

/** Render one building; returns a cropped PNG plus where the ground origin lands in it. */
export function renderSprite(kind, level) {
  seed = 1000 + level * 97 + kind.length * 13
  const scene = new THREE.Scene()
  const model = B[kind](level)
  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
  scene.add(model)
  const bb = new THREE.Box3().setFromObject(model)
  const size = bb.getSize(new THREE.Vector3())
  const R = Math.max(size.x, size.z, size.y) * 0.5 + 8

  // Low winter afternoon sun from the south-west so the fronts we look at are lit;
  // shadows fall to the north-east, behind the buildings. Cool sky fill.
  scene.add(new THREE.HemisphereLight('#cfdcec', '#ffffff', 0.85))
  const sun = new THREE.DirectionalLight('#ffeed6', 3.2)
  sun.position.set(-R * 1.1, R * 1.1, R * 0.9)
  sun.castShadow = true
  sun.shadow.mapSize.set(4096, 4096)
  sun.shadow.camera.left = sun.shadow.camera.bottom = -R * 1.5
  sun.shadow.camera.right = sun.shadow.camera.top = R * 1.5
  sun.shadow.camera.far = R * 6
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.03
  sun.shadow.radius = 4
  scene.add(sun)
  const fill = new THREE.DirectionalLight('#cfe0ff', 0.45)
  fill.position.set(R, R * 0.5, -R * 0.2)
  scene.add(fill)
  // Shadow catcher: invisible ground that only shows shadow.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(R * 4, R * 4), new THREE.ShadowMaterial({ opacity: 0.32, color: '#1e2d46' }))
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  const cam = new THREE.OrthographicCamera(-R, R, R, -R, 0.1, R * 10)
  const pitch = (PITCH_DEG * Math.PI) / 180
  const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2
  cam.position.set(cx, Math.sin(pitch) * R * 4, cz + Math.cos(pitch) * R * 4)
  cam.lookAt(cx, 0, cz)
  const px = Math.round(R * 2 * PX_PER_M)
  renderer.setSize(px, px, false)
  renderer.render(scene, cam)

  // Crop to visible pixels and locate the ground origin.
  const src = renderer.domElement
  const tmp = document.createElement('canvas')
  tmp.width = px
  tmp.height = px
  const tg = tmp.getContext('2d')
  tg.drawImage(src, 0, 0)
  const data = tg.getImageData(0, 0, px, px).data
  let x0 = px, y0 = px, x1 = 0, y1 = 0
  for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
    if (data[(y * px + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  }
  const o = new THREE.Vector3(0, 0, 0).project(cam)
  const ox = ((o.x + 1) / 2) * px, oy = ((1 - o.y) / 2) * px
  const out = document.createElement('canvas')
  out.width = x1 - x0 + 1
  out.height = y1 - y0 + 1
  out.getContext('2d').drawImage(tmp, -x0, -y0)
  scene.traverse((ob) => { if (ob.geometry) ob.geometry.dispose() })
  return { png: out.toDataURL('image/png'), w: out.width, h: out.height, ax: Math.round(ox - x0), ay: Math.round(oy - y0), pxPerM: PX_PER_M }
}

setup()
window.SPRITES = SPRITES
window.renderSprite = renderSprite
window.studioReady = true

// When opened by hand, show everything.
if (!new URLSearchParams(location.search).has('headless')) {
  const outEl = document.getElementById('out')
  for (const [k, l] of SPRITES) {
    const r = renderSprite(k, l)
    const img = new Image()
    img.src = r.png
    img.title = `${k} ${l}`
    img.style.width = `${r.w / 2}px`
    outEl.append(img)
  }
}

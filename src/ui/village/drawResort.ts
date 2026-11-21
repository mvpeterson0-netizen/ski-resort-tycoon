/**
 * Draw the player's resort on the bird's-eye map: trails, roads, the base village with
 * its buildings at their current levels, lifts, trees and labels. Overlay units are
 * MapView base pixels (RENDER_SCALE per terrain cell).
 */
import type { AmenityLevels, Lift, Pt, Road, Terrain, Trail } from '../../sim'
import { RENDER_SCALE } from '../MapView'
import {
  drawDiffSign, drawLabel, drawLift, drawParking, drawRoad, drawRoadLabel, drawSprite, drawTrailSwath, TREE_SCALE, SPRITE_SCALE,
  type Sprites,
} from './art'
import { roadLabel, type VillageFrame, type VillageItem } from './layout'

export const ITEM_NAMES: Record<string, string> = {
  lodge: 'Day Lodge', rentals: 'Rentals', school: 'Ski School', housing: 'Staff Housing', ticket: 'Tickets', shop: 'Maintenance',
}

/** Above this view scale, trees are drawn as 3D sprites instead of the painted layer. */
export const TREE_SPRITE_SCALE = 2.4

export interface ResortScene {
  t: Terrain
  roads: Road[]
  trails: Trail[]
  lifts: Lift[]
  amenities: AmenityLevels
  village: { F: VillageFrame; items: VillageItem[]; lot: Pt } | null
  forest: { layer: HTMLCanvasElement; kept: Float32Array }
  sprites: Sprites
  /** Parking lot fullness 0..1 (busier on big days). */
  fullness: number
  selected?: VillageItem | null
}

export function drawResortScene(ctx: CanvasRenderingContext2D, scale: number, s: ResortScene) {
  const { t } = s
  const S = RENDER_SCALE
  const k = S / t.cellM // overlay px per metre
  const px = (p: Pt): [number, number] => [(p[0] + 0.5) * S, (p[1] + 0.5) * S]
  const sprite = scale > TREE_SPRITE_SCALE

  if (!sprite) ctx.drawImage(s.forest.layer, 0, 0, t.width * S, t.height * S)
  for (const tr of s.trails) drawTrailSwath(ctx, tr.points.map(px), k, tr.difficulty)

  const V = s.village
  if (V) {
    // Plowed, trodden snow around everything built: soft overlapping discs.
    ctx.save()
    ctx.fillStyle = 'rgba(229, 232, 236, 0.97)'
    ctx.shadowColor = 'rgba(229, 232, 236, 0.95)'
    ctx.shadowBlur = 8 * k * scale
    for (const it of V.items) {
      const p = px(it.c)
      ctx.beginPath(); ctx.arc(p[0], p[1], (it.r + 6) * k, 0, Math.PI * 2); ctx.fill()
    }
    const lp = px(V.lot)
    ctx.beginPath(); ctx.arc(lp[0], lp[1], (46 + 16 * s.amenities.parking) * k, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
    drawParking(ctx, s.amenities.parking, lp[0], lp[1], k, s.fullness, -V.F.r[0], -V.F.r[1])
  }

  // Real roads, then the access drive from the road into the village.
  for (const road of s.roads) for (const part of road.parts) drawRoad(ctx, part.map(px), k, road.cls, scale)
  if (V) {
    const at = (away: number) => px([V.F.v[0] + (V.F.r[0] * away) / t.cellM, V.F.v[1] + (V.F.r[1] * away) / t.cellM])
    drawRoad(ctx, [px(V.F.join), at(-80), at(-25)], k, 5, scale)
  }
  if (scale < 3) {
    const seen = new Set<string>()
    for (const road of [...s.roads].sort((a, b) => b.parts[0].length - a.parts[0].length)) {
      const name = roadLabel(road)
      if (!name || seen.has(name)) continue
      seen.add(name)
      drawRoadLabel(ctx, road.parts[0].map(px), name, scale)
    }
  }

  for (const l of s.lifts) drawLift(ctx, px(l.bottom), px(l.top), k, l.type, 0, false)

  // Buildings, terminals and (close up) trees, back to front.
  const draw: { y: number; fn: () => void }[] = []
  const labels: [number, number, string, string][] = []
  const items = V ? V.items : s.lifts.map((l): VillageItem => ({ kind: 'terminal', art: l.type === 'ropeTow' ? 1 : l.type === 'fixedDouble' ? 2 : 3, c: l.bottom, r: 18, liftId: l.id }))
  for (const it of items) {
    const p = px(it.c)
    draw.push({ y: p[1], fn: () => { drawSprite(ctx, s.sprites, `${it.kind}-${it.art}`, p[0], p[1], k) } })
    if (ITEM_NAMES[it.kind]) {
      const lvl = it.kind === 'lodge' ? it.art - 1 : it.art
      labels.push([p[0], p[1] + 4 * k, ITEM_NAMES[it.kind], it.kind === 'ticket' || it.kind === 'shop' ? '' : it.kind === 'lodge' && lvl === 0 ? 'Hut' : `Lv ${lvl}`])
    }
  }
  if (sprite) {
    const m = ctx.getTransform().inverse()
    const a = m.transformPoint(new DOMPoint(0, 0)), b = m.transformPoint(new DOMPoint(ctx.canvas.width, ctx.canvas.height))
    const pad = 20 * k
    const kept = s.forest.kept
    for (let i = 0; i < kept.length; i += 3) {
      const x = (kept[i] + 0.5) * S, y = (kept[i + 1] + 0.5) * S
      if (x < a.x - pad || x > b.x + pad || y < a.y - pad || y > b.y + pad * 3) continue
      const v = 1 + ((i / 3) % 3)
      const sz = kept[i + 2] / 0.55
      draw.push({ y, fn: () => { drawSprite(ctx, s.sprites, `tree-${v}`, x, y, k, (TREE_SCALE / SPRITE_SCALE) * sz) } })
    }
  }
  draw.sort((p, q) => p.y - q.y)
  for (const d of draw) d.fn()
  for (const l of s.lifts) drawSprite(ctx, s.sprites, `terminal-${l.type === 'ropeTow' ? 1 : l.type === 'fixedDouble' ? 2 : 3}`, ...px(l.top), k, 0.7)

  // Selection ring.
  if (s.selected) {
    const p = px(s.selected.c)
    ctx.strokeStyle = '#2a5a92'
    ctx.lineWidth = 2.5 / scale
    ctx.setLineDash([6 / scale, 4 / scale])
    ctx.beginPath(); ctx.ellipse(p[0], p[1] - 4 * k, (s.selected.r + 4) * k, (s.selected.r + 4) * k * 0.6, 0, 0, Math.PI * 2); ctx.stroke()
    ctx.setLineDash([])
  }

  // Labels last; skip any that would overlap one already placed; hide when far out.
  if (scale > 1.6) {
    for (const l of s.lifts) { const [x, y] = px(l.bottom); labels.push([x, y + 4 * k, l.name, '']) }
    const placed: [number, number, number, number][] = []
    const fs = 11 / scale
    ctx.font = `800 ${fs}px Nunito, sans-serif`
    for (const [x, y, text, sub] of labels) {
      const w = ctx.measureText(`${text} ${sub}`).width + fs * 1.4, h = fs * 1.8
      let yy = y
      for (let tries = 0; tries < 3; tries++, yy += h * 1.05) {
        const rect: [number, number, number, number] = [x - w / 2, yy, x + w / 2, yy + h]
        if (placed.some((q) => rect[0] < q[2] && rect[2] > q[0] && rect[1] < q[3] && rect[3] > q[1])) continue
        placed.push(rect)
        drawLabel(ctx, x, yy, text, scale, sub || undefined)
        break
      }
    }
  }
  // Trail signs at the top of each run, constant size on screen.
  const sign = 7 / scale
  for (const tr of s.trails) {
    const p = px(tr.points[Math.min(2, tr.points.length - 1)])
    drawDiffSign(ctx, p[0], p[1], sign, tr.difficulty, scale > 2.5 ? tr.name : undefined)
  }
}

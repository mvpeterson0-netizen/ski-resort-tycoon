import { slopeClass, slopeClassDepth, slopeDeg, type SlopeClass, type Terrain } from '../sim'

/** RGB for each class; alpha scales from light (gentle end) to deep (steep end). */
export const CLASS_RGB: Record<SlopeClass, [number, number, number]> = {
  green: [46, 139, 62],
  blue: [29, 95, 191],
  black: [27, 27, 27],
  hazard: [208, 52, 44],
}
export const CLASS_LABEL: Record<SlopeClass, string> = {
  green: 'Green', blue: 'Blue', black: 'Black', hazard: 'Hazard',
}

/** One pixel per terrain cell, coloured by the run difficulty its slope would give. */
export function renderDifficultyLayer(t: Terrain): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = t.width
  cv.height = t.height
  const ctx = cv.getContext('2d')!
  const img = ctx.createImageData(t.width, t.height)
  for (let y = 0; y < t.height; y++) {
    for (let x = 0; x < t.width; x++) {
      const deg = slopeDeg(t, x, y)
      const [r, g, b] = CLASS_RGB[slopeClass(deg)]
      const i = (y * t.width + x) * 4
      img.data[i] = r
      img.data[i + 1] = g
      img.data[i + 2] = b
      img.data[i + 3] = Math.round(255 * (0.3 + 0.5 * slopeClassDepth(deg)))
    }
  }
  ctx.putImageData(img, 0, 0)
  return cv
}

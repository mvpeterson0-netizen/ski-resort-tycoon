#!/usr/bin/env node
/**
 * Render base-village building sprites with the dev-only sprite studio
 * (tools/sprites/), using the pre-installed headless Chromium via Playwright.
 *
 * Usage: npm run build:sprites
 * Output: public/sprites/<kind>-<level>.png and public/sprites/sprites.json
 * (size, ground anchor in pixels, pixels per metre). Commit the output; the game
 * only loads the images.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'vite'
import { createRequire } from 'node:module'

// Playwright is used from the environment's global install (not a project dependency).
const { chromium } = createRequire(import.meta.url)('playwright')

const server = await createServer({ server: { port: 5198, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.error('page error:', e.message))
  await page.goto('http://localhost:5198/ski-resort-tycoon/tools/sprites/index.html?headless')
  await page.waitForFunction(() => window.studioReady === true, null, { timeout: 60000 })
  const list = await page.evaluate(() => window.SPRITES)
  const outDir = new URL('../public/sprites/', import.meta.url)
  mkdirSync(outDir, { recursive: true })
  const manifest = {}
  for (const [kind, level] of list) {
    const r = await page.evaluate(([k, l]) => window.renderSprite(k, l), [kind, level])
    const name = `${kind}-${level}`
    writeFileSync(new URL(`${name}.png`, outDir), Buffer.from(r.png.split(',')[1], 'base64'))
    manifest[name] = { w: r.w, h: r.h, ax: r.ax, ay: r.ay, pxPerM: r.pxPerM }
    console.log(name, `${r.w}x${r.h}`)
  }
  writeFileSync(new URL('sprites.json', outDir), JSON.stringify(manifest, null, 1) + '\n')
} finally {
  await browser.close()
  await server.close()
}

# Ski Resort Tycoon — project notes for Claude

Phone-first web game: a realistic ski resort owner-operator tycoon. The player picks a
real mountain, buys the land, builds a resort, and runs it day by day through winter,
with a reduced off-season (building, hiring, financing, summer activities).

## Working rules (from the owner)
- **Show options and screenshots, and let the owner decide before deploying.** Work on a
  feature branch; nothing reaches `main` (which auto-deploys) without the owner's OK.
- Be honest about uncertainty. Never invent real-world numbers, sources, or licensing
  facts. Label every placeholder value as `PLACEHOLDER` in code and data.
- Small, runnable steps. Run `npm test` and `npm run build` (and look at the app) before
  each commit.
- Ask before big design choices not covered here.
- After each step, report what changed and how to try it on a phone.

## Decisions already made
- **Site selection:** pick a region first (5–10 US regions, 3–4 international), then one
  of 5–10 real sites in that region. Each site is a real parcel with its own traits.
- **Site traits:** vertical drop, slope aspect (north-facing holds snow), average
  snowfall, land price, drive time to interstate and nearest metro, water rights for
  snowmaking, permit difficulty, adjacent parcels for expansion.
- **Visuals:** 2D top-down map, shaded relief + contours, trail-map look.
- **Realism:** balanced — real economics underneath, readable and fun on top.
- **Platform:** phone first (touch, small screen, one-thumb navigation; primary actions
  at the bottom), fine on desktop.

## Systems (planned)
1. Mountain: trails drawn on terrain (difficulty from slope), lifts rope tow → gondola
   with capacity and waits, snowmaking, night lighting, groomers, terrain parks.
2. Base area: parking (caps guests), lodge, rentals, ski school, food, lodging, retail.
3. Staff: patrol, lift ops, groomers, instructors, mechanics; wages, seasonal hiring, housing.
4. Guests: locals, families, experts, destination; demand from snow, weekday/weekend/
   holiday, price, reputation, distance.
5. Weather: regional climate, good/bad years, storms, thaws, rain, wind holds.
6. Money: day tickets, dynamic pricing, season passes, lessons, F&B, lodging; credit
   line, term loans, insurance, bankruptcy.
7. Breakdowns/events: lift failures, groomer down, outages, lawsuits, viral reviews, races.
8. Summer: mountain biking, zip line, alpine coaster, weddings, concerts.
9. Later: published snow report (exaggeration hurts reputation), review feed, rivals,
   real-estate lots, long-term warming, scenario mode.

**Yearly loop:** off-season build & finance → pre-season snowmaking window → pricing &
pass sales → daily winter sim → year-end P&L → debt service → reputation & expansion.

## Tech
- React + TypeScript + Vite; Canvas for the map.
- `src/sim/` is the simulation engine: pure TypeScript, no React/DOM imports, no
  `Math.random()` — all randomness via the seeded `Rng` in `src/sim/rng.ts`. Unit-tested
  with Vitest (`*.test.ts` next to the code).
- `src/ui/` holds React components. UI may import sim; sim never imports UI.
- Saves in the browser (localStorage or IndexedDB — not yet decided).
- GitHub Pages via Actions: `ci.yml` tests every push; `deploy.yml` publishes only on
  push to `main`. Vite `base` is `/ski-resort-tycoon/`.
- Elevation data: preprocess each curated site into a small static file at build time;
  no tile fetching at runtime.

## Open questions / unverified (do not treat as settled)
- **Terrain data source and licence: NOT YET VERIFIED.** Candidates to check before step 3:
  AWS Open Data "Terrain Tiles" (Mapzen/Tilezen terrarium format) and USGS 3DEP (US
  only). Need to confirm current availability, licence, and attribution requirements.
- Visual style: three candidates (`?style=trailmap|night|clean`) awaiting owner choice.
- All economic figures (prices, wages, lift costs) are placeholders until sourced.

## Build order
1. Scaffold, CLAUDE.md, CI, Pages deploy. ← current
2. Phone-first shell: region picker → site picker, 2–3 placeholder sites.
3. Map view with shaded relief for one real site; pan and pinch zoom.
4. Land purchase; starting cash and loan setup.
5. Build trails and one lift with placement and cost.
6. Sim engine + day-by-day winter loop; simple guest/revenue/cost model; daily summary.
7. Cash flow, loans, year-end report.
8. Breakdowns, staff, snowmaking, base area, summer, remaining sites.

## Commands
- `npm run dev` — local dev server
- `npm test` — Vitest (sim engine)
- `npm run lint` — oxlint
- `npm run build` — type-check + production build

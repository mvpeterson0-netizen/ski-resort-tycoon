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
- **Visual style:** "Trail Map" — cream paper background, serif type, navy accent,
  green/blue/black difficulty colours (chosen over dark and minimal options).
- **Land ownership (step 4):** the player buys the whole parcel outright (no Forest
  Service lease/permit model). Price = acres × regional base $/acre × bounded factors
  (metro access, interstate access, vertical, snowfall, aspect, water rights,
  permitting), all coefficients in `ECON` / `REGIONS` and all PLACEHOLDER.
- **Starting finances:** fixed starting cash + one land mortgage, down payment chosen
  by slider (lender minimum applies). Values PLACEHOLDER in `src/sim/economy.ts`.
- **Saves:** single slot in localStorage (`src/ui/storage.ts`), versioned `GameState`.
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
- Saves in the browser: localStorage, one slot (decided step 4).
- GitHub Pages via Actions: `ci.yml` tests every push; `deploy.yml` publishes only on
  push to `main`. Vite `base` is `/ski-resort-tycoon/`.
- Elevation data (decided step 3): **USGS 3DEP 1/3 arc-second DEM** GeoTIFFs from the
  public bucket `prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/`.
  (The `elevation.nationalmap.gov` API is blocked by the build environment's network.)
  US sites only; international sites will need another source later.
  One-time per site: add an entry to `scripts/site-sources.json`, run
  `npm run build:dem -- <id>` (reads only the needed tiles via HTTP range requests, ~5 s),
  commit `public/sites/<id>.dem.bin` + `.json`. Format: 10 m cells, 4 km square,
  uint16 LE decimetres, north-up (~320 KB). The game never fetches tiles at runtime.
- Real sites list unsourced traits in `unverified`; the UI marks them "est.".

## Open questions / unverified (do not treat as settled)
- **Terrain licence: NOT VERIFIED.** We believe USGS-produced data is public domain with a
  requested credit to the U.S. Geological Survey, but usgs.gov is blocked from the build
  environment so this has not been confirmed against the policy page. Owner to check.
  The app shows "Elevation: USGS 3DEP" on the map.
- All economic figures (prices, wages, lift costs) are placeholders until sourced.
- Region list (9 US + 4 international) approved by owner. Region blurbs are general
  characterisations, not sourced facts.

## Build order
1. Scaffold, CLAUDE.md, CI, Pages deploy. (done)
2. Phone-first shell: region picker → site picker, 2–3 placeholder sites. (done)
3. Map view with shaded relief for one real site; pan and pinch zoom. (done: Berthoud Pass, CO)
4. Land purchase; starting cash and loan setup. ← current (awaiting review)
5. Build trails and one lift with placement and cost.
6. Sim engine + day-by-day winter loop; simple guest/revenue/cost model; daily summary.
7. Cash flow, loans, year-end report.
8. Breakdowns, staff, snowmaking, base area, summer, remaining sites.

## Commands
- `npm run dev` — local dev server
- `npm test` — Vitest (sim engine)
- `npm run lint` — oxlint
- `npm run build` — type-check + production build
- `npm run build:dem -- <site-id>` — one-time terrain preprocessing (needs network)

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
- **Visual style:** "Soft Trail" (owner pick from 7 + 2 blend options): Trail Map's
  cream/navy/green/blue/black palette with rounded Nunito type (bundled via
  @fontsource, weights 400 + 800 only), 20px corners, light borders, soft shadows,
  gentler map relief and fainter contours. All colours are CSS variables in `:root`
  (`src/index.css`), including the map palette (`--map-light/-shadow/--contour`).
- **Land ownership (step 4):** land is bought outright (no Forest Service lease/permit
  model). Real-terrain sites are split into a 3×3 grid of parcels (`src/sim/parcels.ts`);
  the starter parcel is always the site's road-access parcel (`Site.accessParcel`, where
  base area, parking and the road go), and the player expands into edge-adjacent parcels
  later (`buyableParcels`). Per-parcel vertical and aspect are derived from the DEM;
  other traits are site-wide.
  Parcel price = acres × regional base $/acre × bounded factors
  (metro access, interstate access, vertical, snowfall, aspect, water rights,
  permitting), all coefficients in `ECON` / `REGIONS` and all PLACEHOLDER.
- **Building (step 5, `src/sim/build.ts`):** trails are drawn freehand (one finger draws,
  two fingers pan/zoom), resampled every 20 m and auto-oriented downhill. Difficulty is
  from the 90th-percentile slope along the line: green < 25% grade, blue 25–40%, black
  > 40% (commonly quoted guidance, not an official standard); > 45° is unskiable. Lifts
  are placed by tapping two stations (lower = bottom); types rope tow, fixed double,
  fixed quad. Everything must lie on owned parcels. All costs/capacities/speeds are
  PLACEHOLDER in `BUILD`. GameState v3 stores trails and lifts (v2 saves upgrade).
- **Run-difficulty overlay (owner request, step 5):** difficulty stays strict (black
  terrain makes black trails; no softening). Instead, site assessment shows each 10 m
  cell coloured by the class its slope would give (green/blue/black/hazard, light =
  gentle end of class, deep = steep end) on the selected parcel, plus a per-parcel mix
  bar. Same thresholds as trail grading (`src/sim/difficulty.ts`). Also a "Runs" toggle
  in build mode, on owned land.
- **Winter season (step 6, `src/sim/season.ts`):** Dec 1 + 126 days, game year 1 =
  2026-27. Daily weather from a seeded RNG (season snowfall = site average × a 0.55–1.45
  year factor; storms; warm melt days more likely late season); opens at 18" base (no
  snowmaking yet). Guests = market × day type (weekday/Sat/Sun; holidays = Dec 24–Jan 1,
  MLK and Presidents' Day Sat–Mon) × snow × metro access × terrain size/variety × price
  elasticity, capped by lift capacity. Revenue = tickets + food; costs = per-lift, per-
  trail grooming, daily overhead (stand-in for staff until step 8). All PLACEHOLDER in
  `SEASON`. GameState v4 adds `season`, `lastSeason`, `ticketPriceUsd`.
- **Difficulty sliders (owner request):** Settings screen (title + resort home) with
  Snowfall and Finances sliders, 0 easy → 0.5 normal → 1 hard (`difficultySettings.ts`).
  Snow scales the season snowfall factor range and warm-day chance; Finances scales
  operating costs and guest demand. Normal = base tuning. Stored per game
  (`GameState.difficulty`, v5) and as the default for new games (localStorage).
  All multipliers PLACEHOLDER.
- **Finance (step 7, `src/sim/finance.ts`):** year-end close after each season: off-season
  fixed costs (base + per lift + per trail), annual loan payments split into interest
  and principal, credit-line interest. A revolving credit line (limit = share of asset
  book value, min floor) auto-covers any negative cash, in season or at year end; if it
  can't, the game is bankrupt. Off-season term loans up to a share of assets minus loan
  debt. `YearBook` tracks the year's cash flows so each `YearReport` reconciles
  (start + lines = end, tested). No depreciation or tax yet. All rates/limits/costs
  PLACEHOLDER in `FIN`. GameState v6 adds creditUsd, book, reports, bankrupt.
- **Pacing (owner intent):** reaching big money should take 10+ years. A player who keeps
  reinvesting should see cash float around $0–3M while net worth grows slowly; bad snow
  years should lose money. Enforced by `src/sim/balance.test.ts`, which runs the
  auto-player (`autoplayer.ts`: reinvests into trails/lifts/land, borrows when affordable,
  clears credit before expanding) over 20 seeds × 15 years on Berthoud Pass. Current
  Normal result: median cash $1.3–3.3M, net worth ~$5.5M → ~$32M by year 15, ~4 of 9
  parcels owned by year 15, ~15% of aggressive borrowers go bankrupt. Any economy
  change must keep these tests green. Expansion parcels carry a holdout premium
  (`expansionPremium`: +15% per parcel owned, PLACEHOLDER).
- **Starting finances:** fixed starting cash + one land mortgage, down payment chosen
  by slider (lender minimum applies). Values PLACEHOLDER in `src/sim/economy.ts`.
- **Saves:** single slot in localStorage (`src/ui/storage.ts`), versioned `GameState`
  (v6; v2–v5 upgrade automatically, older versions are discarded).
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
1. Scaffold, CLAUDE.md, CI, Pages deploy. (done; repo default branch is `main`)
2. Phone-first shell: region picker → site picker, 2–3 placeholder sites. (done)
3. Map view with shaded relief for one real site; pan and pinch zoom. (done: Berthoud Pass, CO)
4. Land purchase; starting cash and loan setup. (done)
5. Build trails and one lift with placement and cost. (done; + run-difficulty overlay)
6. Sim engine + day-by-day winter loop; simple guest/revenue/cost model; daily summary. (done)
7. Cash flow, loans, year-end report. (done) + economy rebalanced for long pacing ← awaiting review
8. Breakdowns, staff, snowmaking, base area, summer, remaining sites.

## Commands
- `npm run dev` — local dev server
- `npm test` — Vitest (sim engine)
- `npm run lint` — oxlint
- `npm run build` — type-check + production build
- `npm run build:dem -- <site-id>` — one-time terrain preprocessing (needs network)

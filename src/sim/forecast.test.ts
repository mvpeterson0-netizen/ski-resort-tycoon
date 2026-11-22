import { describe, expect, it } from 'vitest'
import { FORECAST_DAYS, forecast } from './forecast'
import { plainContext, startLiveDay } from './liveDay'
import { SEASON, simulateDay, startSeason, type SeasonInputs, type SeasonState } from './season'

const inp: SeasonInputs = {
  avgSnowfallIn: 300, driveToMetroMin: 75, trailKm: 6, difficultyKinds: 3, trailCount: 4, noEvents: true,
  lifts: [{ type: 'fixedDouble', capacityPph: 1200 }],
}

describe('forecast', () => {
  it('gives five days starting with the day about to be played, and is deterministic', () => {
    const s = startSeason(1, 5, inp, 79, 449)
    const f = forecast(s)
    expect(f).toHaveLength(FORECAST_DAYS)
    expect(f.map((d) => d.lead)).toEqual([0, 1, 2, 3, 4])
    expect(f[0].day).toBe(s.day)
    expect(forecast(s)).toEqual(f)
  })

  it("today's forecast is exactly the weather the day sim will roll", () => {
    let s: SeasonState = startSeason(1, 7, inp, 79, 449)
    for (let d = 0; d < 60; d++) {
      const f = forecast(s)[0]
      const prep = startLiveDay(s, inp, plainContext(s)).prep
      expect(f.snowLowIn).toBe(prep.newSnowIn)
      expect(f.snowHighIn).toBe(prep.newSnowIn)
      expect(f.warmChance).toBe(prep.warm ? 1 : 0)
      s = simulateDay(s, inp).season
    }
  })

  it('widens its ranges and loses confidence with lead time, but usually brackets the truth', () => {
    let s: SeasonState = startSeason(1, 11, inp, 79, 449)
    let hits = 0, total = 0
    for (let d = 0; d < 80; d++) {
      const f = forecast(s)
      for (let i = 1; i < f.length; i++) expect(f[i].snowHighIn - f[i].snowLowIn).toBeGreaterThanOrEqual(0)
      expect(f[4].confidence).toBeLessThan(f[1].confidence)
      // Compare day+3's forecast with what actually falls then.
      const later = s
      let t: SeasonState = later
      for (let k = 0; k < 3; k++) t = simulateDay(t, inp).season
      const actual = startLiveDay(t, inp, plainContext(t)).prep.newSnowIn
      total++
      if (actual >= f[3].snowLowIn && actual <= f[3].snowHighIn) hits++
      s = simulateDay(s, inp).season
    }
    expect(hits / total).toBeGreaterThan(0.6)
  })

  it('stops at the end of the season and labels days before opening', () => {
    const s = { ...startSeason(1, 3, inp, 79, 449), day: SEASON.lengthDays - 2 }
    expect(forecast(s)).toHaveLength(2)
    const early = { ...startSeason(1, 3, inp, 79, 449), openingDay: 20 }
    expect(forecast(early)[0].beforeOpening).toBe(true)
  })
})

/**
 * Event cards: when something happens during the day, the player picks a response.
 * Each card's default option reproduces the old automatic outcome, so a resort that
 * never answers (or skips with auto-answer) plays as before.
 *
 * Every cost, probability and effect size is a PLACEHOLDER for gameplay.
 */
import { createRng } from './rng'
import type { SeasonEvent } from './events'

export interface CardOption {
  id: string
  label: string
  detail: string
}

export interface EventCard {
  id: string
  /** Tick (30-minute step) when it happens; the day sim pauses there. */
  tick: number
  event: SeasonEvent
  title: string
  text: string
  options: CardOption[]
  defaultOption: string
  /** Set once the player (or auto-answer) chose. */
  answered?: string
  outcomeText?: string
}

/** What a chosen option does to the rest of the day and beyond. */
export interface CardOutcome {
  costUsd: number
  incomeUsd: number
  reputationDelta: number
  text: string
  /** A lift closes: reopens at reopenTick (null = rest of the day); carryDays more days after today. */
  liftDown?: { lift: number; reopenTick: number | null; carryDays: number }
  /** Rougher snow for the rest of today and carryDays more days. */
  groomerDown?: { penalty: number; carryDays: number }
  /** Guests multiplied by mult until untilTick (null = rest of the day). */
  outage?: { mult: number; untilTick: number | null }
  /** Day-ticket demand multiplier for the rest of the day (race closes some runs). */
  dayDemandMult?: number
  /** A booked group arrives over the next `ticks` ticks at perGuestUsd. */
  group?: { guests: number; perGuestUsd: number; ticks: number }
  /** The race slot is not used up. */
  releaseRace?: boolean
}

export const CARDS = {
  rushRepairMult: 2.2,
  rushRepairTicks: 4,
  rentedSnowcatUsd: 12_000,
  generatorsUsd: 10_000,
  generatorsMult: 0.85,
  generatorsTicks: 4,
  outageMult: 0.35,
  fightLegalUsd: 25_000,
  fightWinChance: 0.55,
  fightLossMult: 1.4,
  promoteUsd: 12_000,
  promoteRepGain: 0.06,
  compUsd: 10_000,
  compRepKept: 0.4,
  groupTicks: 4,
  groomerPenalty: 0.1,
  groomerDays: 2,
  raceDemandMult: 0.8,
} as const

const k = (n: number) => `$${Math.round(n / 1000)}k`

export function buildCard(event: SeasonEvent, id: string, tick: number, liftName: string): EventCard {
  const base = { id, tick, event }
  switch (event.kind) {
    case 'liftBreakdown': {
      const d = event.days ?? 1
      return {
        ...base, title: `${liftName} stopped`, text: `${liftName} has broken down. Guests are stuck in lines at the other lifts.`,
        defaultOption: 'standard',
        options: [
          { id: 'standard', label: 'Standard repair', detail: `${k(event.costUsd)} · closed ${d} day${d > 1 ? 's' : ''}` },
          { id: 'rush', label: 'Rush crew', detail: `${k(event.costUsd * CARDS.rushRepairMult)} · back in 2 hours` },
        ],
      }
    }
    case 'groomerBreakdown':
      return {
        ...base, title: 'Snowcat down', text: 'A groomer broke down. The snow will ride rougher until it is fixed.', defaultOption: 'standard',
        options: [
          { id: 'standard', label: 'Wait for the part', detail: `${k(event.costUsd)} · rougher snow for 2 days` },
          { id: 'rent', label: 'Rent a snowcat', detail: `${k(event.costUsd + CARDS.rentedSnowcatUsd)} · no drop in snow quality` },
        ],
      }
    case 'powerOutage':
      return {
        ...base, title: 'Power outage', text: 'The grid is down and the lifts have stopped.', defaultOption: 'wait',
        options: [
          { id: 'wait', label: 'Wait it out', detail: 'Most guests leave for the rest of the day' },
          { id: 'generators', label: 'Run generators', detail: `${k(CARDS.generatorsUsd)} · lifts back in 2 hours` },
        ],
      }
    case 'lawsuit':
      return {
        ...base, title: 'Injury lawsuit', text: 'An injured skier is suing. Your share after insurance is on the table.', defaultOption: 'settle',
        options: [
          { id: 'settle', label: 'Settle', detail: `${k(event.costUsd)} · small reputation hit` },
          { id: 'fight', label: 'Fight it', detail: `${k(CARDS.fightLegalUsd)} legal fees; about ${Math.round(CARDS.fightWinChance * 100)}% to pay nothing more, else ${CARDS.fightLossMult}× the settlement` },
        ],
      }
    case 'viralGood':
      return {
        ...base, title: 'Going viral', text: 'A video of your mountain is spreading fast.', defaultOption: 'ride',
        options: [
          { id: 'ride', label: 'Let it ride', detail: 'Free reputation boost' },
          { id: 'promote', label: 'Boost it', detail: `${k(CARDS.promoteUsd)} · a bigger reputation boost` },
        ],
      }
    case 'viralBad':
      return {
        ...base, title: 'Bad press', text: event.text, defaultOption: 'ignore',
        options: [
          { id: 'ignore', label: 'Ignore it', detail: 'Reputation takes the full hit' },
          { id: 'comp', label: 'Apologise and comp tickets', detail: `${k(CARDS.compUsd)} · most of the hit avoided` },
        ],
      }
    case 'race':
      return {
        ...base, title: 'Regional race', text: 'A race organiser wants your mountain this weekend.', defaultOption: 'host',
        options: [
          { id: 'host', label: 'Host the race', detail: `+${k(event.incomeUsd)} fee, some runs closed to guests, good press` },
          { id: 'decline', label: 'Decline', detail: 'Nothing changes; they may ask again' },
        ],
      }
    case 'groupBooking':
      return {
        ...base, title: 'Group booking', text: event.text, defaultOption: 'decline',
        options: [
          { id: 'accept', label: 'Accept', detail: `+$${(event.guests ?? 0) * 38 / 1000}k, but ${event.guests} more skiers in the lines` },
          { id: 'decline', label: 'Decline', detail: 'Keep the lifts for regular guests' },
        ],
      }
  }
}

/** Resolve a chosen option. `seed` makes any chance (a lawsuit verdict) repeatable. */
export function resolveCard(card: EventCard, optionId: string, tick: number, endTick: number, seed: number): CardOutcome {
  const e = card.event
  const C = CARDS
  switch (e.kind) {
    case 'liftBreakdown': {
      const lift = e.lift ?? 0
      const d = e.days ?? 1
      return optionId === 'rush'
        ? { costUsd: Math.round(e.costUsd * C.rushRepairMult), incomeUsd: 0, reputationDelta: 0, text: 'A rush crew had it running again in two hours.',
            liftDown: { lift, reopenTick: Math.min(endTick, tick + C.rushRepairTicks), carryDays: 0 } }
        : { costUsd: e.costUsd, incomeUsd: 0, reputationDelta: 0, text: `Repairs under way: closed ${d} day${d > 1 ? 's' : ''}.`,
            liftDown: { lift, reopenTick: null, carryDays: d - 1 } }
    }
    case 'groomerBreakdown':
      return optionId === 'rent'
        ? { costUsd: e.costUsd + C.rentedSnowcatUsd, incomeUsd: 0, reputationDelta: 0, text: 'A rented snowcat kept the runs groomed.' }
        : { costUsd: e.costUsd, incomeUsd: 0, reputationDelta: 0, text: 'Snow will ride rougher for two days.', groomerDown: { penalty: C.groomerPenalty, carryDays: C.groomerDays - 1 } }
    case 'powerOutage':
      return optionId === 'generators'
        ? { costUsd: C.generatorsUsd, incomeUsd: 0, reputationDelta: 0, text: 'Generators got the lifts turning again.',
            outage: { mult: C.generatorsMult, untilTick: Math.min(endTick, tick + C.generatorsTicks) } }
        : { costUsd: 0, incomeUsd: 0, reputationDelta: 0, text: 'Most guests left until the power came back.', outage: { mult: C.outageMult, untilTick: null } }
    case 'lawsuit': {
      if (optionId !== 'fight') return { costUsd: e.costUsd, incomeUsd: 0, reputationDelta: e.reputationDelta, text: 'Settled.' }
      const win = createRng(seed).next() < C.fightWinChance
      return win
        ? { costUsd: C.fightLegalUsd, incomeUsd: 0, reputationDelta: e.reputationDelta / 3, text: 'You won: only the legal fees.' }
        : { costUsd: C.fightLegalUsd + Math.round(e.costUsd * C.fightLossMult), incomeUsd: 0, reputationDelta: e.reputationDelta * 1.6, text: 'You lost: a bigger bill and worse press.' }
    }
    case 'viralGood':
      return optionId === 'promote'
        ? { costUsd: C.promoteUsd, incomeUsd: 0, reputationDelta: C.promoteRepGain, text: 'Your boost kept the video trending.' }
        : { costUsd: 0, incomeUsd: 0, reputationDelta: e.reputationDelta, text: 'The video did its own thing.' }
    case 'viralBad':
      return optionId === 'comp'
        ? { costUsd: C.compUsd, incomeUsd: 0, reputationDelta: e.reputationDelta * C.compRepKept, text: 'The apology landed well.' }
        : { costUsd: 0, incomeUsd: 0, reputationDelta: e.reputationDelta, text: 'The story ran its course.' }
    case 'race':
      return optionId === 'decline'
        ? { costUsd: 0, incomeUsd: 0, reputationDelta: 0, text: 'You passed on the race.', releaseRace: true }
        : { costUsd: 0, incomeUsd: e.incomeUsd, reputationDelta: e.reputationDelta, text: 'The race ran smoothly.', dayDemandMult: C.raceDemandMult }
    case 'groupBooking':
      return optionId === 'accept'
        ? { costUsd: 0, incomeUsd: 0, reputationDelta: 0, text: `${e.guests} skiers are on their way.`, group: { guests: e.guests ?? 0, perGuestUsd: 38, ticks: C.groupTicks } }
        : { costUsd: 0, incomeUsd: 0, reputationDelta: 0, text: 'You declined the booking.' }
  }
}

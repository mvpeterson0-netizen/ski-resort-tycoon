/**
 * Staff: who the resort needs, who it can actually fill, and what shortages do.
 *
 * Every count, wage and effect size here is a PLACEHOLDER for gameplay balance, not
 * sourced labour data.
 */
import type { LiftType } from './build'

export type Role = 'liftOps' | 'patrol' | 'groomers' | 'mechanics' | 'instructors'
export const ROLES: Role[] = ['liftOps', 'patrol', 'groomers', 'mechanics', 'instructors']

export interface RoleSpec {
  name: string
  /** Standard daily wage per person (paid every season day). */
  wageUsd: number
  shortage: string
}

export const ROLE_SPECS: Record<Role, RoleSpec> = {
  liftOps: { name: 'Lift operators', wageUsd: 180, shortage: 'Lifts run part-time: longer lines' },
  patrol: { name: 'Ski patrol', wageUsd: 230, shortage: 'Terrain stays closed: less appeal' },
  groomers: { name: 'Groomers', wageUsd: 220, shortage: 'Rougher snow: worse conditions' },
  mechanics: { name: 'Mechanics', wageUsd: 260, shortage: 'Lifts run slower' },
  instructors: { name: 'Instructors', wageUsd: 190, shortage: 'Fewer lessons sold' },
}

export const STAFF_TUNING = {
  liftOpsPerLift: { ropeTow: 2, fixedDouble: 6, fixedQuad: 8 } satisfies Record<LiftType, number>,
  patrolBase: 3, patrolPerKm: 1,
  groomersBase: 2, groomersPerKm: 0.25,
  mechanicsBase: 2, mechanicsPerLift: 0.5,
  instructorsWithSchool: 10,
  /** Local workers available at the reference metro access, before housing. */
  localPoolBase: 60,
  /** Each 10% of wage above standard draws this much more from the local pool. */
  wagePoolBoostPer10Pct: 0.2,
  minWageLevel: 0.9, maxWageLevel: 1.3,
  /** Shortage effects. */
  groomPenalty: 0.15,
  mechanicsSpeedShare: 0.1,
} as const

export type Staffing = Record<Role, number>
export const NO_STAFF: Staffing = { liftOps: 0, patrol: 0, groomers: 0, mechanics: 0, instructors: 0 }

export interface StaffNeedInputs {
  lifts: { type: LiftType }[]
  trailKm: number
  hasSchool: boolean
}

/** Recommended headcount for the resort as built. */
export function neededStaff(i: StaffNeedInputs): Staffing {
  const T = STAFF_TUNING
  if (!i.lifts.length) return { ...NO_STAFF }
  return {
    liftOps: i.lifts.reduce((s, l) => s + T.liftOpsPerLift[l.type], 0),
    patrol: Math.ceil(T.patrolBase + T.patrolPerKm * i.trailKm),
    groomers: Math.ceil(T.groomersBase + T.groomersPerKm * i.trailKm),
    mechanics: Math.ceil(T.mechanicsBase + T.mechanicsPerLift * i.lifts.length),
    instructors: i.hasSchool ? T.instructorsWithSchool : 0,
  }
}

export const headcount = (s: Staffing) => ROLES.reduce((n, r) => n + s[r], 0)

/** Local labour pool from metro access (closer to a city = more applicants). */
export function localPool(driveToMetroMin: number): number {
  const access = Math.max(0.3, Math.min(1.4, 1.6 - driveToMetroMin / 150))
  return Math.round(STAFF_TUNING.localPoolBase * access)
}

/**
 * Share of hired positions actually filled: local workers (more at higher wages) plus
 * people living in staff housing, over the number hired.
 */
export function fillRate(hired: number, pool: number, housingBeds: number, wageLevel: number): number {
  if (hired <= 0) return 1
  const boost = 1 + ((wageLevel - 1) / 0.1) * STAFF_TUNING.wagePoolBoostPer10Pct
  return Math.min(1, (pool * Math.max(0.5, boost) + housingBeds) / hired)
}

export interface StaffEffects {
  /** Filled / needed per role, capped at 1 (1 = fully staffed). */
  ratios: Staffing
  /** Daily payroll for everyone hired (unfilled positions cost nothing). */
  payrollUsd: number
  fill: number
}

export const FULL_STAFF: StaffEffects = {
  ratios: { liftOps: 1, patrol: 1, groomers: 1, mechanics: 1, instructors: 1 }, payrollUsd: 0, fill: 1,
}

export function staffEffects(hired: Staffing, needed: Staffing, fill: number, wageLevel: number): StaffEffects {
  const ratios = { ...NO_STAFF }
  let payroll = 0
  for (const r of ROLES) {
    const filled = hired[r] * fill
    ratios[r] = needed[r] > 0 ? Math.min(1, filled / needed[r]) : 1
    payroll += filled * ROLE_SPECS[r].wageUsd * wageLevel
  }
  return { ratios, payrollUsd: Math.round(payroll), fill }
}

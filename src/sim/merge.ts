/**
 * Run merging: a new run that follows an existing one blends into it, like trails
 * joining on a real mountain. Points of the drawn line that lie near an existing run are
 * pulled onto it ("snapped"); the stretch they share is already cleared, so it is not
 * charged or counted again.
 *
 * Three cases, decided per stretch of the drawn line:
 *   merge  - runs alongside an existing run (same direction) for at least MERGE.minShareM
 *   join   - the start or end of the line touches an existing run (a branch or a junction)
 *   cross  - passes over an existing run at an angle: left alone
 *
 * Distances are PLACEHOLDER gameplay tuning, not trail-design standards.
 */
import type { Pt } from './build'

export const MERGE = {
  /** A drawn point this close (metres) to an existing run is pulled onto it. */
  snapM: 30,
  /** A stretch must run alongside for this long (metres) to count as a merge. */
  minShareM: 60,
  /** Minimum alignment (|cos| of the angle) between the new line and the run it merges with. */
  minAlignment: 0.6,
} as const

export interface ExistingRun {
  id: string
  name: string
  points: Pt[]
}

export interface MergeSpan {
  trailId: string
  name: string
  /** Index range (inclusive) in the snapped points. */
  from: number
  to: number
  kind: 'merge' | 'join'
}

export interface SnapResult {
  /** Same length as the input; points near an existing run are pulled onto it. */
  points: Pt[]
  merges: MergeSpan[]
  /** Point i lies on an existing run (fully snapped). */
  shared: boolean[]
  /** Where each pulled point went: from the drawn position to the run (for the preview). */
  pulls: { from: Pt; to: Pt }[]
}

interface Nearest {
  /** Distance in cells. */
  d: number
  q: Pt
  /** Unit tangent of the run at q. */
  tx: number
  ty: number
  run: number
}

function nearestOnRuns(runs: ExistingRun[], p: Pt): Nearest | null {
  let best: Nearest | null = null
  for (let r = 0; r < runs.length; r++) {
    const pts = runs[r].points
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1]
      const [bx, by] = pts[i]
      const vx = bx - ax, vy = by - ay
      const l2 = vx * vx + vy * vy
      const u = l2 ? Math.max(0, Math.min(1, ((p[0] - ax) * vx + (p[1] - ay) * vy) / l2)) : 0
      const qx = ax + vx * u, qy = ay + vy * u
      const d = Math.hypot(p[0] - qx, p[1] - qy)
      if (!best || d < best.d) {
        const l = Math.sqrt(l2) || 1
        best = { d, q: [qx, qy], tx: vx / l, ty: vy / l, run: r }
      }
    }
  }
  return best
}

/**
 * Pull a resampled line onto the runs it merges with or joins. `pts` should already be
 * resampled (so spacing is even); the output has the same number of points.
 */
export function snapToRuns(pts: Pt[], runs: ExistingRun[], cellM: number): SnapResult {
  const usable = runs.filter((r) => r.points.length > 1)
  const n = pts.length
  const out: SnapResult = { points: pts.map((p) => [p[0], p[1]] as Pt), merges: [], shared: pts.map(() => false), pulls: [] }
  if (!usable.length || n < 1) return out

  const snapCells = MERGE.snapM / cellM
  const near = pts.map((p) => {
    const q = nearestOnRuns(usable, p)
    return q && q.d <= snapCells ? q : null
  })

  // Group consecutive points that are near the same run.
  let i = 0
  while (i < n) {
    const first = near[i]
    if (!first) { i++; continue }
    let j = i
    while (j + 1 < n && near[j + 1] && near[j + 1]!.run === first.run) j++
    const touchesStart = i === 0, touchesEnd = j === n - 1
    // How far the stretch runs, and whether it runs the same way as the run.
    let len = 0, align = 0, steps = 0
    for (let k = i + 1; k <= j; k++) {
      const dx = pts[k][0] - pts[k - 1][0], dy = pts[k][1] - pts[k - 1][1]
      const l = Math.hypot(dx, dy)
      len += l * cellM
      if (l > 0) { align += Math.abs((dx / l) * near[k]!.tx + (dy / l) * near[k]!.ty); steps++ }
    }
    const aligned = steps > 0 && align / steps >= MERGE.minAlignment
    const merge = len >= MERGE.minShareM && aligned
    const join = !merge && (touchesStart || touchesEnd)
    if (merge || join) {
      for (let k = i; k <= j; k++) {
        // The side that touches the end of the line snaps fully; free sides ease in.
        const left = touchesStart ? 1 : Math.min(1, 0.4 + 0.3 * (k - i))
        const right = touchesEnd ? 1 : Math.min(1, 0.4 + 0.3 * (j - k))
        const w = join ? (touchesStart ? Math.max(0.3, 1 - 0.3 * (k - i)) : Math.max(0.3, 1 - 0.3 * (j - k))) : Math.min(left, right)
        const q = near[k]!.q
        out.points[k] = [pts[k][0] + (q[0] - pts[k][0]) * w, pts[k][1] + (q[1] - pts[k][1]) * w]
        out.pulls.push({ from: pts[k], to: q })
        // Fully snapped points sit on the existing run (the shared stretch).
        out.shared[k] = w >= 0.99 && merge
      }
      out.merges.push({ trailId: usable[first.run].id, name: usable[first.run].name, from: i, to: j, kind: merge ? 'merge' : 'join' })
    }
    i = j + 1
  }
  return out
}

import {
  ROLES, ROLE_SPECS, STAFF_TUNING, headcount, setStaffPlan, siteById, staffing,
  type GameState, type Role,
} from '../sim'
import { usd } from './format'

export function StaffScreen({ game, onChange, onBack, onBase }: {
  game: GameState; onChange: (g: GameState) => void; onBack: () => void; onBase: () => void
}) {
  const site = siteById(game.siteId)!
  const s = staffing(game, site)
  const manual = game.staff.mode === 'manual'
  const setHired = (r: Role, n: number) =>
    onChange(setStaffPlan(game, { mode: 'manual', hired: { ...s.hired, [r]: n } }))
  const pct = (x: number) => `${Math.round(x * 100)}%`

  return (
    <main className="screen">
      <h2 className="screen-title">Staff</h2>
      <div className="content">
        <div className="seg">
          <button className={!manual ? 'on' : ''} onClick={() => onChange(setStaffPlan(game, { mode: 'auto' }))}>Auto-hire</button>
          <button className={manual ? 'on' : ''} onClick={() => onChange(setStaffPlan(game, { mode: 'manual', hired: s.hired }))}>Manual</button>
          <span className="cash">{usd(s.effects.payrollUsd)}/day payroll</span>
        </div>
        <p className="hint small">
          {manual ? 'You set each crew. Run lean to save wages, or hire extra.' : 'Crews follow what your resort needs as you build.'}
        </p>

        <dl className="traits">
          {ROLES.map((r) => {
            const ratio = s.effects.ratios[r]
            const status = s.needed[r] === 0 ? 'Not needed' : ratio >= 0.999 ? 'Fully staffed' : `${pct(ratio)} staffed: ${ROLE_SPECS[r].shortage}`
            return (
              <div key={r} className="trait staff-row">
                <dt>
                  {ROLE_SPECS[r].name}
                  <small className={ratio < 0.999 && s.needed[r] > 0 ? 'down' : ''}>{status}</small>
                  <small>Need {s.needed[r]} · ${Math.round(ROLE_SPECS[r].wageUsd * game.staff.wageLevel)}/day each</small>
                </dt>
                <dd className="stepper">
                  {manual && <button className="btn" aria-label={`Fewer ${ROLE_SPECS[r].name}`} onClick={() => setHired(r, s.hired[r] - 1)}>−</button>}
                  <b>{s.hired[r]}</b>
                  {manual && <button className="btn" aria-label={`More ${ROLE_SPECS[r].name}`} onClick={() => setHired(r, s.hired[r] + 1)}>+</button>}
                </dd>
              </div>
            )
          })}
        </dl>

        <h3 className="group">Hiring</h3>
        <div className="panel">
          <label className="slider-label" htmlFor="wage">Wages <b>{pct(game.staff.wageLevel)}</b> of standard</label>
          <input
            id="wage" type="range" className="slider"
            min={STAFF_TUNING.minWageLevel * 100} max={STAFF_TUNING.maxWageLevel * 100} step={5}
            value={Math.round(game.staff.wageLevel * 100)}
            onChange={(e) => onChange(setStaffPlan(game, { wageLevel: Number(e.target.value) / 100 }))}
          />
          <div className="slider-ends"><span>Cheaper, fewer applicants</span><span>More applicants</span></div>
        </div>
        <div className="kpis">
          <div><span>Hired</span><b>{headcount(s.hired)}</b></div>
          <div><span>Positions filled</span><b className={s.fill < 0.999 ? 'down' : 'up'}>{pct(s.fill)}</b></div>
          <div><span>Local workers</span><b>{s.pool}</b></div>
          <div><span>Housing beds</span><b>{s.beds}</b></div>
        </div>
        {s.fill < 0.999 && (
          <p className="note">
            Not enough workers: the local pool and your housing can't fill {headcount(s.hired)} jobs.
            Build staff housing or raise wages.
          </p>
        )}
        <p className="foot">Wages, crew sizes and effects are placeholders.</p>
      </div>
      <nav className="actions">
        <div className="row">
          {s.fill < 0.999 && <button className="btn" onClick={onBase}>Build housing</button>}
          <button className="btn primary" onClick={onBack}>Done</button>
        </div>
      </nav>
    </main>
  )
}

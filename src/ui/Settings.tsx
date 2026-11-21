import { difficultyLabel, financeModifiers, snowModifiers, type DifficultySettings } from '../sim'

function Slider({ id, label, value, onChange, detail }: {
  id: string; label: string; value: number; onChange: (v: number) => void; detail: string
}) {
  return (
    <div className="panel">
      <label className="slider-label" htmlFor={id}>
        {label} <b>{difficultyLabel(value)}</b>
      </label>
      <input
        id={id} type="range" className="slider" min={0} max={100} step={5}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
      />
      <div className="slider-ends"><span>Easy</span><span>Normal</span><span>Hard</span></div>
      <p className="hint small">{detail}</p>
    </div>
  )
}

export function SettingsScreen({ difficulty, inGame, onChange, onBack }: {
  difficulty: DifficultySettings
  inGame: boolean
  onChange: (d: DifficultySettings) => void
  onBack: () => void
}) {
  const snow = snowModifiers(difficulty.snow)
  const fin = financeModifiers(difficulty.finance)
  const x = (n: number) => `${n.toFixed(2)}×`
  return (
    <main className="screen">
      <h2 className="screen-title">Settings</h2>
      <div className="content">
        <h3 className="group">Difficulty</h3>
        <Slider
          id="snow" label="Snowfall" value={difficulty.snow}
          onChange={(v) => onChange({ ...difficulty, snow: v })}
          detail={`Season snowfall ranges ${x(snow.yearFactor[0])}–${x(snow.yearFactor[1])} the site average; warm melt days ${x(snow.warmChance)} as likely.`}
        />
        <Slider
          id="finance" label="Finances" value={difficulty.finance}
          onChange={(v) => onChange({ ...difficulty, finance: v })}
          detail={`Operating costs ${x(fin.costs)}; guest demand ${x(fin.demand)}.`}
        />
        <p className="note">
          {inGame
            ? 'Changes apply to your current resort now and to new games. Mid-season, the season’s total snowfall stays as drawn; melt days, costs and demand change right away.'
            : 'These apply to your next new game.'}
          {' '}Multipliers are placeholder tuning, not real-world data.
        </p>
      </div>
      <nav className="actions">
        <button className="btn primary" onClick={onBack}>Done</button>
      </nav>
    </main>
  )
}

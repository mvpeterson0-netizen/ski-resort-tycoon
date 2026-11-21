import { useState } from 'react'
import {
  FIN, assetValue, creditAvailable, creditLimit, drawCredit, fixedCosts, repayCredit, takeTermLoan, termLoanLimit,
  type FinResult, type GameState, type SeasonTotals, type YearReport,
} from '../sim'
import { usd } from './format'

const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`
const signed = (n: number) => (n === 0 ? '$0' : `${n > 0 ? '+' : '−'}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`)

function Row({ label, value, total, hint }: { label: string; value: string; total?: boolean; hint?: string }) {
  const neg = value.startsWith('−')
  return (
    <div className={total ? 'trait total' : 'trait'}>
      <dt>{label}{hint && <small>{hint}</small>}</dt>
      <dd className={total ? (neg ? 'down' : 'up') : ''}>{value}</dd>
    </div>
  )
}

/** Year-end report: P&L, cash flow (start + lines = end) and position. */
export function YearReportView({ r, season }: { r: YearReport; season?: SeasonTotals | null }) {
  return (
    <>
      <h3 className="group">Profit & loss</h3>
      <dl className="traits">
        {season && season.passRevenueUsd + season.ticketRevenueUsd + season.foodRevenueUsd > 0 ? (
          <>
            <Row label="Season passes" value={money(season.passRevenueUsd)} hint={`${season.passesSold.toLocaleString()} sold, cash at season start`} />
            <Row label="Day tickets" value={money(season.ticketRevenueUsd)} />
            <Row label="Food & drink" value={money(season.foodRevenueUsd)} />
          </>
        ) : (
          <Row label="Season revenue" value={money(r.seasonRevenueUsd)} />
        )}
        <Row label="Season operating costs" value={money(-r.seasonCostUsd)} />
        <Row label="Off-season fixed costs" value={money(-r.fixedCostsUsd)} hint="Insurance, property tax, upkeep" />
        <Row label="Interest" value={money(-r.interestUsd)} hint="Loans and credit line" />
        <Row label="Net income" value={money(r.netIncomeUsd)} total hint="Before depreciation and tax (not modelled yet)" />
      </dl>

      <h3 className="group">Cash flow</h3>
      <dl className="traits">
        <Row label="Cash at start of year" value={money(r.startCashUsd)} />
        <Row label="Season operating profit" value={signed(r.operatingProfitUsd)} />
        <Row label="Fixed costs + interest" value={signed(-(r.fixedCostsUsd + r.interestUsd))} />
        <Row label="Loan principal repaid" value={signed(-r.principalUsd)} />
        <Row label="Land & construction" value={signed(-r.capexUsd)} />
        <Row label="New loans" value={signed(r.newLoansUsd)} />
        <Row label="Credit line, net" value={signed(r.creditDrawnUsd - r.creditRepaidUsd)} />
        <Row label="Cash at end of year" value={money(r.endCashUsd)} total />
      </dl>

      <h3 className="group">Position</h3>
      <div className="kpis">
        <div><span>Assets (at cost)</span><b>{usd(r.assetsUsd)}</b></div>
        <div><span>Loans owed</span><b>{usd(r.loanDebtUsd)}</b></div>
        <div><span>Credit line used</span><b>{usd(r.creditUsd)}</b></div>
        <div><span>Credit limit</span><b>{usd(r.creditLimitUsd)}</b></div>
      </div>
    </>
  )
}

export function YearEndScreen({ game, onContinue }: { game: GameState; onContinue: () => void }) {
  const r = game.reports.at(-1)!
  return (
    <main className="screen">
      <h2 className="screen-title">Year {r.year} report</h2>
      <div className="content">
        {game.lastSeason && (
          <p className="tagline">
            {game.lastSeason.openDays} of {game.lastSeason.days} days open · {game.lastSeason.snowfallIn}" of snow ·{' '}
            {game.lastSeason.guests.toLocaleString()} skier visits
          </p>
        )}
        {r.creditDrawnUsd > 0 && !r.bankrupt && (
          <p className="note">You drew {usd(r.creditDrawnUsd)} on the credit line this year to cover shortfalls.</p>
        )}
        <YearReportView r={r} season={game.lastSeason?.year === r.year ? game.lastSeason : null} />
        <p className="foot">All costs, rates and limits are placeholders.</p>
      </div>
      <nav className="actions">
        <button className="btn primary" onClick={onContinue}>
          {game.bankrupt ? 'See what happened' : `Start year ${game.year} off-season`}
        </button>
      </nav>
    </main>
  )
}

export function FinanceScreen({ game, onChange, onReport, onBack }: {
  game: GameState; onChange: (g: GameState) => void; onReport: () => void; onBack: () => void
}) {
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const termMax = termLoanLimit(game)
  const [wantLoan, setLoanAmt] = useState(500_000)
  // Keep the chosen amount inside the current limit (it shrinks after borrowing).
  const loanAmt = Math.min(Math.max(wantLoan, FIN.termLoan.minUsd), termMax)
  const apply = (r: FinResult, okText: string) => {
    if (r.ok) { onChange(r.game); setMessage({ text: okText, ok: true }) } else setMessage({ text: r.reason, ok: false })
  }
  const step = 100_000
  const offseason = game.phase === 'offseason'

  return (
    <main className="screen">
      <h2 className="screen-title">Finance</h2>
      <div className="content">
        <div className="kpis">
          <div><span>Cash</span><b>{usd(game.cashUsd)}</b></div>
          <div><span>Assets (at cost)</span><b>{usd(assetValue(game))}</b></div>
          <div><span>Fixed costs / yr</span><b>{usd(fixedCosts(game))}</b></div>
          <div><span>Loan payments / yr</span><b>{usd(game.loans.reduce((s, l) => s + l.annualPaymentUsd, 0))}</b></div>
        </div>

        <h3 className="group">Loans</h3>
        <dl className="traits">
          {game.loans.length === 0 && <Row label="No loans" value="$0" />}
          {game.loans.map((l) => (
            <Row key={l.id} label={l.name} value={money(l.balanceUsd)}
              hint={`${l.ratePct}% · ${money(l.annualPaymentUsd)}/yr · of ${money(l.originalUsd)}`} />
          ))}
        </dl>

        <h3 className="group">Credit line</h3>
        <div className="panel">
          <div className="credit-bar" role="img" aria-label={`Used ${usd(game.creditUsd)} of ${usd(creditLimit(game))}`}>
            <i style={{ width: `${Math.min(100, (game.creditUsd / creditLimit(game)) * 100)}%` }} />
          </div>
          <p className="hint small">
            {usd(game.creditUsd)} used of {usd(creditLimit(game))} · {FIN.credit.ratePct}% a year on the used amount.
            It covers cash shortfalls automatically.
          </p>
          <div className="row">
            <button className="btn" disabled={creditAvailable(game) <= 0}
              onClick={() => apply(drawCredit(game, Math.min(step, creditAvailable(game))), 'Drew on the credit line')}>
              Draw {usd(Math.min(step, Math.max(creditAvailable(game), 0)))}
            </button>
            <button className="btn" disabled={game.creditUsd <= 0}
              onClick={() => apply(repayCredit(game, Math.min(step, game.creditUsd)), 'Repaid credit')}>
              Repay {usd(Math.min(step, game.creditUsd))}
            </button>
          </div>
        </div>

        <h3 className="group">New term loan</h3>
        <div className="panel">
          {!offseason ? (
            <p className="hint">Banks only lend in the off-season.</p>
          ) : termMax < FIN.termLoan.minUsd ? (
            <p className="hint">The bank won't lend more against your current assets. Build or pay down debt first.</p>
          ) : (
            <>
              <label className="slider-label" htmlFor="loan">
                Borrow <b>{usd(loanAmt)}</b> · {FIN.termLoan.ratePct}% over {FIN.termLoan.termYears} years
              </label>
              <input id="loan" type="range" className="slider" min={FIN.termLoan.minUsd} max={termMax} step={10_000}
                value={loanAmt} onChange={(e) => setLoanAmt(Number(e.target.value))} />
              <div className="slider-ends"><span>{usd(FIN.termLoan.minUsd)}</span><span>max {usd(termMax)}</span></div>
              <button className="btn primary wide" onClick={() => apply(takeTermLoan(game, loanAmt), `Borrowed ${usd(loanAmt)}`)}>
                Take loan
              </button>
            </>
          )}
        </div>
        {message && <p className={message.ok ? 'ok' : 'warn'}>{message.text}</p>}
        <p className="foot">Rates, limits and fixed costs are placeholders.</p>
      </div>
      <nav className="actions">
        <div className="row">
          {game.reports.length > 0 && <button className="btn" onClick={onReport}>Last report</button>}
          <button className="btn primary" onClick={onBack}>Done</button>
        </div>
      </nav>
    </main>
  )
}

export function BankruptScreen({ game, onNewGame }: { game: GameState; onNewGame: () => void }) {
  const r = game.reports.at(-1)
  return (
    <main className="screen">
      <h2 className="screen-title">Bankrupt</h2>
      <div className="content">
        <p className="note">
          Your cash ran out and the credit line was maxed, so the lenders have taken over the resort.
          {r ? ` It happened in year ${r.year}.` : ''}
        </p>
        {r && <YearReportView r={r} />}
      </div>
      <nav className="actions"><button className="btn primary" onClick={onNewGame}>Start a new game</button></nav>
    </main>
  )
}

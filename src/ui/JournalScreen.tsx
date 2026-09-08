import { allBuffDefs } from '../game/buffs'
import { dayKey, shiftDayKey } from '../game/time'
import type { GameState } from '../game/types'
import { int } from './format'

const CHART_DAYS = 30

export function JournalScreen({ state }: { state: GameState }) {
  const today = dayKey(Date.now())
  const byDate = new Map(state.history.map((d) => [d.date, d]))

  // Build a dense window so missing days show as gaps rather than closing up.
  const days = Array.from({ length: CHART_DAYS }, (_, i) => {
    const date = shiftDayKey(today, -(CHART_DAYS - 1 - i))
    return { date, steps: byDate.get(date)?.steps ?? 0 }
  })

  const peak = Math.max(state.dailyGoal, ...days.map((d) => d.steps))
  const windowTotal = days.reduce((sum, d) => sum + d.steps, 0)
  const activeDays = days.filter((d) => d.steps > 0).length

  return (
    <>
      <div className="card">
        <div className="card__title">Last {CHART_DAYS} days</div>
        <div className="chart">
          {days.map((day) => (
            <div
              key={day.date}
              className={`chart__bar ${
                day.date === today
                  ? 'chart__bar--today'
                  : day.steps >= state.dailyGoal
                    ? 'chart__bar--hit'
                    : ''
              }`}
              style={{ height: `${Math.max(2, (day.steps / peak) * 100)}%` }}
              title={`${day.date}: ${int(day.steps)} steps`}
            />
          ))}
        </div>
        <div className="progressline">
          <span>{int(windowTotal)} steps</span>
          <span>
            {activeDays} active {activeDays === 1 ? 'day' : 'days'}
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card__title">Record</div>
        <div className="kv">
          <span className="muted">Current streak</span>
          <span className="kv__value">
            {state.stats.currentStreak} {state.stats.currentStreak === 1 ? 'day' : 'days'}
          </span>
        </div>
        <div className="kv">
          <span className="muted">Best streak</span>
          <span className="kv__value">{state.stats.bestStreak}</span>
        </div>
        <div className="kv">
          <span className="muted">Best single day</span>
          <span className="kv__value">{int(state.stats.bestDaySteps)}</span>
        </div>
        <div className="kv">
          <span className="muted">Steps all time</span>
          <span className="kv__value">{int(state.stats.totalSteps)}</span>
        </div>
        <div className="kv">
          <span className="muted">Days recorded</span>
          <span className="kv__value">{state.history.length}</span>
        </div>
      </div>

      <div className="card">
        <div className="card__title">How to earn bonuses</div>
        <div className="small muted" style={{ marginBottom: 10 }}>
          Every bonus is worked out from step timing alone. Trailbound never asks for your
          location.
        </div>
        <div className="bufflist">
          {allBuffDefs().map((buff) => (
            <div className="buff" key={buff.id}>
              <span className="buff__icon">{buff.icon}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div className="buff__name">{buff.name}</div>
                <div className="buff__detail">{buff.description}</div>
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

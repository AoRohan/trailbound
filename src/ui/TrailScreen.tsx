import { useMemo, useState } from 'react'
import { computeDayBuffs } from '../game/buffs'
import { biomeById } from '../game/content'
import { derivedStats } from '../game/stats'
import { dayKey } from '../game/time'
import type { DayRecord, GameState, GearSlot } from '../game/types'
import { RouteCanvas } from './RouteCanvas'
import { distance, int, percent } from './format'

const EMPTY_DAY = (date: string): DayRecord => ({
  date,
  steps: 0,
  bestBoutSteps: 0,
  dawnSteps: 0,
  duskSteps: 0,
  trained: false,
})

const SLOTS: GearSlot[] = ['weapon', 'armor', 'trinket']
const SLOT_LABEL: Record<GearSlot, string> = {
  weapon: 'Weapon',
  armor: 'Armour',
  trinket: 'Trinket',
}

const QUICK_ADDS = [500, 1000, 2500, 5000]

export function TrailScreen({
  state,
  onAddSteps,
  onToggleTrained,
  onSync,
  manual,
  onDevice,
  syncing,
}: {
  state: GameState
  onAddSteps: (steps: number, minutes: number) => void
  onToggleTrained: (trained: boolean) => void
  onSync: () => void
  /** Show the type-it-in controls. */
  manual: boolean
  /** Running inside the Android shell, where a device source is expected. */
  onDevice: boolean
  syncing: boolean
}) {
  const [custom, setCustom] = useState('')

  const today = dayKey(Date.now())
  const record = state.history.find((d) => d.date === today) ?? EMPTY_DAY(today)
  const biome = biomeById(state.expedition.biomeId)
  const stats = derivedStats(state.party, state.camp)

  const buffs = useMemo(
    () => computeDayBuffs(record, { history: state.history, dailyGoal: state.dailyGoal }),
    [record, state.history, state.dailyGoal],
  )

  const remaining = Math.max(0, state.expedition.length - state.expedition.paces)
  const nextNode = state.expedition.route[state.expedition.nextNodeIndex]

  const submitCustom = () => {
    const value = Number(custom)
    if (Number.isFinite(value) && value > 0) {
      onAddSteps(Math.round(value), 60)
      setCustom('')
    }
  }

  return (
    <>
      <div className="hero">
        <div className="hero__steps tabular">{int(record.steps)}</div>
        <div className="hero__label">steps today · goal {int(state.dailyGoal)}</div>
        <div className="goalbar">
          <div
            className="goalbar__fill"
            style={{ width: `${percent(record.steps, state.dailyGoal)}%` }}
          />
        </div>
      </div>

      <div className="card">
        <RouteCanvas expedition={state.expedition} biome={biome} />
        <div className="progressline">
          <span>{distance(state.expedition.paces)} travelled</span>
          <span>
            {nextNode
              ? `next: ${nextNode.kind} in ${distance(Math.max(0, nextNode.atPace - state.expedition.paces))}`
              : 'the road ends'}
          </span>
        </div>
        <div className="progressline">
          <span className="dim">{biome.blurb}</span>
          <span>{distance(remaining)} to go</span>
        </div>
      </div>

      <div className="card">
        <div className="card__title">The party</div>
        <div className="row row--between">
          <span className="small muted">Health</span>
          <span className="small tabular">
            {int(state.party.hp)} / {int(stats.maxHp)}
          </span>
        </div>
        <div className="hpbar" style={{ marginTop: 6 }}>
          <div
            className="hpbar__fill"
            style={{ width: `${percent(state.party.hp, stats.maxHp)}%` }}
          />
        </div>

        <div className="statgrid">
          <div className="stat">
            <div className="stat__value">{stats.atk}</div>
            <div className="stat__label">Attack</div>
          </div>
          <div className="stat">
            <div className="stat__value">{stats.def}</div>
            <div className="stat__label">Defence</div>
          </div>
          <div className="stat">
            <div className="stat__value">{stats.maxHp}</div>
            <div className="stat__label">Max HP</div>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          {SLOTS.map((slot) => {
            const item = state.party.gear[slot]
            return (
              <div className="gearrow" key={slot}>
                <span className="gearrow__slot">{SLOT_LABEL[slot]}</span>
                <span className="gearrow__name">
                  {item ? item.name : <span className="dim">empty</span>}
                </span>
                {item && (
                  <span className="gearrow__stats">
                    {item.atk > 0 && `${item.atk} atk `}
                    {item.def > 0 && `${item.def} def `}
                    {item.hp > 0 && `${item.hp} hp`}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="card">
        <div className="card__title">Today&apos;s bonuses</div>
        {buffs.length === 0 ? (
          <div className="empty">
            No bonuses yet. Walk hard for half an hour, go out early or late, or log a
            training session.
          </div>
        ) : (
          <div className="bufflist">
            {buffs.map((buff) => (
              <div className="buff" key={buff.id}>
                <span className="buff__icon">{buff.icon}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div className="buff__name">{buff.name}</div>
                  <div className="buff__detail">{buff.detail}</div>
                </span>
              </div>
            ))}
          </div>
        )}

        <button
          className="btn btn--wide"
          style={{ marginTop: 12 }}
          aria-pressed={record.trained}
          onClick={() => onToggleTrained(!record.trained)}
        >
          {record.trained ? '💪 Training logged today' : 'Log a training session'}
        </button>
      </div>

      {!manual && (
        <button
          className="btn btn--wide"
          style={{ marginBottom: 12 }}
          disabled={syncing}
          onClick={onSync}
        >
          {syncing ? 'Reading steps…' : '↻ Sync steps now'}
        </button>
      )}

      {manual && (
        <div className="card">
          <div className="card__title">Walk</div>
          <div className="small muted" style={{ marginBottom: 4 }}>
            {onDevice
              ? 'No step data is reaching the game yet, so you can enter steps by hand here. Check the step source on the Settings tab.'
              : 'A browser cannot read your pedometer with the screen off, so enter steps by hand here. The Android app reads them for you.'}
          </div>
          <div className="chiprow">
            {QUICK_ADDS.map((n) => (
              <button
                key={n}
                className="chip"
                disabled={syncing}
                onClick={() => onAddSteps(n, 60)}
              >
                +{int(n)}
              </button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <input
              className="input"
              inputMode="numeric"
              placeholder="Steps"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitCustom()}
            />
            <button className="btn btn--primary" disabled={syncing} onClick={submitCustom}>
              Walk
            </button>
          </div>
        </div>
      )}
    </>
  )
}

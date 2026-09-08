import { useState } from 'react'
import { exportState, importState } from '../game/save'
import type { GameState } from '../game/types'
import type { StepSourceStatus } from '../steps/StepSource'
import { int } from './format'

const GOALS = [3000, 5000, 6000, 8000, 10000, 12000]

export function SettingsScreen({
  state,
  status,
  error,
  onSetGoal,
  onReplaceState,
  onReset,
  onRequestPermission,
}: {
  state: GameState
  status: StepSourceStatus | null
  error: string | null
  onSetGoal: (goal: number) => void
  onReplaceState: (next: GameState) => void
  onReset: () => void
  onRequestPermission: () => void
}) {
  const [backup, setBackup] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [confirmingReset, setConfirmingReset] = useState(false)

  const doExport = async () => {
    const json = exportState(state)
    setBackup(json)
    try {
      await navigator.clipboard.writeText(json)
      setMessage('Save copied to the clipboard.')
    } catch {
      setMessage('Copy the text below and keep it somewhere safe.')
    }
  }

  const doImport = () => {
    const restored = importState(backup)
    if (!restored) {
      setMessage('That does not look like a Trailbound save.')
      return
    }
    onReplaceState(restored)
    setMessage('Save restored.')
  }

  return (
    <>
      {error && <div className="banner banner--error">{error}</div>}
      {message && <div className="banner banner--info">{message}</div>}

      <div className="card">
        <div className="card__title">Daily goal</div>
        <div className="small muted">
          Streaks and personal bests are measured against this.
        </div>
        <div className="chiprow">
          {GOALS.map((goal) => (
            <button
              key={goal}
              className="chip"
              aria-pressed={state.dailyGoal === goal}
              onClick={() => onSetGoal(goal)}
            >
              {int(goal)}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card__title">Step source</div>
        {status ? (
          <>
            <div className="kv">
              <span className="muted">Source</span>
              <span className="kv__value">{status.label}</span>
            </div>
            <div className="kv">
              <span className="muted">Available</span>
              <span className="kv__value">{status.available ? 'yes' : 'no'}</span>
            </div>
            <div className="kv">
              <span className="muted">Permission</span>
              <span className="kv__value">
                {status.permissionGranted ? 'granted' : 'not granted'}
              </span>
            </div>
            <div className="kv">
              <span className="muted">State</span>
              <span className="kv__value" style={{ textAlign: 'right' }}>
                {status.detail}
              </span>
            </div>
            {status.error && (
              <div className="banner banner--error" style={{ marginTop: 10 }}>
                {status.error}
              </div>
            )}
            {!status.permissionGranted && status.available && (
              <button
                className="btn btn--primary btn--wide"
                style={{ marginTop: 10 }}
                onClick={onRequestPermission}
              >
                Grant permission
              </button>
            )}
          </>
        ) : (
          <div className="empty">Checking…</div>
        )}
        <div className="small dim" style={{ marginTop: 10 }}>
          Trailbound never requests location. Bonuses are worked out from step timing only.
        </div>
      </div>

      <div className="card">
        <div className="card__title">Diagnostics</div>
        <div className="kv">
          <span className="muted">Last sync</span>
          <span className="kv__value">{new Date(state.lastSyncAt).toLocaleString()}</span>
        </div>
        <div className="kv">
          <span className="muted">Save seed</span>
          <span className="kv__value">{state.seed}</span>
        </div>
        <div className="kv">
          <span className="muted">Expedition</span>
          <span className="kv__value">{state.expedition.id}</span>
        </div>
        <div className="kv">
          <span className="muted">Nodes resolved</span>
          <span className="kv__value">
            {state.expedition.nextNodeIndex} / {state.expedition.route.length}
          </span>
        </div>
        <div className="kv">
          <span className="muted">Runs started</span>
          <span className="kv__value">{state.runCounter}</span>
        </div>
        <div className="kv">
          <span className="muted">Days stored</span>
          <span className="kv__value">{state.history.length}</span>
        </div>
      </div>

      <div className="card">
        <div className="card__title">Backup</div>
        <div className="small muted" style={{ marginBottom: 8 }}>
          Your save lives only on this device. Copy it somewhere safe now and again, or you
          will lose it with the phone.
        </div>
        <div className="row">
          <button className="btn" onClick={doExport}>
            Export
          </button>
          <button className="btn" disabled={!backup.trim()} onClick={doImport}>
            Restore
          </button>
        </div>
        <textarea
          className="input"
          style={{ marginTop: 10, minHeight: 90, fontSize: 11, fontFamily: 'ui-monospace, monospace' }}
          placeholder="Paste a saved backup here to restore it"
          value={backup}
          onChange={(e) => setBackup(e.target.value)}
        />
      </div>

      <div className="card">
        <div className="card__title">Danger</div>
        {confirmingReset ? (
          <>
            <div className="small muted" style={{ marginBottom: 10 }}>
              This erases your camp, your gear and every day of history. There is no undo.
            </div>
            <div className="row">
              <button className="btn btn--danger" onClick={onReset}>
                Erase everything
              </button>
              <button className="btn" onClick={() => setConfirmingReset(false)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <button className="btn btn--danger btn--wide" onClick={() => setConfirmingReset(true)}>
            Start a new game
          </button>
        )}
      </div>
    </>
  )
}

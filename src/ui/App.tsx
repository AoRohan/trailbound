import { useEffect, useState } from 'react'
import { useGame } from '../app/useGame'
import { biomeById } from '../game/content'
import type { CompositeStepSource } from '../steps/CompositeStepSource'
import type { StorageAdapter } from '../storage/StorageAdapter'
import { CampScreen } from './CampScreen'
import { JournalScreen } from './JournalScreen'
import { ReportOverlay } from './ReportOverlay'
import { SettingsScreen } from './SettingsScreen'
import { TrailScreen } from './TrailScreen'
import { distance } from './format'

type Tab = 'trail' | 'camp' | 'journal' | 'settings'

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'trail', icon: '🧭', label: 'Trail' },
  { id: 'camp', icon: '⛺', label: 'Camp' },
  { id: 'journal', icon: '📖', label: 'Journal' },
  { id: 'settings', icon: '⚙️', label: 'Settings' },
]

export function App({
  storage,
  source,
}: {
  storage: StorageAdapter
  source: CompositeStepSource
}) {
  const api = useGame(storage, source)
  const [tab, setTab] = useState<Tab>('trail')

  const { state } = api
  const biome = state ? biomeById(state.expedition.biomeId) : null

  // Repaint the whole interface in the current biome's colours.
  useEffect(() => {
    if (!biome) return
    document.documentElement.style.setProperty('--accent', biome.colors[2])
    const meta = document.querySelector('meta[name="theme-color"]')
    meta?.setAttribute('content', biome.colors[0])
  }, [biome])

  if (!state || !biome) {
    return <div className="empty" style={{ paddingTop: 80 }}>Loading the road…</div>
  }

  const addSteps = (steps: number, minutes: number) => {
    source.add(steps, minutes)
    void api.sync()
  }

  // Manual entry is offered when there is no working device source — on the web
  // always, and on the phone only when Health Connect or the sensor is missing,
  // unavailable or unauthorised. Showing it alongside a working device source
  // would just invite double-counting the same walk.
  const showManual =
    source.kind === 'manual' ||
    (api.status !== null && (!api.status.available || !api.status.permissionGranted))

  // A device source that exists but hasn't been allowed to read steps yet. The
  // prompt belongs on the Trail screen, not buried in Settings — otherwise a
  // first-run Android user just sees a manual entry box and no explanation.
  const needsPermission =
    source.kind !== 'manual' &&
    api.status !== null &&
    api.status.available &&
    !api.status.permissionGranted

  const requestPermission = () => void source.requestPermission().then(() => api.sync())

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <div className="topbar__biome">{biome.name}</div>
          <div className="topbar__sub">
            depth {state.expedition.depth} · {distance(state.expedition.paces)} of{' '}
            {distance(state.expedition.length)}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="salvage">{Math.round(state.camp.salvage).toLocaleString()}</div>
          <div className="topbar__sub">salvage</div>
        </div>
      </header>

      <main className="screen">
        {tab === 'trail' && (
          <TrailScreen
            state={state}
            manual={showManual}
            onDevice={source.kind !== 'manual'}
            needsPermission={needsPermission}
            sourceLabel={api.status?.label ?? 'Your phone'}
            syncing={api.syncing}
            onAddSteps={addSteps}
            onToggleTrained={api.toggleTrained}
            onSync={() => void api.sync()}
            onRequestPermission={requestPermission}
          />
        )}
        {tab === 'camp' && <CampScreen state={state} onBuy={api.buyUpgrade} />}
        {tab === 'journal' && <JournalScreen state={state} />}
        {tab === 'settings' && (
          <SettingsScreen
            state={state}
            status={api.status}
            error={api.error}
            onSetGoal={api.setDailyGoal}
            onReplaceState={api.replaceState}
            onReset={api.resetGame}
            onRequestPermission={requestPermission}
          />
        )}
      </main>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className="tab"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            <span className="tab__icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>

      {api.report && <ReportOverlay report={api.report} onClose={api.dismissReport} />}
    </div>
  )
}

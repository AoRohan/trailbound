import { useEffect, useState } from 'react'
import { useGame } from '../app/useGame'
import { biomeById } from '../game/content'
import { ManualStepSource } from '../steps/ManualStepSource'
import type { StepSource } from '../steps/StepSource'
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

export function App({ storage, source }: { storage: StorageAdapter; source: StepSource }) {
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
    if (source instanceof ManualStepSource) {
      source.add(steps, minutes)
      void api.sync()
    }
  }

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
            manual={source.kind === 'manual'}
            syncing={api.syncing}
            onAddSteps={addSteps}
            onToggleTrained={api.toggleTrained}
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
            onRequestPermission={() => void source.requestPermission().then(() => api.sync())}
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

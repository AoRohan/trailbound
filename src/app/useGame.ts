import { useCallback, useEffect, useRef, useState } from 'react'
import { newGame } from '../game/save'
import { resolve, setTrainedToday } from '../game/resolve'
import { upgrade } from '../game/meta'
import type { BuildingId, GameState, Report } from '../game/types'
import type { StepSource, StepSourceStatus } from '../steps/StepSource'
import type { StorageAdapter } from '../storage/StorageAdapter'

export interface GameApi {
  state: GameState | null
  report: Report | null
  status: StepSourceStatus | null
  syncing: boolean
  /** Last error worth showing the player. */
  error: string | null
  sync(): Promise<void>
  dismissReport(): void
  buyUpgrade(id: BuildingId): void
  toggleTrained(trained: boolean): void
  setDailyGoal(goal: number): void
  replaceState(next: GameState): void
  resetGame(): void
}

/**
 * Owns the save, the step source, and the one operation that matters: sync.
 *
 * Sync is deliberately the only way steps enter the game. Everything else —
 * upgrades, settings, the training check-in — is a pure state change written
 * straight back to storage.
 */
export function useGame(storage: StorageAdapter, source: StepSource): GameApi {
  const [state, setState] = useState<GameState | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [status, setStatus] = useState<StepSourceStatus | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The live state, so `sync` never closes over a stale save.
  const stateRef = useRef<GameState | null>(null)
  const syncingRef = useRef(false)

  const commit = useCallback(
    (next: GameState) => {
      stateRef.current = next
      setState(next)
      void storage.save(next)
    },
    [storage],
  )

  // Load, or start a new game.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const loaded = (await storage.load()) ?? newGame()
      if (cancelled) return
      stateRef.current = loaded
      setState(loaded)
      await storage.save(loaded)
      setStatus(await source.status())
    })()
    return () => {
      cancelled = true
    }
  }, [storage, source])

  const sync = useCallback(async () => {
    const current = stateRef.current
    if (!current || syncingRef.current) return

    syncingRef.current = true
    setSyncing(true)
    setError(null)

    try {
      const now = Date.now()
      const buckets = await source.fetch(current.lastSyncAt, now)
      const result = resolve(current, buckets, now)
      commit(result.state)
      if (result.report) setReport(result.report)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setStatus(await source.status().catch(() => null))
      syncingRef.current = false
      setSyncing(false)
    }
  }, [source, commit])

  // Pull steps whenever the app comes back to the foreground.
  //
  // Only for sources that read the device — a manual source has nothing to
  // offer here, and syncing it on every focus would keep pushing the sync point
  // forward and squash the next entry the player types in.
  useEffect(() => {
    if (source.kind === 'manual') return

    const onVisible = () => {
      if (document.visibilityState === 'visible') void sync()
    }
    document.addEventListener('visibilitychange', onVisible)
    void sync()
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [source, sync])

  const buyUpgrade = useCallback(
    (id: BuildingId) => {
      const current = stateRef.current
      if (!current) return
      commit({ ...current, camp: upgrade(current.camp, id) })
    },
    [commit],
  )

  const toggleTrained = useCallback(
    (trained: boolean) => {
      const current = stateRef.current
      if (!current) return
      commit(setTrainedToday(current, trained))
    },
    [commit],
  )

  const setDailyGoal = useCallback(
    (goal: number) => {
      const current = stateRef.current
      if (!current) return
      commit({ ...current, dailyGoal: Math.max(100, Math.round(goal)) })
    },
    [commit],
  )

  const resetGame = useCallback(() => {
    commit(newGame())
    setReport(null)
  }, [commit])

  return {
    state,
    report,
    status,
    syncing,
    error,
    sync,
    dismissReport: () => setReport(null),
    buyUpgrade,
    toggleTrained,
    setDailyGoal,
    replaceState: commit,
    resetGame,
  }
}

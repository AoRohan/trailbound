import { campView } from '../game/meta'
import type { BuildingId, GameState } from '../game/types'
import { int } from './format'

export function CampScreen({
  state,
  onBuy,
}: {
  state: GameState
  onBuy: (id: BuildingId) => void
}) {
  const rows = campView(state.camp)

  return (
    <>
      <div className="hero">
        <div className="hero__steps salvage">{int(state.camp.salvage)}</div>
        <div className="hero__label">salvage in store</div>
      </div>

      <div className="card">
        <div className="card__title">Camp</div>
        <div className="small muted" style={{ marginBottom: 8 }}>
          Upgrades are permanent. They carry into every expedition, including the one after
          you die.
        </div>

        {rows.map((row) => (
          <div className="building" key={row.def.id}>
            <span className="building__icon">{row.def.icon}</span>
            <span className="building__body">
              <div className="row row--between">
                <span className="building__name">{row.def.name}</span>
                <span className="pill">lv {row.level}</span>
              </div>
              <div className="building__effect">
                {row.currentEffect ?? <span className="dim">not built</span>}
              </div>
              {row.nextEffect && <div className="building__next">next: {row.nextEffect}</div>}
            </span>
            <button
              className={`btn ${row.affordable ? 'btn--primary' : ''}`}
              disabled={row.maxed || !row.affordable}
              onClick={() => onBuy(row.def.id)}
            >
              {row.maxed ? 'Max' : int(row.cost ?? 0)}
            </button>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card__title">Expedition</div>
        <div className="kv">
          <span className="muted">Depth reached</span>
          <span className="kv__value">{state.expedition.depth}</span>
        </div>
        <div className="kv">
          <span className="muted">Biomes cleared</span>
          <span className="kv__value">{state.stats.expeditionsCompleted}</span>
        </div>
        <div className="kv">
          <span className="muted">Parties lost</span>
          <span className="kv__value">{state.stats.deaths}</span>
        </div>
        <div className="kv">
          <span className="muted">Enemies defeated</span>
          <span className="kv__value">{int(state.stats.enemiesDefeated)}</span>
        </div>
      </div>
    </>
  )
}

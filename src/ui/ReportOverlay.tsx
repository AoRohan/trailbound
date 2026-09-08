import { RARITIES } from '../game/content'
import { dayLabel } from '../game/time'
import type { LogEntry, Report } from '../game/types'
import { distance, int } from './format'

/**
 * The offline-resolution report — the heart of the loop.
 *
 * You do not watch this game while you walk. You walk, and then you open it and
 * find out what happened. So this screen is where the game actually gets told.
 */
export function ReportOverlay({ report, onClose }: { report: Report; onClose: () => void }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Expedition report">
      <div className="overlay__head">
        <h1 style={{ fontSize: 22 }}>While you were walking</h1>
        <div className="muted small" style={{ marginTop: 4 }}>
          {int(report.totalSteps)} steps · {distance(report.totalPaces)} of road
        </div>
      </div>

      <div className="overlay__body">
        {report.entries.length === 0 ? (
          <div className="empty">The road was quiet.</div>
        ) : (
          report.entries.map((entry, i) => (
            <Entry key={`${entry.t}-${i}`} entry={entry} index={i} />
          ))
        )}
      </div>

      <div className="overlay__foot">
        <button className="btn btn--primary btn--wide" onClick={onClose}>
          Continue
        </button>
      </div>
    </div>
  )
}

function Entry({ entry, index }: { entry: LogEntry; index: number }) {
  // Stagger the reveal so the log reads as a sequence of events rather than a
  // wall of text that appears all at once.
  const style = { animationDelay: `${Math.min(index * 45, 900)}ms` }

  switch (entry.t) {
    case 'day':
      return (
        <div className="entry entry--day" style={style}>
          <div className="entry__body">
            <div className="entry__title">{dayLabel(entry.date)}</div>
            <div className="entry__detail">
              {int(entry.steps)} steps → {distance(entry.paces)}
            </div>
            {entry.buffs.length > 0 && (
              <div className="chiprow">
                {entry.buffs.map((buff) => (
                  <span className="chip" key={buff.id} title={buff.detail}>
                    {buff.icon} {buff.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )

    case 'combat':
      return (
        <div className={`entry ${entry.won ? '' : 'entry--bad'}`} style={style}>
          <span className="entry__icon">{entry.enemyIcon}</span>
          <div className="entry__body">
            <div className="entry__title">
              {entry.won ? 'Defeated' : 'Fell to'} {entry.enemyName}
              {entry.isBoss && ' 👑'}
            </div>
            <div className="entry__detail">
              {entry.rounds.length} {entry.rounds.length === 1 ? 'round' : 'rounds'}
              {entry.won && entry.salvage > 0 && ` · +${int(entry.salvage)} salvage`}
              {` · ${int(entry.partyHpAfter)} HP left`}
            </div>
            <div className="combatbar">
              {entry.rounds.slice(0, 24).map((round, i) => (
                <span
                  key={i}
                  className={`combatbar__tick ${
                    round.taken > round.dealt ? 'combatbar__tick--hurt' : 'combatbar__tick--hit'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      )

    case 'loot': {
      const colour = RARITIES[entry.gear.rarity].color
      return (
        <div className="entry" style={style}>
          <span className="entry__icon">{entry.kept ? '✨' : '🔧'}</span>
          <div className="entry__body">
            <div className="entry__title" style={{ color: colour }}>
              {entry.gear.name}
            </div>
            <div className="entry__detail">
              {entry.gear.atk > 0 && `${entry.gear.atk} atk · `}
              {entry.gear.def > 0 && `${entry.gear.def} def · `}
              {entry.gear.hp > 0 && `${entry.gear.hp} hp · `}
              {entry.kept
                ? entry.replaced
                  ? `equipped, replacing ${entry.replaced.name}`
                  : 'equipped'
                : `broken down for ${int(entry.salvage)} salvage`}
            </div>
          </div>
        </div>
      )
    }

    case 'cache':
      return (
        <div className="entry" style={style}>
          <span className="entry__icon">◈</span>
          <div className="entry__body">
            <div className="entry__title">Supply cache</div>
            <div className="entry__detail">+{int(entry.salvage)} salvage</div>
          </div>
        </div>
      )

    case 'shrine':
      return (
        <div className="entry" style={style}>
          <span className="entry__icon">✦</span>
          <div className="entry__body">
            <div className="entry__title">Roadside shrine</div>
            <div className="entry__detail">
              recovered {int(entry.healed)} HP · now {int(entry.partyHpAfter)}
            </div>
          </div>
        </div>
      )

    case 'rest':
      return (
        <div className="entry" style={style}>
          <span className="entry__icon">⌂</span>
          <div className="entry__body">
            <div className="entry__title">Made camp</div>
            <div className="entry__detail">
              recovered {int(entry.healed)} HP · now {int(entry.partyHpAfter)}
            </div>
          </div>
        </div>
      )

    case 'death':
      return (
        <div className="entry entry--bad" style={style}>
          <span className="entry__icon">💀</span>
          <div className="entry__body">
            <div className="entry__title">The party fell in {entry.biomeName}</div>
            <div className="entry__detail">
              half the haul made it home · +{int(entry.salvageBanked)} salvage
            </div>
          </div>
        </div>
      )

    case 'complete':
      return (
        <div className="entry entry--good" style={style}>
          <span className="entry__icon">🏁</span>
          <div className="entry__body">
            <div className="entry__title">Cleared {entry.biomeName}</div>
            <div className="entry__detail">
              +{int(entry.salvageBanked)} salvage, including a {int(entry.bonus)} bonus
            </div>
          </div>
        </div>
      )

    case 'depart':
      return (
        <div className="entry" style={style}>
          <span className="entry__icon">🧭</span>
          <div className="entry__body">
            <div className="entry__title">Set out into {entry.biomeName}</div>
            <div className="entry__detail">
              depth {entry.depth} · {distance(entry.length)} of road
            </div>
          </div>
        </div>
      )
  }
}

# Trailbound

A step-driven expedition roguelite. Your real-world steps move a party along a
procedurally generated road: encounters, loot, bosses, and a camp you upgrade
between runs.

You don't watch it while you walk. You walk, then you open it and find out what
happened.

## What it does

- **Steps become distance.** Every step is a pace on the road. Cross a node and
  something happens — a fight, a supply cache, a shrine, a boss at the end of
  the biome.
- **Effort earns bonuses, without tracking your location.** A sustained
  half-hour burst is a *Forced March*; a streak is *Wayfarer*; walking before
  09:00 or after 20:00 has its own reward; your best-ever day pays out big. A
  manual "I trained today" check-in stands in for the gym.
- **Death is not the end.** You lose half the unbanked salvage and retry the
  same depth on a freshly generated road. Camp upgrades are permanent.

**No location permission is ever requested.** It isn't declared in the Android
manifest at all. Every bonus is derived from step timing and the clock.

## Playing it

- **Web:** open the GitHub Pages deployment and add it to your home screen. The
  browser can't read a pedometer with the screen off, so you enter steps by hand.
- **Android:** install the APK from the latest Actions run. Steps are read from
  Health Connect, falling back to the hardware step counter.

## Working on it

```bash
npm install
npm run dev        # play it in a browser at localhost:5173
npm test           # the part that matters
npm run build
npm run typecheck
```

Everything is free: no paid services, no Play Store account, no Android Studio.
The APK is built by GitHub Actions on a hosted runner, not locally.

## How it's put together

```
src/
  game/       pure TypeScript — no React, no platform, no I/O
    resolve.ts    the core: (state, step buckets) -> (state, story)
    normalize.ts  assumes device data is hostile, makes it safe
    buffs.ts      derived every time, never stored
    generate.ts   routes, fully determined by (seed, depth, attempt)
  steps/      step sources behind one interface
  storage/    save adapters behind one interface
  ui/         React screens
```

Three ideas hold it together:

**`resolve` is pure.** Same state, same steps, same clock gives byte-identical
results, because every random decision derives its stream from the save seed and
a stable context string. The whole game is therefore testable on a laptop with
no phone attached.

**`StepSource` hides the platform.** Manual entry, Health Connect and the raw
sensor all look the same to the game.

**`StorageAdapter` hides the save.** Local storage today; a cloud adapter later
is a new file, not a refactor.

### Tuning

Game feel lives in `TUNING` and the content tables in `src/game/content.ts` —
biomes, enemies, gear names, buff magnitudes, camp buildings. Adding a biome or
an enemy never means touching `resolve.ts`.

## Tests

```
tests/normalize.test.ts   hostile device data: clock skew, reboots, backfills
tests/resolve.test.ts     the simulation, including a year-long soak
tests/state.test.ts       save integrity, camp economy, RNG
tests/app.test.tsx        the real UI, mounted and clicked
```

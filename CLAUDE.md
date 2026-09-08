# Trailbound — working notes

A step-driven expedition roguelite. Real steps move a party along a generated
road; a camp between runs is the meta-progression.

## Hard constraints

These came from the user and are not negotiable without asking:

- **No location.** Not requested, not declared. Every bonus is derived from step
  timing and the clock. `.github/workflows/android.yml` greps the merged
  manifest and fails the build if a location permission ever appears.
- **Free tools only.** No paid services, no Play Store account, no Android
  Studio.
- **Never build Android locally.** The dev laptop has 5.8 GB RAM; Gradle plus
  Kotlin wants 2–3 GB and makes the machine unusable. GitHub Actions is the
  Android compiler. Iterate by pushing and reading the CI log.
- **Local-only save**, with a clean path to cloud sync later via
  `StorageAdapter`.

## Architecture rules

- `src/game/` is **pure**. No React, no browser APIs, no I/O, no `Date.now()`
  reached for implicitly — the clock is always passed in. This is what makes the
  simulation testable without a device.
- `resolve(state, buckets, now)` is **deterministic**. Randomness comes from
  `rngFor(seed, context)`, never from a stored generator state. If you add a
  random decision, give it a stable context string.
- `src/game/normalize.ts` is the **only** place that trusts device data. It
  assumes clock skew, reboots, backfills, future timestamps and duplicates.
  Everything downstream may assume clean input.
- Buffs are **derived, never stored**. Recomputed from the day record plus
  history on every resolve.
- Content lives in `src/game/content.ts`. Adding a biome, enemy, or gear name
  should never require touching `resolve.ts`.

## Gotchas found the hard way

- **A personal best must compare against days *strictly before* it**
  (`bestDayBefore`, not "all days except this one"). When a health app backfills
  several days at once, a later big day would otherwise retroactively cancel an
  earlier day's record.
- **Manual step entries are clamped into the sync window but keep their full
  step count.** A device source re-reads history the game may already have
  counted, so clipping it proportionally is right; a manual entry is the player
  declaring new steps, so trimming the window must not trim the number.
- **Don't round-trip UTF-8 files through PowerShell** `Get-Content`/`Set-Content`
  in this environment — it double-encodes em dashes and emoji. Use the Edit tool.
- **`android/gradlew` needs its exec bit set** (`git update-index --chmod=+x`);
  Windows git does not track it and the Linux runner fails with exit 126.
- **`variables.gradle` is applied after the `buildscript` block**, so anything a
  classpath dependency references must be declared inline in `build.gradle`.

## Commands

```bash
npm run dev        # play in a browser
npm test           # the part that matters
npm run typecheck
gh run list --repo AoRohan/trailbound     # CI, including the APK build
```

The APK is downloaded from the Actions artifact of the latest `Build Android
APK` run. The web build deploys to GitHub Pages automatically on push to main.

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
- **Write commit messages to a file and use `git commit -F`.** PowerShell
  here-strings (`@'…'@`) silently mis-parse some multi-line messages, and the
  failure looks like a *pathspec* error while the commit quietly doesn't happen.
  Always verify with `git log origin/main` rather than trusting an echoed
  "pushed".
- **`android/gradlew` needs its exec bit set** (`git update-index --chmod=+x`);
  Windows git does not track it and the Linux runner fails with exit 126.
- **`variables.gradle` is applied after the `buildscript` block**, so anything a
  classpath dependency references must be declared inline in `build.gradle`.
- **Capacitor 8 compiles at Java 21** — the runner JDK and both
  `compileOptions`/`jvmTarget` must say 21, or `:capacitor-android` fails with
  "invalid source release: 21".
- **minSdk is 26**, forced by `androidx.health.connect`. Don't lower it back to
  Capacitor's default 24.
- **The APK must be signed with the stable key**, restored in CI from the
  `ANDROID_KEYSTORE_B64` secret. Android refuses to update an installed app when
  the signing certificate changes, and AGP's default debug keystore is
  regenerated on every fresh runner — so without this every build was
  unupdatable and forced an uninstall, wiping a local-only save. If the secret
  is ever lost, every existing install has to be removed by hand; keep the
  backup safe. `python tools/apk_info.py <apk>` prints the certificate.
- **Health Connect data arrives late and backdated.** Providers such as Health
  Sync write steps timestamped when they were walked, minutes or hours
  afterwards. Never gate a Health Connect read on a forward-only watermark —
  re-read a trailing window and take each day's total as the truth (see
  `StepReading` and `mergeAuthoritativeDayRecords`).

## Commands

```bash
npm run dev        # play in a browser
npm test           # the part that matters
npm run typecheck
gh run list --repo AoRohan/trailbound     # CI, including the APK build
```

Every push to main rebuilds both. The web build deploys to GitHub Pages, and the
APK is republished to the rolling `latest` release:
https://github.com/AoRohan/trailbound/releases/latest/download/app-debug.apk

## Backlog

- [ ] APK is debug-signed. Fine for sideloading; set up release signing with a
      keystore in GitHub secrets only if it ever gets distributed.
- [ ] Health Connect may be empty if nothing on the phone writes steps into it.
      The sensor fallback covers this, but it means no history backfill on first
      launch. Confirm which source is live via the Settings diagnostics panel.
- [ ] Health Connect backfill is capped at 4 days per sync so a long gap cannot
      blast the party through a dozen biomes in one tap. Revisit if that cap
      turns out to feel wrong in practice.
- [ ] Game balance is analytical guesswork, never playtested. Enemy scaling,
      salvage payouts and camp upgrade costs all want revisiting after a week of
      real walking.
- [ ] `android.permission.DUMP` appears in the merged manifest via a dependency
      rather than anything declared here. Harmless and not location-related, but
      untraced if a minimal permission set ever matters.

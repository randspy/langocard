# Android development

## Prerequisites

- Android Studio’s bundled JDK for IDE builds, or JDK 17 for command-line/CI builds. Java and Kotlin both target Java 17 bytecode; no separate Java 17 toolchain is required when using the bundled JDK.
- Android SDK platform 37.0, build tools 36.0.0, and platform tools.
- Android 16 or newer device/emulator for running the app.

Install SDK packages through Android Studio's SDK Manager, or the Android command-line tools:

```sh
sdkmanager "platform-tools" "platforms;android-37.0" "build-tools;36.0.0"
```

Set `ANDROID_HOME` to your SDK directory, or create an untracked `local.properties` file in this directory:

```properties
sdk.dir=/absolute/path/to/Android/sdk
```

On this Mac, the SDK is installed at `$HOME/Library/Android/sdk`. For command-line builds, Homebrew JDK 17 can be selected for the current shell with:

```sh
export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
```

## Build and check

Run from `apps/android`:

```sh
./gradlew :app:assembleDebug :app:lintDebug
```

Use `gradlew.bat` on Windows. The wrapper pins Gradle and verifies its download checksum; no global Gradle installation is required. Dependency versions are in `gradle/libs.versions.toml`. AGP supplies built-in Kotlin support; the Compose compiler plugin selects the matching Kotlin compiler.

## Run

In Android Studio, create an Android 16 (API 36) virtual device, start it, and run the `app` configuration. From a terminal with a device connected:

```sh
./gradlew :app:installDebug
"$ANDROID_HOME/platform-tools/adb" shell am start -W -n com.randspy.langocard/.MainActivity
```

For a command-line emulator on Apple Silicon:

```sh
sdkmanager "emulator" "system-images;android-36;google_apis;arm64-v8a"
avdmanager create avd --name Langocard_API_36 --package "system-images;android-36;google_apis;arm64-v8a" --device pixel_7
"$ANDROID_HOME/emulator/emulator" -avd Langocard_API_36
```

Use an `x86_64` system image on Intel hosts. The welcome screen also has an Android Studio Compose preview.

## Offline learning pilot

The app bundles 200 **original draft** meaning entries (`app/src/main/assets/pilot.tsv`),
including expressions and noun articles. This is a functional content pilot, not a
frequency-ranked or independently language-reviewed 20,000-word corpus. No corpus
text or third-party recordings are bundled. Source selection and the future pack
pipeline are documented in `../../docs/research/french-content-sources.md`.

- Optional placement checks six entries separately for reading, listening and
  production; it seeds only those assessed cards, not an inferred B2 vocabulary.
  Pausing/restarting preserves the position. Unassessed entries start fresh.
- Reading, listening and sentence-gap production use distinct FSRS cards.
  The pinned MIT-licensed `io.github.open-spaced-repetition:fsrs:1.0.0`
  ([Java-FSRS](https://github.com/open-spaced-repetition/java-fsrs)) schedules at
  90% desired retention using default parameters. Model fitting is deferred.
- Due reviews take priority. At most five new meanings are introduced daily;
  existing meanings gain additional skills on later days. Related skills are
  buried until the next local calendar day. Failed cards retain their FSRS due
  times; four consecutive failures pause that skill for three days.
- The daily target is 15 foreground minutes, accumulated across sessions. The
  session ends at the target; it may end earlier if eligible material is exhausted.
  Background time is excluded. The clock is checkpointed every ten seconds and
  on leaving the activity (an abrupt process termination can lose up to ten seconds).
- Card states, placement, interests, history and daily counters are written using
  `AtomicFile` to private `files/learning-v1.json` before advancing each answer.
  Asset IDs remain stable when example wording is corrected. No account required.
- Listening requires an installed French TTS voice marked as not requiring a
  network; France voices are preferred. Synthetic audio is labeled. Missing or
  failed audio never counts as a successful assessment. Install voice data in
  Android speech settings and reopen the app; check actual output in airplane
  mode on the target device. App networking is not enabled.
- The library supports French/English search and replaying examples. Interest
  changes affect new-entry ordering, without changing learned card states.

Run `./gradlew :app:testDebugUnitTest :app:assembleDebug :app:lintDebug`.
The pilot deliberately defers corpus import, downloadable packs, manual entries,
backup/restore UI, Anki export, sync, notifications, AI and automatic speech scoring.
Do not clear application data to update it; install newer APKs with `adb install -r`.

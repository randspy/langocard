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

## Offline learning library

The app bundles **701 meanings**: the original 200 draft entries plus 501
source-aligned dictionary meanings. The in-app catalogue offers two additional
packs (339 and 276 meanings), bringing the installed total to **1,316 meanings**.
The first pack is already installed; learners do not need to author core cards.
Source content is structurally checked, not independently language-reviewed.
Definitions retain dictionary wording. Source attribution is available in the
Content sources page, per-entry links, backups and Anki exports. No third-party
recordings are bundled; installed offline French TTS supplies pronunciation.
The measured coverage and preparation pipeline are documented in
`../../docs/research/content-audit-2026-11-12.md`.

- Optional placement checks six entries separately for reading, listening and
  production; it seeds only those assessed cards, not an inferred B2 vocabulary.
  Pausing/restarting preserves the position. Unassessed entries start fresh.
- Reading, listening and sentence-gap production use distinct FSRS cards.
  Nouns also get a Gender card (choose *un* or *une*, graded by the app: right is
  Good, wrong is Again), for one meaning per noun. Gender cards arrive as a sibling
  skill on a later day, at most ten new ones a day. In production, the right word
  with the wrong article is rated Hard. See `../../docs/design/noun-gender.md`.
  The pinned MIT-licensed `io.github.open-spaced-repetition:fsrs:1.0.0`
  ([Java-FSRS](https://github.com/open-spaced-repetition/java-fsrs)) schedules at
  90% desired retention using default parameters. Model fitting is deferred.
- The personal B2 default starts new ranked dictionary entries above rank 2,500.
  The packs page can change this to all ranks or 7,001+. This is a frequency
  preference, not a CEFR mapping or a claim that lower-ranked words are known.
  Existing reviews, started senses, unranked starter cards and personal entries
  are preserved.
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
  mode on the target device. Studying works offline; networking is used only for explicitly requested pack downloads and, once configured, cloud sync.
- The library supports French/English search and replaying examples. Interest
  changes affect new-entry ordering, without changing learned card states.

Run `./gradlew :app:testDebugUnitTest :app:assembleDebug :app:lintDebug`.
The remaining editorial content work is expansion toward 20,000 usable study lemmas.
A 20,000-lemma frequency reference and a hosted catalogue are now provided, but
reference coverage is not counted as completed learning content.
Optional cloud sync (Menu → Cloud sync) merges progress between devices through
your own Convex deployment; see `../backend/README.md`. Studying never waits for
the network. Sync uses protocol v2, so the app also honours changes made in the web
app: edited entries (including built-in and pack entries) replace the shipped
wording, deleted entries leave the library, suspended cards aren't scheduled, and a
reset card starts again as new. Packs remain opt-in: entries from a pack that isn't
installed on any of your devices stay hidden until you download it. Entry rules and
merge rules are checked against the cases in `../../content/*-fixtures.json`. Notifications and automatic speech scoring remain deferred.
Do not clear application data to update it; install newer APKs with `adb install -r`.

## Library tools

The home screen’s navigation drawer links to separate pages for vocabulary, entry
creation, pack import/download, backup/restore, and Anki TSV export. The drawer
contains navigation only; forms and file actions live on their destination pages. Android's document picker lets you choose
where to save files. Restore requires confirmation and validates the backup before
replacing the current library and scheduling data. Existing pilot progress migrates
without clearing app data. Anki exports reading and production cards, with HTML
escaped and content-source attribution retained. Export does not preserve FSRS
scheduling or engine-generated audio; listening stays in Langocard.

Packs contain `format: "langocard-pack"`, `version: 1`, `source`, `license`, and
an `entries` array. Entry fields are `id`, `word`, `english`, `definition`, `example`
(one answer in `{braces}`), and `topic` (`daily`, `culture`, or `news`). IDs must be
unique, stable, and not collide with installed entries. Import is additive; duplicate
IDs reject the whole pack. Packs and backups have a 20 MB size limit. Downloads
accept direct HTTPS URLs; redirects are rejected. Imported material works offline.

Prepare reviewed content on a computer:

```sh
python3 tools/content/prepare_pack.py approved.tsv french-pack.json \
  --source 'Source URL, revision and contributor credits' \
  --license 'License identifier and URL; modification notices'
```

The command runs from the repository root. Split large libraries into smaller packs.
The catalogue is hosted on the `content-v1` Git branch with direct HTTPS raw URLs.
Catalogue downloads verify pack SHA256 digests before validation/import.
`build_corpus.py` provides conservative source alignment; `publish_catalogue.py`
produces versioned packs and the bundled catalogue. The simpler preparation tool
does not align arbitrary dictionary senses or verify linguistic accuracy. An
independently reviewed 20,000-word study library is not yet complete.


## On-device AI drafting

The Add an entry page can draft a personal entry from just its English meaning: the
French word (unless you typed it), a simple French definition and an example with its
`{answer}`. Drafts are filled into the form for you to check and edit; nothing is saved
until you press Save entry, and the usual entry rules apply. Regenerate replaces only
drafted fields you haven't edited. A reply that breaks the entry rules is retried once,
then only the valid fields are filled. Saved entries carry no AI marker and sync like any
personal entry.

Drafting runs [Gemma 4 E2B](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm)
(Apache-2.0) on the phone through LiteRT-LM, on the GPU where OpenCL is available and the
CPU otherwise. The 2.6 GB model is not in the APK: Enable AI fill downloads it once from a
pinned Hugging Face revision into app storage, resumes interrupted downloads, and checks
size and SHA-256 before use. After that it works offline and nothing you type leaves the
phone. The page offers to remove the model to free the space. Phones with less than about
6 GB of memory don't show the option. The prompt and checks live in `EntryDrafter`;
`ModelFile` handles download and verification (both unit-tested); LiteRT-LM is confined
to `OnDeviceModel`.

## Source pack verification

Run Python source/manifest checks from repository root:

```sh
python3 -m unittest discover -s tools/content -p 'test_*.py'
```

Use the emulator-only wrapper from repository root for device tests:

```sh
python3 tools/android/test_emulator.py --live-catalogue
```

It sets an explicit emulator serial, refuses physical devices, keeps a recovery
copy of existing emulator progress under `apps/android/build/test-recovery`, and
reinstalls the debug APK after test-runner cleanup. Avoid a bare connected-test task
with a personal phone attached: Gradle can select every connected device and remove
the application APK during cleanup, requiring reinstall.

The tests use isolated learning files. The optional live-catalogue check downloads
the hosted catalogue/packs, rejects a wrong digest, restores installed packs and
source metadata, and verifies combined Anki prompts remain distinct. Without
`--live-catalogue`, the wrapper runs only the offline device checks.
Library browsing is paginated to avoid composing thousands of rows at once.
Different meanings and skills of the same lemma are spaced across days.

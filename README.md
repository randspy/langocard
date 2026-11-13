# Langocard

One repository for the Android app and future web app and backend. Each application owns its dependencies and build tools; there is no root-level JavaScript or Gradle workspace.

```text
apps/
  android/   Native Kotlin + Jetpack Compose app
  web/       Local React app for managing the library and cards
  backend/   Convex sync backend (TypeScript)
.github/workflows/android.yml
.github/workflows/backend.yml
.github/workflows/web.yml
```

## Android

Application ID: `com.randspy.langocard`. Supports Android 16 (API 36) and newer, with compile/target SDK 37. The offline French app includes 701 built-in meanings, with downloadable packs expanding the library to 1,316 meanings. It supports placement, reading/listening/production practice, FSRS scheduling, and saved progress. See the Android README for scope and content limitations.

Open `apps/android` in Android Studio, or use the checked-in Gradle wrapper from a terminal. See [Android setup](apps/android/README.md) for prerequisites and emulator instructions.

```sh
cd apps/android
./gradlew :app:assembleDebug :app:lintDebug
```

The debug APK is written to `apps/android/app/build/outputs/apk/debug/app-debug.apk`.

## CI

The Android GitHub Actions workflow builds the debug APK and runs Android lint on pushes and pull requests that change `apps/android/**` or the workflow itself. It also supports manual runs and uploads the APK as `langocard-debug`.

The backend workflow typechecks and tests the Convex functions and validates the library seed. The web workflow typechecks, tests and builds the web app on changes to `apps/web/**` or the Convex functions.

## Backend

Cloud sync built on Convex, for a single learner. Android learning state stays local; sync merges it between devices and with the web app. Convex also holds the whole vocabulary library. See [backend setup](apps/backend/README.md).

## Web

A local React app for managing the library and cards: edit, delete and add entries, and suspend or reset cards. It runs locally and authenticates with the same `SYNC_TOKEN` as the phone. See [web setup](apps/web/README.md). The app isn't hosted; release signing and web deployment are deferred until needed.

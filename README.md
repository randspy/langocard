# Langocard

One repository for the Android app and future web app and backend. Each application owns its dependencies and build tools; there is no root-level JavaScript or Gradle workspace.

```text
apps/
  android/   Native Kotlin + Jetpack Compose app
  web/       Reserved for the future web app
  backend/   Convex sync backend (TypeScript)
.github/workflows/android.yml
.github/workflows/backend.yml
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

The backend workflow typechecks and tests the Convex functions on changes to `apps/backend/**`.

## Backend

Optional cloud sync built on Convex, for a single learner with a shared secret. Android learning state stays local; sync merges it between devices. See [backend setup](apps/backend/README.md).

Web setup will be added under its reserved directory. Release signing and web deployment are deferred until needed.

# Langocard

One repository for the Android app and future web app and backend. Each application owns its dependencies and build tools; there is no root-level JavaScript or Gradle workspace.

```text
apps/
  android/   Native Kotlin + Jetpack Compose app
  web/       Reserved for the future web app
  backend/   Reserved for the future backend
.github/workflows/android.yml
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

Backend and web setup will be added independently under their reserved directories. Android learning state is stored locally, with explicit HTTPS content downloads. Backend/web frameworks, release signing, and deployment of those applications are deferred until needed.

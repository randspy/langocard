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

Application ID: `com.randspy.langocard`. Supports Android 16 (API 36) and newer, with compile/target SDK 37. The initial app contains a welcome screen, a system light/dark theme, and a Compose preview.

Open `apps/android` in Android Studio, or use the checked-in Gradle wrapper from a terminal. See [Android setup](apps/android/README.md) for prerequisites and emulator instructions.

```sh
cd apps/android
./gradlew :app:assembleDebug :app:lintDebug
```

The debug APK is written to `apps/android/app/build/outputs/apk/debug/app-debug.apk`.

## CI

The Android GitHub Actions workflow builds the debug APK and runs Android lint on pushes and pull requests that change `apps/android/**` or the workflow itself. It also supports manual runs and uploads the APK as `langocard-debug`.

Backend and web setup will be added independently under their reserved directories. Navigation, networking, dependency injection, storage, release signing, and deployment are deferred until needed.

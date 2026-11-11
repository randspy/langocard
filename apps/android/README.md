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

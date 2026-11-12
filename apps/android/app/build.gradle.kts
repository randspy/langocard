import java.util.Properties

/** Optional sync settings from the untracked local.properties (see apps/backend/README.md). */
val localProperties = Properties().apply {
    rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) }
}
fun syncSetting(property: String, env: String): String =
    (localProperties.getProperty(property) ?: System.getenv(env) ?: "").trim()
        .replace("\\", "\\\\").replace("\"", "\\\"")

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.randspy.langocard"
    compileSdk = 37

    defaultConfig {
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        applicationId = "com.randspy.langocard"
        minSdk = 36
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "SYNC_URL", "\"${syncSetting("langocard.syncUrl", "LANGOCARD_SYNC_URL")}\"")
        buildConfigField("String", "SYNC_TOKEN", "\"${syncSetting("langocard.syncToken", "LANGOCARD_SYNC_TOKEN")}\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    constraints {
        implementation(libs.androidx.lifecycle.runtime) {
            because("Older transitive Lifecycle lint checks are incompatible with current Kotlin tooling.")
        }
    }

    implementation(libs.fsrs)
    implementation(libs.androidx.lifecycle.runtime.compose)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.junit)
    testImplementation(libs.junit)
    testImplementation(libs.json.test)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui.tooling.preview)
    debugImplementation(libs.androidx.compose.ui.tooling)
}

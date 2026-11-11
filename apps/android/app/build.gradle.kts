plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.randspy.langocard"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.randspy.langocard"
        minSdk = 36
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
    }

    buildFeatures {
        compose = true
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
    testImplementation(libs.junit)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui.tooling.preview)
    debugImplementation(libs.androidx.compose.ui.tooling)
}

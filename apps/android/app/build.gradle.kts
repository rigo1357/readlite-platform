plugins {
    alias(libs.plugins.android.application)
}

val debugApiBaseUrl = providers.gradleProperty("readliteApiBaseUrl")
    .orElse("http://10.0.2.2:3000")
    .get()
val releaseApiBaseUrl = providers.gradleProperty("readliteReleaseApiBaseUrl")
    .orElse("https://api.readlite.example")
    .get()

android {
    namespace = "com.readlite.mobile"

    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = "com.readlite.mobile"
        minSdk = 24
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        debug {
            buildConfigField("String", "API_BASE_URL", "\"$debugApiBaseUrl\"")
        }
        release {
            buildConfigField("String", "API_BASE_URL", "\"$releaseApiBaseUrl\"")
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(libs.appcompat)
    implementation(libs.material)

    testImplementation(libs.junit)
    androidTestImplementation(libs.espresso.core)
    androidTestImplementation(libs.ext.junit)
}

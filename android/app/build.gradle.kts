import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val signing = Properties().apply {
    rootProject.file("signing.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) }
}
fun signingValue(key: String, environment: String): String? =
    System.getenv(environment) ?: signing.getProperty(key)
val releaseStore = signingValue("storeFile", "RF_ANDROID_KEYSTORE")

android {
    namespace = "cn.resumeflow.app"
    compileSdk = 36
    defaultConfig {
        applicationId = "cn.resumeflow.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 3
        versionName = "1.0.2"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    signingConfigs {
        if (releaseStore != null) create("release") {
            storeFile = rootProject.file(releaseStore)
            storePassword = signingValue("storePassword", "RF_ANDROID_STORE_PASSWORD")
            keyAlias = signingValue("keyAlias", "RF_ANDROID_KEY_ALIAS")
            keyPassword = signingValue("keyPassword", "RF_ANDROID_KEY_PASSWORD")
        }
    }
    buildTypes {
        debug { applicationIdSuffix = ".debug"; versionNameSuffix = "-debug" }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = signingConfigs.findByName("release")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    lint { abortOnError = true; checkReleaseBuilds = true }
}

// Never silently hand off an unsigned release as a distribution package.
tasks.register("requireReleaseSigning") {
    doLast {
        check(releaseStore != null && listOf(
            signingValue("storePassword", "RF_ANDROID_STORE_PASSWORD"),
            signingValue("keyAlias", "RF_ANDROID_KEY_ALIAS"),
            signingValue("keyPassword", "RF_ANDROID_KEY_PASSWORD")
        ).all { !it.isNullOrBlank() }) { "Release signing missing; see android/README.md" }
    }
}
tasks.configureEach {
    if (name == "packageRelease" || name == "validateSigningRelease") dependsOn("requireReleaseSigning")
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.11.0")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.webkit:webkit:1.14.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
}

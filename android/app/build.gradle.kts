plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "com.example.gateway"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.example.gateway"
        minSdk = 26          // Android 8.0: modern background-execution rules, notification channels
        targetSdk = 37
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Where the gateway backend lives. Overridable in the app's UI at
        // enrollment time, which is what makes one build usable against a
        // staging and a production backend.
        buildConfigField("String", "DEFAULT_BASE_URL", "\"http://10.0.2.2:3000/\"")

        javaCompileOptions {
            annotationProcessorOptions {
                arguments += mapOf(
                    "room.schemaLocation" to "$projectDir/schemas",
                    "room.incremental" to "true",
                )
            }
        }
    }

    buildTypes {
        debug {
            // 10.0.2.2 is the emulator's route to the host machine; plain HTTP
            // is permitted for that host only (see network_security_config.xml).
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    buildFeatures {
        buildConfig = true
        viewBinding = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests {
            // The classes under test touch android.util.Log, which is a stub in
            // the JVM test runtime. Returning defaults keeps these tests plain
            // JUnit instead of dragging in Robolectric for logging alone.
            isReturnDefaultValues = true
        }
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}")
    }
}

dependencies {
    implementation(libs.androidx.core)
    implementation(libs.androidx.appcompat)
    implementation(libs.google.material)
    implementation(libs.androidx.constraintlayout)
    implementation(libs.androidx.lifecycle.runtime)

    // Deferred, constraint-aware background work.
    implementation(libs.androidx.work.runtime)

    // Local persistence: offline result queue + device configuration.
    implementation(libs.androidx.room.runtime)
    annotationProcessor(libs.androidx.room.compiler)

    implementation(libs.retrofit)
    implementation(libs.retrofit.gson)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)

    testImplementation(libs.junit)
    testImplementation(libs.okhttp.mockwebserver)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
}

// Surface deprecation and unchecked warnings during development.
tasks.withType<JavaCompile>().configureEach {
    options.compilerArgs.addAll(listOf("-Xlint:deprecation", "-Xlint:unchecked"))
}

plugins {
    alias(libs.plugins.kotlin.multiplatform)
    // AGP 9: KMP modules use this plugin, not com.android.library.
    alias(libs.plugins.android.kmp.library)
    alias(libs.plugins.apollo)
}

kotlin {
    android {
        namespace = "com.shepherdmysheep.shared"
        compileSdk = 37
        minSdk = 26

        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }

    listOf(
        iosX64(),
        iosArm64(),
        iosSimulatorArm64(),
    ).forEach { target ->
        target.binaries.framework {
            baseName = "shared"
            isStatic = true
        }
    }

    sourceSets {
        commonMain.dependencies {
            implementation(libs.apollo.runtime)
            implementation(libs.ktor.client.core)
            implementation(libs.coroutines.core)
            implementation(libs.koin.core)
        }

        androidMain.dependencies {
            implementation(libs.ktor.client.okhttp)
        }

        iosMain.dependencies {
            implementation(libs.ktor.client.darwin)
        }
    }
}

apollo {
    service("shepherd") {
        packageName.set("com.shepherdmysheep.graphql")
        schemaFile.set(file("../backend/graphql/schema.graphql"))

        // Unmapped custom scalars would be generated as Any. The domain
        // models carry all three as strings.
        mapScalarToKotlinString("UUID")
        mapScalarToKotlinString("Date")
        mapScalarToKotlinString("DateTime")
    }
}

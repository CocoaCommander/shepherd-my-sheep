plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.kmp.library) apply false
    alias(libs.plugins.kotlin.multiplatform) apply false
    alias(libs.plugins.apollo) apply false
    alias(libs.plugins.compose.compiler) apply false
    alias(libs.plugins.detekt)
}

// One detekt run over every module's sources. Formatting is ktlint's job
// (see .pre-commit-config.yaml), so detekt-formatting is deliberately not added.
detekt {
    buildUponDefaultConfig = true
    config.setFrom(files("config/detekt/detekt.yml"))
    // Findings in code that predates detekt; new code is held to the rules.
    // Regenerate with `gradle detektBaseline` after fixing any of them.
    baseline = file("config/detekt/baseline.xml")
    source.setFrom(
        fileTree("shared/src") { include("**/*.kt") },
        fileTree("androidApp/src") { include("**/*.kt") },
        fileTree(".") { include("*.kts", "*/*.kts") },
    )
}

dependencies {
    detektPlugins(libs.compose.rules.detekt)
}

# iOS App — Shepherd My Sheep

SwiftUI for the UI; the KMP `shared` framework for models, the GraphQL
client and the repository.

## Running

1. Install the iOS platform once: Xcode → Settings → Components → iOS.
   Without it Xcode reports "iOS … is not installed" and won't build
   for a device or simulator.
2. Open `iosApp/iosApp.xcodeproj`, pick a simulator, and Run.

The **Compile Kotlin Framework** build phase runs
`./gradlew :shared:embedAndSignAppleFrameworkForXcode` before the Swift
sources compile, so Kotlin changes are picked up on every build. Gradle
skips the work when nothing changed. `shared` is a static framework, so
it is linked into the app binary rather than embedded.

To run on a device, set your team under Signing & Capabilities.

## Project structure

```
iosApp/
├── iosApp.xcodeproj
├── iosApp/                   ← synced folder: new .swift files here are
│   ├── ShepherdApp.swift       added to the target automatically
│   └── ContentView.swift
└── README.md
```

## Calling Kotlin from Swift

Top-level Kotlin functions are exported on a class named after the file
that defines them, e.g. `getPlatform()` (actual in `Platform.ios.kt`) is
`Platform_iosKt.getPlatform()`. Check
`shared/build/xcode-frameworks/.../shared.framework/Headers/shared.h`
for exact names.

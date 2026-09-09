# iOS App — Shepherd My Sheep

## Setup

The iOS app uses SwiftUI for the UI layer and the KMP `shared` framework
for business logic and GraphQL client.

### First-time setup

1. Build the shared framework from the project root:
   ```
   ./gradlew :shared:linkDebugFrameworkIosSimulatorArm64
   ```

2. Open `iosApp.xcodeproj` in Xcode (or create it via KMP project wizard).

3. Add the shared framework:
   - In Xcode, go to target → General → Frameworks
   - Add `shared.framework` from `shared/build/bin/iosSimulatorArm64/debugFramework/`

4. Run on a simulator or device.

### Project structure

```
iosApp/
├── iosApp/
│   ├── ShepherdApp.swift     ← App entry point
│   └── ContentView.swift     ← Main view (SwiftUI)
└── README.md
```

The Xcode project file (`.xcodeproj`) is generated when you first set up
the project through Android Studio's KMP wizard or manually via Xcode.

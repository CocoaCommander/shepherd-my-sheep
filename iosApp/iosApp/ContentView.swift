import SwiftUI
import shared

struct ContentView: View {
    var body: some View {
        VStack(spacing: 8) {
            Text("Shepherd My Sheep")
                .font(.largeTitle)
                .fontWeight(.bold)

            Text("Running on \(Platform_iosKt.getPlatform().name)")
                .font(.body)
                .foregroundColor(.secondary)
        }
        .padding()
    }
}

#Preview {
    ContentView()
}

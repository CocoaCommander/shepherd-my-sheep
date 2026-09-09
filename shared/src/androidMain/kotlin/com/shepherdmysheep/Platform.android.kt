package com.shepherdmysheep

actual fun getPlatform(): Platform = Platform("Android ${android.os.Build.VERSION.SDK_INT}")

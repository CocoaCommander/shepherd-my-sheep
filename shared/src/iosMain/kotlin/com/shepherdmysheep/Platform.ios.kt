package com.shepherdmysheep

import platform.UIKit.UIDevice

actual fun getPlatform(): Platform = Platform(
    UIDevice.currentDevice.systemName() + " " + UIDevice.currentDevice.systemVersion
)

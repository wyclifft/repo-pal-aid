# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Keep native Bluetooth bridge classes (package was finalized as app.delicoop101)
-keep class app.delicoop101.bluetooth.** { *; }
-keepclassmembers class app.delicoop101.bluetooth.** {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep Capacitor annotations
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public *;
}

# v2.11.28: keep the recovered vendor POS SDK (JNI entry points resolved by name)
-keep class vpos.** { *; }
-keep class com.cspos.** { *; }
-keepclasseswithmembernames class * { native <methods>; }

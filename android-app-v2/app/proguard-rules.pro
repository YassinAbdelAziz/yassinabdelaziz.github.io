# Keep generic signatures and attributes used by Gson/Retrofit reflection.
-keepattributes Signature, InnerClasses, EnclosingMethod, *Annotation*

# Retrofit
-keepattributes RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations
-keep class retrofit2.** { *; }
-keep interface retrofit2.** { *; }
-dontwarn retrofit2.**
-dontwarn okhttp3.**

# Gson models (data classes used with Gson)
-keep class com.yassinabdelaziz.ystream.data.model.** { *; }

# Coil
-dontwarn coil.**

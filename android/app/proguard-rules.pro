# Retrofit / OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn retrofit2.**
-keepattributes Signature, InnerClasses, EnclosingMethod
-keepattributes RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations
-keepclassmembers,allowshrinking,allowobfuscation interface * {
    @retrofit2.http.* <methods>;
}

# Gson reflects over the API model classes, so their field names must survive
# obfuscation or every response deserialises to nulls.
-keep class com.example.gateway.model.** { *; }
-keepclassmembers class com.example.gateway.model.** { <fields>; }

# Room generated implementations
-keep class * extends androidx.room.RoomDatabase
-dontwarn androidx.room.paging.**

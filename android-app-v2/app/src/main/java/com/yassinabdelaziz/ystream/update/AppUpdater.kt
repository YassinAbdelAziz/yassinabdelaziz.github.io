package com.yassinabdelaziz.ystream.update

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.yassinabdelaziz.ystream.BuildConfig
import com.yassinabdelaziz.ystream.data.LocalStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Detects, downloads and installs APK updates published as GitHub Releases in the
 * app's repository (https://github.com/yassinabdelaziz/yassinabdelaziz.github.io).
 *
 * Versioning is derived from the release tag ("v1.2.3") and compared against the
 * installed [BuildConfig.VERSION_NAME], so no version number ever needs to be
 * hardcoded in the app. Dismissing a release is remembered so the user is never
 * nagged twice for the same version.
 */
class AppUpdater(
    private val context: Context,
    private val store: LocalStore
) {

    sealed interface UpdateState {
        data object Idle : UpdateState
        data object Checking : UpdateState
        data class Available(val release: ReleaseInfo) : UpdateState
        data class Downloading(val progress: Float) : UpdateState
        data class Downloaded(val file: File, val release: ReleaseInfo) : UpdateState
        data class NeedsInstallPermission(val file: File, val release: ReleaseInfo) : UpdateState
        data class Error(val message: String) : UpdateState
        data object UpToDate : UpdateState
    }

    data class ReleaseInfo(
        val tag: String,
        val versionName: String,
        val apkUrl: String,
        val apkName: String,
        val apkSize: Long,
        val notes: String
    )

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    private val _state = MutableStateFlow<UpdateState>(UpdateState.Idle)
    val state: StateFlow<UpdateState> = _state.asStateFlow()

    private val scope = CoroutineScope(Dispatchers.Main + kotlinx.coroutines.SupervisorJob())

    /** Performs a check; silently ignores failures unless [force] is set. */
    fun check(force: Boolean = false) {
        val current = _state.value
        if (current is UpdateState.Checking || current is UpdateState.Downloading) return
        scope.launch {
            _state.value = UpdateState.Checking
            try {
                val info = withContext(Dispatchers.IO) { fetchLatestRelease() }
                if (info == null) {
                    _state.value = if (force) UpdateState.UpToDate else UpdateState.Idle
                    return@launch
                }
                val installed = BuildConfig.VERSION_NAME
                val dismissed = store.getDismissedUpdateVersion()
                val newer = compareVersions(info.versionName, installed) > 0
                val notDismissed = compareVersions(info.versionName, dismissed) > 0
                if (!newer || !notDismissed) {
                    _state.value = if (force) UpdateState.UpToDate else UpdateState.Idle
                } else {
                    _state.value = UpdateState.Available(info)
                }
            } catch (_: Exception) {
                _state.value = if (force)
                    UpdateState.Error("Couldn't check for updates. Check your connection.")
                else UpdateState.Idle
            }
        }
    }

    fun dismiss() {
        val current = _state.value
        if (current is UpdateState.Available) {
            store.setDismissedUpdateVersion(current.release.versionName)
        }
        (current as? UpdateState.Downloaded)?.file?.delete()
        _state.value = UpdateState.Idle
    }

    fun download() {
        val current = _state.value
        if (current !is UpdateState.Available) return
        scope.launch {
            try {
                _state.value = UpdateState.Downloading(0f)
                val file = withContext(Dispatchers.IO) {
                    downloadApk(current.release) { p -> _state.value = UpdateState.Downloading(p) }
                }
                _state.value = UpdateState.Downloaded(file, current.release)
            } catch (_: Exception) {
                _state.value = UpdateState.Error("Download failed. Check your connection and try again.")
            }
        }
    }

    /** Starts installation, requesting the install-unknown-apps permission if needed. */
    fun install() {
        val current = _state.value
        val file = (current as? UpdateState.Downloaded)?.file ?: return
        val release = current.release
        if (!verifyApk(file, release.apkSize)) {
            file.delete()
            _state.value = UpdateState.Error("The downloaded file was corrupted. Please try again.")
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !context.packageManager.canRequestPackageInstalls()
        ) {
            _state.value = UpdateState.NeedsInstallPermission(file, release)
            return
        }
        launchInstall(file)
    }

    /** Call after the user returns from the unknown-apps settings screen. */
    fun retryInstallAfterPermission() {
        val current = _state.value
        val file = (current as? UpdateState.NeedsInstallPermission)?.file ?: return
        val release = current.release
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !context.packageManager.canRequestPackageInstalls()
        ) {
            _state.value = UpdateState.Error("Install permission was not granted.")
            file.delete()
            return
        }
        _state.value = UpdateState.Downloaded(file, release)
        install()
    }

    private fun launchInstall(file: File) {
        val uri = FileProvider.getUriForFile(
            context, "${BuildConfig.APPLICATION_ID}.fileprovider", file
        )
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            context.startActivity(intent)
            _state.value = UpdateState.Idle
            // The package installer reads the content URI after launch; clear the
            // file once the install flow has had time to pick it up.
            scope.launch {
                delay(60_000)
                file.delete()
            }
        } catch (_: Exception) {
            file.delete()
            _state.value = UpdateState.Error("Couldn't open the installer.")
        }
    }

    private suspend fun fetchLatestRelease(): ReleaseInfo? = withContext(Dispatchers.IO) {
        val url = "https://api.github.com/repos/${BuildConfig.GITHUB_OWNER}/${BuildConfig.GITHUB_REPO}/releases/latest"
        val request = Request.Builder()
            .url(url)
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "YStream-Android")
            .build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return@withContext null
            val body = response.body?.string() ?: return@withContext null
            val json = JSONObject(body)
            val tag = json.optString("tag_name", "")
            val notes = json.optString("body", "")
            val assets = json.optJSONArray("assets")
            if (assets != null) {
                for (i in 0 until assets.length()) {
                    val asset = assets.getJSONObject(i)
                    val name = asset.optString("name", "")
                    if (!name.endsWith(".apk", ignoreCase = true)) continue
                    return@withContext ReleaseInfo(
                        tag = tag,
                        versionName = tag.removePrefix("v").removePrefix("V"),
                        apkUrl = asset.optString("browser_download_url", ""),
                        apkName = name,
                        apkSize = asset.optLong("size", 0L),
                        notes = notes
                    )
                }
            }
            null
        }
    }

    private suspend fun downloadApk(
        release: ReleaseInfo,
        onProgress: (Float) -> Unit
    ): File = withContext(Dispatchers.IO) {
        val dir = File(context.getExternalFilesDir(null), "updates").apply { mkdirs() }
        val file = File(dir, release.apkName)
        if (file.exists()) file.delete()
        val request = Request.Builder()
            .url(release.apkUrl)
            .header("User-Agent", "YStream-Android")
            .build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw java.io.IOException("HTTP ${response.code}")
            val contentLength = response.body?.contentLength() ?: -1L
            response.body?.byteStream()?.use { input ->
                file.outputStream().buffered().use { output ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    var downloaded = 0L
                    while (true) {
                        val read = input.read(buffer)
                        if (read == -1) break
                        output.write(buffer, 0, read)
                        downloaded += read
                        if (contentLength > 0) {
                            onProgress((downloaded.toFloat() / contentLength.toFloat()).coerceIn(0f, 1f))
                        }
                    }
                }
            }
        }
        file
    }

    /** APKs are ZIP archives; verify the magic bytes plus the expected size. */
    private fun verifyApk(file: File, expectedSize: Long): Boolean {
        if (expectedSize > 0 && file.length() != expectedSize) return false
        if (file.length() < 4) return false
        val magic = file.inputStream().use { input ->
            val bytes = ByteArray(4)
            val read = input.read(bytes)
            read == 4 && bytes[0] == 'P'.code.toByte() && bytes[1] == 'K'.code.toByte() &&
                    bytes[2] == 0x03.toByte() && bytes[3] == 0x04.toByte()
        }
        return magic
    }

    /** Simple semantic-version comparison; a non-parseable string sorts as 0.0.0. */
    private fun compareVersions(a: String, b: String): Int {
        fun parts(v: String): List<Int> =
            v.trim().split(".").mapNotNull { it.toIntOrNull() }
        val ap = parts(a); val bp = parts(b)
        val len = maxOf(ap.size, bp.size)
        for (i in 0 until len) {
            val x = ap.getOrElse(i) { 0 }
            val y = bp.getOrElse(i) { 0 }
            if (x != y) return x.compareTo(y)
        }
        return 0
    }
}

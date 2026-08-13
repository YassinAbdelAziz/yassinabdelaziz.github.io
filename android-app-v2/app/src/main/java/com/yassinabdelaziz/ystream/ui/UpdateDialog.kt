package com.yassinabdelaziz.ystream.ui

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.yassinabdelaziz.ystream.update.AppUpdater

@Composable
fun UpdateDialog(updater: AppUpdater) {
    val state by updater.state.collectAsState()
    val context = LocalContext.current

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) {
        updater.retryInstallAfterPermission()
    }

    when (val s = state) {
        is AppUpdater.UpdateState.Available -> AlertDialog(
            onDismissRequest = { updater.dismiss() },
            title = { Text("Update available") },
            text = {
                Column {
                    Text("A new version (${s.release.versionName}) is available for YStream.")
                    if (s.release.notes.isNotBlank()) {
                        Spacer(Modifier.height(10.dp))
                        Text(
                            text = s.release.notes,
                            style = MaterialTheme.typography.bodySmall,
                            maxLines = 6,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { updater.download() }) { Text("Update", fontWeight = FontWeight.SemiBold) }
            },
            dismissButton = {
                TextButton(onClick = { updater.dismiss() }) { Text("Later") }
            }
        )

        is AppUpdater.UpdateState.Downloading -> AlertDialog(
            onDismissRequest = {},
            title = { Text("Downloading update") },
            text = {
                Column {
                    LinearProgressIndicator(
                        progress = { s.progress },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(6.dp)
                    )
                    Spacer(Modifier.height(10.dp))
                    Text(
                        text = "${(s.progress * 100).toInt()}%",
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            },
            confirmButton = {}
        )

        is AppUpdater.UpdateState.Downloaded -> AlertDialog(
            onDismissRequest = { updater.dismiss() },
            title = { Text("Ready to install") },
            text = { Text("The update has been downloaded. Install it now?") },
            confirmButton = {
                TextButton(onClick = { updater.install() }) { Text("Install", fontWeight = FontWeight.SemiBold) }
            },
            dismissButton = {
                TextButton(onClick = { updater.dismiss() }) { Text("Later") }
            }
        )

        is AppUpdater.UpdateState.NeedsInstallPermission -> {
            LaunchedEffect(s) {
                val intent = Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${context.packageName}")
                )
                permissionLauncher.launch(intent)
            }
        }

        is AppUpdater.UpdateState.Error -> AlertDialog(
            onDismissRequest = { updater.dismiss() },
            title = { Text("Update failed") },
            text = { Text(s.message) },
            confirmButton = {
                TextButton(onClick = { updater.dismiss() }) { Text("OK") }
            }
        )

        else -> Unit
    }
}

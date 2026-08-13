package com.yassinabdelaziz.ystream

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import com.yassinabdelaziz.ystream.ui.UpdateDialog
import com.yassinabdelaziz.ystream.ui.navigation.YStreamNav
import com.yassinabdelaziz.ystream.ui.theme.YStreamTheme

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app = application as YStreamApp
        setContent {
            YStreamTheme {
                Box(Modifier.fillMaxSize()) {
                    YStreamNav()
                    UpdateDialog(app.updater)
                }
            }
        }
    }
}

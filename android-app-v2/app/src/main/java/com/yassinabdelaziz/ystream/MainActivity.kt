package com.yassinabdelaziz.ystream

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.yassinabdelaziz.ystream.ui.navigation.YStreamNav
import com.yassinabdelaziz.ystream.ui.theme.YStreamTheme

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            YStreamTheme {
                YStreamNav()
            }
        }
    }
}

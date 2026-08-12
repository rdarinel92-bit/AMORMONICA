package com.rober.chatprivadoligero

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.rober.chatprivadoligero.chat.ChatViewModel
import com.rober.chatprivadoligero.chat.ChatViewModelFactory
import com.rober.chatprivadoligero.profiles.AppProfile
import com.rober.chatprivadoligero.push.FirebasePushManager

class MainActivity : ComponentActivity() {
    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            NotificationHelper.ensureChannel(this)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestNotificationPermissionIfNeeded()
        val app = application as NativeApp
        setContent {
            val container = app.getContainer()
            if (container == null) {
                StartupErrorScreen()
            } else {
                var currentProfile by remember { mutableStateOf(container.profileStore.getSelectedProfile()) }

                if (currentProfile == null) {
                    ProfileSelectionScreen(
                        container = container,
                        onSelect = { profile: AppProfile ->
                            container.profileStore.setSelectedProfile(profile)
                            currentProfile = profile
                        }
                    )
                } else {
                    val selectedProfile = currentProfile!!
                    val chatViewModel: ChatViewModel = viewModel(
                        key = "chat-vm-${selectedProfile.id}",
                        factory = ChatViewModelFactory(
                            container.repository,
                            container.mediaUploadRepository,
                            selectedProfile
                        )
                    )

                    LaunchedEffect(selectedProfile) {
                        container.setActiveProfile(selectedProfile.id)
                        FirebasePushManager.syncToken(container.appContext, container.repository, selectedProfile)
                    }

                    ChatApp(
                        viewModel = chatViewModel,
                        onSwitchProfile = {
                            container.profileStore.clearSelectedProfile()
                            currentProfile = null
                        }
                    )
                }
            }
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
}

@Composable
private fun StartupErrorScreen() {
    MaterialTheme {
        Surface(color = Color(0xFF0D1117)) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(24.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(text = "No se pudo inicializar la app")
                Text(text = "Revisa el almacenamiento interno o reinstala la aplicación.")
            }
        }
    }
}

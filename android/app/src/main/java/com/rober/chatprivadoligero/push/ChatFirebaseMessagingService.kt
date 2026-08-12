package com.rober.chatprivadoligero.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.rober.chatprivadoligero.NotificationHelper
import com.rober.chatprivadoligero.NativeApp
import com.rober.chatprivadoligero.MessageSyncWorker
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.util.LinkedHashSet
import java.util.concurrent.TimeUnit

class ChatFirebaseMessagingService : FirebaseMessagingService() {
    companion object {
        private const val PUSH_SYNC_WORK = "push-sync-now"
        private const val MAX_RECENT_MESSAGE_IDS = 200
        private val recentMessageIds = LinkedHashSet<String>()

        @Synchronized
        private fun seenRecently(messageId: String): Boolean {
            if (messageId.isBlank()) return false
            if (recentMessageIds.contains(messageId)) {
                return true
            }
            recentMessageIds.add(messageId)
            while (recentMessageIds.size > MAX_RECENT_MESSAGE_IDS) {
                val first = recentMessageIds.firstOrNull() ?: break
                recentMessageIds.remove(first)
            }
            return false
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewToken(token: String) {
        val app = application as? NativeApp ?: return
        val container = app.getContainer() ?: return
        val profile = container.profileStore.getSelectedProfile()
        FirebasePushManager.syncKnownToken(container.repository, profile, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val app = application as? NativeApp
        val container = app?.getContainer()
        val activeProfile = container?.profileStore?.getSelectedProfile()
        if (container != null && activeProfile != null) {
            scope.launch {
                runCatching { container.repository.syncFromRemote(activeProfile.id) }
            }
        }
        scheduleImmediateSync()

        val sender = message.data["sender"]
            ?: message.notification?.title
            ?: "Nuevo mensaje"
        val receiver = message.data["receiver"]
            ?: ""
        val messageId = message.data["message_id"]
            ?: ""
        val body = message.data["body"]
            ?: message.notification?.body
            ?: "Tienes un mensaje nuevo"

        val senderNormalized = sender.trim().lowercase()
        val activeProfileId = activeProfile?.id?.trim()?.lowercase()
        val receiverNormalized = receiver.trim().lowercase()

        if (activeProfileId != null && receiverNormalized.isNotBlank() && receiverNormalized != activeProfileId) {
            return
        }
        if (activeProfileId != null && senderNormalized == activeProfileId) {
            return
        }
        if (seenRecently(messageId.trim().lowercase())) {
            return
        }

        NotificationHelper.alertIncomingMessage(sender, body)
    }

    private fun scheduleImmediateSync() {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val request = OneTimeWorkRequestBuilder<MessageSyncWorker>()
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
            .build()

        WorkManager.getInstance(applicationContext).enqueueUniqueWork(
            PUSH_SYNC_WORK,
            ExistingWorkPolicy.REPLACE,
            request
        )
    }
}
package com.rober.chatprivadoligero

import android.app.Application
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

class NativeApp : Application() {
    override fun onCreate() {
        super.onCreate()
        scheduleLightSync()
    }

    private fun scheduleLightSync() {
        val request = PeriodicWorkRequestBuilder<MessageSyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
            )
            .build()

        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            "message-sync",
            ExistingPeriodicWorkPolicy.UPDATE,
            request
        )
    }
}

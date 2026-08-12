package com.rober.chatprivadoligero

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.rober.chatprivadoligero.data.AppContainer
import com.rober.chatprivadoligero.profiles.AppProfile

class MessageSyncWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val appContainer = runCatching {
            AppContainer(applicationContext)
        }.getOrElse { error ->
            Log.e("MessageSyncWorker", "No se pudo inicializar el contenedor", error)
            return Result.retry()
        }

        val activeProfile = appContainer.profileStore.getSelectedProfile() ?: AppProfile.ROBERTO

        runCatching {
            appContainer.repository.syncFromRemote(activeProfile.id)
        }.onFailure { error ->
            Log.e("MessageSyncWorker", "Error sincronizando mensajes", error)
            return Result.retry()
        }

        return Result.success()
    }
}

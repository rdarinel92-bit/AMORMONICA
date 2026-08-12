package com.rober.chatprivadoligero.data

import android.content.Context
import com.rober.chatprivadoligero.MediaUploadScheduler
import com.rober.chatprivadoligero.R
import com.rober.chatprivadoligero.calendar.SharedCalendarRepository
import com.rober.chatprivadoligero.network.BandwidthManager
import com.rober.chatprivadoligero.profiles.ProfileStore
import com.rober.chatprivadoligero.settings.ProfileSettingsStore
import com.rober.chatprivadoligero.tasks.SharedTasksRepository

class AppContainer(context: Context) {
    private val db = ChatDatabase.get(context)
    val appContext: Context = context.applicationContext
    val profileStore = ProfileStore(appContext)
    val profileSettingsStore = ProfileSettingsStore(appContext)
    val bandwidthManager = BandwidthManager(appContext)

    private val supabaseClient = SupabaseRestClient(
        supabaseUrl = appContext.getString(R.string.supabase_url),
        anonKey = appContext.getString(R.string.supabase_anon_key)
    )

    val repository: ChatRepository = ChatRepository(
        dao = db.messageDao(),
        supabase = supabaseClient,
        bandwidth = bandwidthManager,
        sessionId = appContext.getString(R.string.supabase_session_id)
    )
    val mediaUploadRepository: MediaUploadRepository = MediaUploadRepository(
        db.mediaUploadDao(),
        onTaskQueued = { MediaUploadScheduler.enqueueNow(appContext) }
    )
    val sharedCalendarRepository = SharedCalendarRepository(
        dao = db.sharedEventDao(),
        context = appContext
    )
    val sharedTasksRepository = SharedTasksRepository(
        dao = db.sharedTaskDao(),
        context = appContext
    )

    fun setActiveProfile(profileId: String) {
        supabaseClient.activeProfileId = profileId
    }
}

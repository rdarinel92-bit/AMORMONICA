package com.rober.chatprivadoligero.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URLEncoder
import java.net.URL
import java.nio.charset.StandardCharsets
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.zip.GZIPInputStream
import org.json.JSONArray
import org.json.JSONObject

data class RemoteMessage(
    val sender: String,
    val receiver: String,
    val type: String,
    val content: String,
    val timestampIso: String,
    val status: String,
    val chunksTotal: Int,
    val chunksSent: Int,
    val sessionId: String,
    val localId: String,
    val metadata: JSONObject? = null
)

class SupabaseRestClient(
    private val supabaseUrl: String,
    private val anonKey: String
) {
    /** Set to the active profile's ID to satisfy the x-app-profile-id RLS header. */
    var activeProfileId: String? = null

    val configured: Boolean
        get() = supabaseUrl.isNotBlank() && anonKey.isNotBlank() && !supabaseUrl.contains("example")

    /**
     * @param sinceTimestampIso  When set, only fetches messages newer than this ISO-8601 timestamp
     *                           (delta sync — avoids re-downloading messages already stored locally).
     */
    suspend fun fetchMessages(
        sessionId: String,
        limit: Int = 150,
        sinceTimestampIso: String? = null
    ): List<RemoteMessage> = withContext(Dispatchers.IO) {
        if (!configured) return@withContext emptyList()

        val params = mutableListOf(
            "select=sender,receiver,type,content,timestamp,status,chunks_total,chunks_sent,session_id,local_id,metadata",
            "session_id=eq.${encode(sessionId)}",
            "order=timestamp.asc",
            "limit=${limit.coerceIn(1, 500)}"
        )
        sinceTimestampIso?.let { params.add("timestamp=gt.${encode(it)}") }
        val query = params.joinToString("&")

        val conn = openConnection("/rest/v1/messages?$query", "GET")
        try {
            if (conn.responseCode !in 200..299) {
                return@withContext emptyList()
            }
            val payload = readBody(conn)
            val arr = JSONArray(payload)
            buildList {
                for (i in 0 until arr.length()) {
                    val obj = arr.optJSONObject(i) ?: continue
                    add(
                        RemoteMessage(
                            sender = obj.optString("sender"),
                            receiver = obj.optString("receiver"),
                            type = obj.optString("type", "text"),
                            content = obj.optString("content"),
                            timestampIso = obj.optString("timestamp"),
                            status = obj.optString("status", "pending"),
                            chunksTotal = obj.optInt("chunks_total", 1),
                            chunksSent = obj.optInt("chunks_sent", 0),
                            sessionId = obj.optString("session_id", "shared-room"),
                            localId = obj.optString("local_id"),
                            metadata = obj.optJSONObject("metadata")
                        )
                    )
                }
            }
        } finally {
            conn.disconnect()
        }
    }

    suspend fun insertMessage(message: RemoteMessage): Boolean = withContext(Dispatchers.IO) {
        if (!configured) return@withContext false
        val body = JSONObject()
            .put("sender", message.sender)
            .put("receiver", message.receiver)
            .put("type", message.type)
            .put("content", message.content)
            .put("timestamp", message.timestampIso)
            .put("status", message.status)
            .put("chunks_total", message.chunksTotal)
            .put("chunks_sent", message.chunksSent)
            .put("session_id", message.sessionId)
            .put("local_id", message.localId)

        message.metadata?.let { body.put("metadata", it) }

        val conn = openConnection("/rest/v1/messages", "POST")
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setRequestProperty("Prefer", "return=minimal")
        conn.doOutput = true

        try {
            conn.outputStream.use { it.write(body.toString().toByteArray(StandardCharsets.UTF_8)) }
            conn.responseCode in listOf(200, 201)
        } finally {
            conn.disconnect()
        }
    }

    suspend fun dispatchPushNow(limit: Int = 10): Boolean = withContext(Dispatchers.IO) {
        if (!configured) return@withContext false

        val conn = openConnection("/functions/v1/dispatchPushNotifications", "POST")
        conn.setRequestProperty("Content-Type", "application/json")
        conn.doOutput = true

        val payload = JSONObject().put("limit", limit.coerceIn(1, 50))

        try {
            conn.outputStream.use { it.write(payload.toString().toByteArray(StandardCharsets.UTF_8)) }
            conn.responseCode in 200..299
        } finally {
            conn.disconnect()
        }
    }

    suspend fun updateMessageStatus(localId: String, status: String, chunksSent: Int? = null): Boolean = withContext(Dispatchers.IO) {
        if (!configured) return@withContext false
        val path = "/rest/v1/messages?local_id=eq.${encode(localId)}"
        val payload = JSONObject().put("status", status)
        if (chunksSent != null) {
            payload.put("chunks_sent", chunksSent)
        }

        val conn = openConnection(path, "PATCH")
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setRequestProperty("Prefer", "return=minimal")
        conn.doOutput = true

        try {
            conn.outputStream.use { it.write(payload.toString().toByteArray(StandardCharsets.UTF_8)) }
            conn.responseCode in 200..299
        } finally {
            conn.disconnect()
        }
    }

    suspend fun updateMessageContent(localId: String, content: String, status: String? = null): Boolean = withContext(Dispatchers.IO) {
        if (!configured) return@withContext false
        val path = "/rest/v1/messages?local_id=eq.${encode(localId)}"
        val payload = JSONObject().put("content", content)
        if (!status.isNullOrBlank()) {
            payload.put("status", status)
        }

        val conn = openConnection(path, "PATCH")
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setRequestProperty("Prefer", "return=minimal")
        conn.doOutput = true

        try {
            conn.outputStream.use { it.write(payload.toString().toByteArray(StandardCharsets.UTF_8)) }
            conn.responseCode in 200..299
        } finally {
            conn.disconnect()
        }
    }

    suspend fun deleteMessage(localId: String): Boolean = withContext(Dispatchers.IO) {
        if (!configured || localId.isBlank()) return@withContext false
        val path = "/rest/v1/messages?local_id=eq.${encode(localId)}"

        val conn = openConnection(path, "DELETE")
        conn.setRequestProperty("Prefer", "return=minimal")

        try {
            conn.responseCode in 200..299
        } finally {
            conn.disconnect()
        }
    }

    suspend fun markIncomingAsRead(receiver: String, sessionId: String): Boolean = withContext(Dispatchers.IO) {
        if (!configured) return@withContext false
        val path = "/rest/v1/messages?receiver=eq.${encode(receiver)}&session_id=eq.${encode(sessionId)}&status=in.(sent,delivered)"
        val payload = JSONObject().put("status", "read")

        val conn = openConnection(path, "PATCH")
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setRequestProperty("Prefer", "return=minimal")
        conn.doOutput = true

        try {
            conn.outputStream.use { it.write(payload.toString().toByteArray(StandardCharsets.UTF_8)) }
            conn.responseCode in 200..299
        } finally {
            conn.disconnect()
        }
    }

    suspend fun upsertProfile(profileId: String, status: String): Boolean = withContext(Dispatchers.IO) {
        if (!configured) return@withContext false
        val displayName = profileId.replaceFirstChar { it.uppercase() }
        val payload = JSONArray().put(
            JSONObject()
                .put("id", profileId)
                .put("name", displayName)
                .put("status", status)
        )

        val conn = openConnection("/rest/v1/profiles", "POST")
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setRequestProperty("Prefer", "resolution=merge-duplicates,return=minimal")
        conn.doOutput = true

        try {
            conn.outputStream.use { it.write(payload.toString().toByteArray(StandardCharsets.UTF_8)) }
            conn.responseCode in 200..299
        } finally {
            conn.disconnect()
        }
    }

    suspend fun fetchProfileStatus(profileId: String): String? = withContext(Dispatchers.IO) {
        if (!configured) return@withContext null
        val query = "select=status&id=eq.${encode(profileId)}&limit=1"
        val conn = openConnection("/rest/v1/profiles?$query", "GET")
        try {
            if (conn.responseCode !in 200..299) {
                return@withContext null
            }
            val payload = readBody(conn)
            val arr = JSONArray(payload)
            if (arr.length() == 0) return@withContext null
            arr.optJSONObject(0)?.optString("status")?.ifBlank { null }
        } finally {
            conn.disconnect()
        }
    }

    suspend fun upsertDeviceToken(profileId: String, token: String, platform: String): Boolean = withContext(Dispatchers.IO) {
        if (!configured || profileId.isBlank() || token.isBlank()) return@withContext false

        val payload = JSONArray().put(
            JSONObject()
                .put("profile_id", profileId)
                .put("platform", platform)
                .put("token", token)
                .put("active", true)
        )

        val conn = openConnection("/rest/v1/device_tokens", "POST")
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setRequestProperty("Prefer", "resolution=merge-duplicates,return=minimal")
        conn.doOutput = true

        try {
            conn.outputStream.use { it.write(payload.toString().toByteArray(StandardCharsets.UTF_8)) }
            conn.responseCode in 200..299
        } finally {
            conn.disconnect()
        }
    }

    fun nowIso(): String {
        val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        format.timeZone = TimeZone.getTimeZone("UTC")
        return format.format(Date())
    }

    private fun openConnection(path: String, method: String): HttpURLConnection {
        val url = URL("${supabaseUrl.trimEnd('/')}$path")
        return (url.openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = 30_000
            setRequestProperty("apikey", anonKey)
            setRequestProperty("Authorization", "Bearer $anonKey")
            setRequestProperty("Accept", "application/json")
            activeProfileId?.takeIf { it.isNotBlank() }?.let {
                setRequestProperty("x-app-profile-id", it)
            }
            // Ask the server for gzip — on a 7 kbps link a 30 KB JSON payload
            // compresses to ~3 KB, cutting transfer time by ~10×.
            setRequestProperty("Accept-Encoding", "gzip")
        }
    }

    /**
     * Reads the response body, automatically decompressing gzip if the server
     * returned `Content-Encoding: gzip`.
     */
    private fun readBody(conn: HttpURLConnection): String {
        val encoding = conn.contentEncoding ?: ""
        val stream = if (encoding.equals("gzip", ignoreCase = true)) {
            GZIPInputStream(conn.inputStream)
        } else {
            conn.inputStream
        }
        return stream.bufferedReader(StandardCharsets.UTF_8).use { it.readText() }
    }

    private fun encode(value: String): String {
        return URLEncoder.encode(value, StandardCharsets.UTF_8.toString())
    }
}

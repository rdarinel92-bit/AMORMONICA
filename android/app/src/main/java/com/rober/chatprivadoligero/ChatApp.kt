package com.rober.chatprivadoligero

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Divider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

private data class ChatMessage(
  val sender: String,
  val body: String,
  val status: String
)

@Composable
fun ChatApp() {
  val messages = remember {
    mutableStateListOf(
      ChatMessage("Miniña", "Chat nativo listo. Ligero y estable.", "sent"),
      ChatMessage("Roberto", "Supabase queda como backend.", "delivered")
    )
  }
  var draft by remember { mutableStateOf("") }

  MaterialTheme {
    Scaffold(
      topBar = {
        TopAppBar(title = { Text("Chat Privado Ligero") })
      }
    ) { paddingValues ->
      Column(
        modifier = Modifier
          .fillMaxSize()
          .padding(paddingValues)
          .background(Color(0xFF0F1115))
          .padding(16.dp)
      ) {
        Text(
          text = "Miniña y Roberto",
          style = MaterialTheme.typography.titleMedium,
          fontWeight = FontWeight.Bold,
          color = Color.White
        )
        Text(
          text = "Base nativa preparada para Supabase y notificaciones.",
          style = MaterialTheme.typography.bodyMedium,
          color = Color(0xFFB7BCC7)
        )

        Spacer(modifier = Modifier.height(16.dp))

        Surface(
          modifier = Modifier.weight(1f).fillMaxWidth(),
          shape = RoundedCornerShape(20.dp),
          color = Color(0xFF171A21)
        ) {
          LazyColumn(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
          ) {
            items(messages) { message ->
              MessageBubble(message)
            }
          }
        }

        Spacer(modifier = Modifier.height(12.dp))

        OutlinedTextField(
          value = draft,
          onValueChange = { draft = it },
          modifier = Modifier.fillMaxWidth(),
          placeholder = { Text("Escribe un mensaje") },
          singleLine = true
        )

        Spacer(modifier = Modifier.height(12.dp))

        Row(
          modifier = Modifier.fillMaxWidth(),
          horizontalArrangement = Arrangement.SpaceBetween,
          verticalAlignment = Alignment.CenterVertically
        ) {
          Button(
            onClick = {
              if (draft.isNotBlank()) {
                messages.add(ChatMessage("Roberto", draft.trim(), "pending"))
                draft = ""
              }
            }
          ) {
            Text("Enviar")
          }
          Text(
            text = "Notificaciones: listas para integrar",
            color = Color(0xFF9BA3B5)
          )
        }
      }
    }
  }
}

@Composable
private fun MessageBubble(message: ChatMessage) {
  val isMine = message.sender == "Roberto"
  val background = if (isMine) Color(0xFF2F6FED) else Color(0xFF232833)
  val alignment = if (isMine) Alignment.End else Alignment.Start

  Box(
    modifier = Modifier.fillMaxWidth(),
    contentAlignment = alignment
  ) {
    Column(
      modifier = Modifier
        .background(background, RoundedCornerShape(16.dp))
        .padding(12.dp)
    ) {
      Text(text = message.sender, color = Color.White, fontWeight = FontWeight.SemiBold)
      Spacer(modifier = Modifier.height(4.dp))
      Text(text = message.body, color = Color(0xFFF5F7FB))
      Spacer(modifier = Modifier.height(6.dp))
      Divider(color = Color.White.copy(alpha = 0.12f))
      Text(text = message.status, color = Color(0xFFCBD3E1))
    }
  }
}

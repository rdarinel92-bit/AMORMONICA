const STORAGE_KEYS = {
  config: 'chat-lite-config',
  queuedTexts: 'chat-lite-queued-texts',
  localMessages: 'chat-lite-local-messages',
  knownRemoteIds: 'chat-lite-known-remote-ids'
};

const DB_NAME = 'chat-lite-db';
const DB_VERSION = 1;
const UPLOAD_STORE = 'uploads';
const CACHE_STORE = 'cache';
const CHUNK_SIZE = 5 * 1024;
const HEARTBEAT_MS = 25000;
const PROBE_HISTORY = 8;
const imageCache = new Map();
const COMMON_TYPO_FIXES = {
  adme: 'dame',
  corectas: 'correctas',
  escibir: 'escribir',
  hafga: 'haga',
  inndex: 'index',
  tranmicion: 'transmision',
  tranmision: 'transmision',
  po: 'por',
  mi: 'mi'
};

const defaultConfig = {
  supabaseUrl: 'https://kxhgjamftlniaspagfjo.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4aGdqYW1mdGxuaWFzcGFnZmpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNDYxOTQsImV4cCI6MjEwMTcyMjE5NH0.MnQQrNAGRP3nf_-L63O9iX4__055USW6gUq6lZUEMsk',
  sessionId: 'sala-principal',
  senderId: createId('user'),
  bucketName: 'chat-files',
  exportEndpoint: 'exportHistory',
  exportEmail: ''
};

const state = {
  config: { ...defaultConfig, ...loadJson(STORAGE_KEYS.config, {}) },
  mode: 'Sin configurar',
  kbps: 0,
  latency: 0,
  stability: 0,
  loss: 0,
  online: navigator.onLine,
  messages: loadJson(STORAGE_KEYS.localMessages, []),
  queuedTexts: loadJson(STORAGE_KEYS.queuedTexts, []),
  knownRemoteIds: new Set(loadJson(STORAGE_KEYS.knownRemoteIds, [])),
  probeSamples: [],
  db: null,
  realtimeSocket: null,
  heartbeatTimer: null,
  resumeTimer: null,
  initialized: false
};

const elements = {
  toggleSetup: document.getElementById('toggle-setup'),
  setupPanel: document.getElementById('setup-panel'),
  configForm: document.getElementById('config-form'),
  supabaseUrl: document.getElementById('supabase-url'),
  supabaseKey: document.getElementById('supabase-key'),
  sessionId: document.getElementById('session-id'),
  senderId: document.getElementById('sender-id'),
  bucketName: document.getElementById('bucket-name'),
  exportEndpoint: document.getElementById('export-endpoint'),
  exportEmail: document.getElementById('export-email'),
  reloadHistory: document.getElementById('reload-history'),
  exportHistory: document.getElementById('export-history'),
  downloadTranscript: document.getElementById('download-transcript'),
  setupRequirements: document.getElementById('setup-requirements'),
  chatLog: document.getElementById('chat-log'),
  messageTemplate: document.getElementById('message-template'),
  messageForm: document.getElementById('message-form'),
  messageInput: document.getElementById('message-input'),
  imageInput: document.getElementById('image-input'),
  connectionMode: document.getElementById('connection-mode'),
  connectionSpeed: document.getElementById('connection-speed'),
  connectionLatency: document.getElementById('connection-latency'),
  connectionStability: document.getElementById('connection-stability'),
  connectionLoss: document.getElementById('connection-loss'),
  queueSize: document.getElementById('queue-size'),
  composerHint: document.getElementById('composer-hint')
};

boot().catch((error) => {
  console.error(error);
  setComposerHint('Fallo al iniciar la aplicacion. Revisa la consola del navegador.');
});

async function boot() {
  bindUi();
  applyConfigToForm();
  elements.setupRequirements.textContent = buildSetupRequirements();
  renderMessages();
  updateQueueSize();
  updateConnectionUi();
  state.db = await openDb();
  state.initialized = true;
  await restoreUploadJobs();
  startConnectionMonitoring();
  await probeConnection();
  if (isConfigured()) {
    await refreshHistory();
    connectRealtime();
    flushQueues();
  }
}

function bindUi() {
  elements.toggleSetup.addEventListener('click', () => {
    elements.setupPanel.hidden = !elements.setupPanel.hidden;
  });

  elements.configForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    state.config = {
      supabaseUrl: elements.supabaseUrl.value.trim().replace(/\/$/, ''),
      supabaseKey: elements.supabaseKey.value.trim(),
      sessionId: elements.sessionId.value.trim() || defaultConfig.sessionId,
      senderId: elements.senderId.value.trim() || createId('user'),
      bucketName: elements.bucketName.value.trim() || defaultConfig.bucketName,
      exportEndpoint: elements.exportEndpoint.value.trim() || defaultConfig.exportEndpoint,
      exportEmail: elements.exportEmail.value.trim()
    };
    saveJson(STORAGE_KEYS.config, state.config);
    elements.setupRequirements.textContent = buildSetupRequirements();
    disconnectRealtime();
    updateConnectionUi();
    if (isConfigured()) {
      await refreshHistory();
      connectRealtime();
      flushQueues();
      setComposerHint('Configuracion guardada. Chat conectado si las politicas de Supabase ya estan creadas.');
    } else {
      setComposerHint('Falta URL o clave anon de Supabase.');
    }
  });

  elements.reloadHistory.addEventListener('click', () => {
    refreshHistory();
  });

  elements.messageForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = normalizeOutgoingText(elements.messageInput.value);
    if (!text) {
      return;
    }
    elements.messageInput.value = '';
    await enqueueTextMessage(text);
  });

  elements.messageInput.addEventListener('input', () => {
    applyTypingCorrections(elements.messageInput);
  });

  elements.imageInput.addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    await enqueueImageMessage(file);
  });

  elements.exportHistory.addEventListener('click', async () => {
    await exportHistory();
  });

  elements.downloadTranscript.addEventListener('click', () => {
    downloadTranscript();
  });

  window.addEventListener('online', () => {
    state.online = true;
    probeConnection().then(flushQueues);
  });

  window.addEventListener('offline', () => {
    state.online = false;
    updateConnectionUi();
  });
}

function applyConfigToForm() {
  elements.supabaseUrl.value = state.config.supabaseUrl;
  elements.supabaseKey.value = state.config.supabaseKey;
  elements.sessionId.value = state.config.sessionId;
  elements.senderId.value = state.config.senderId;
  elements.bucketName.value = state.config.bucketName;
  elements.exportEndpoint.value = state.config.exportEndpoint;
  elements.exportEmail.value = state.config.exportEmail;
}

function isConfigured() {
  return Boolean(state.config.supabaseUrl && state.config.supabaseKey && state.config.sessionId && state.config.senderId);
}

function setComposerHint(text) {
  elements.composerHint.textContent = text;
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function createId(prefix) {
  const random = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

function formatDate(value) {
  try {
    return new Date(value).toLocaleString('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit'
    });
  } catch {
    return value;
  }
}

function persistMessages() {
  saveJson(STORAGE_KEYS.localMessages, state.messages);
}

function persistQueuedTexts() {
  saveJson(STORAGE_KEYS.queuedTexts, state.queuedTexts);
}

function persistKnownRemoteIds() {
  saveJson(STORAGE_KEYS.knownRemoteIds, Array.from(state.knownRemoteIds));
}

function messageKey(message) {
  return message.local_id || message.id;
}

function upsertMessage(message) {
  const key = messageKey(message);
  const index = state.messages.findIndex((item) => messageKey(item) === key || (item.id && message.id && item.id === message.id));
  if (index >= 0) {
    state.messages[index] = { ...state.messages[index], ...message };
  } else {
    state.messages.push(message);
  }
  state.messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  persistMessages();
  renderMessages();
}

function renderMessages() {
  elements.chatLog.innerHTML = '';
  for (const message of state.messages) {
    const fragment = elements.messageTemplate.content.cloneNode(true);
    const root = fragment.querySelector('.message');
    const sender = fragment.querySelector('.message-sender');
    const time = fragment.querySelector('.message-time');
    const status = fragment.querySelector('.message-state');
    const body = fragment.querySelector('.message-body');

    sender.textContent = message.sender || 'desconocido';
    time.textContent = formatDate(message.timestamp || new Date().toISOString());
    status.textContent = buildStatusLabel(message);
    root.classList.toggle('pending', message.status === 'pending');
    root.classList.toggle('error', message.status === 'error');

    if (message.type === 'image') {
      const loading = document.createElement('p');
      loading.textContent = message.status === 'pending' ? 'Imagen pendiente...' : 'Cargando imagen...';
      body.appendChild(loading);
      renderImageMessage(message, body, loading);
    } else {
      const text = document.createElement('p');
      text.textContent = message.content || '';
      body.appendChild(text);
    }

    elements.chatLog.appendChild(fragment);
  }
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
}

function buildStatusLabel(message) {
  if (message.type === 'image' && message.status === 'pending') {
    return `pendiente ${message.chunks_sent || 0}/${message.chunks_total || 0}`;
  }
  if (message.status === 'resumed') {
    return 'reanudado';
  }
  if (message.status === 'sent') {
    return 'enviado';
  }
  if (message.status === 'error') {
    return 'error';
  }
  return 'pendiente';
}

async function renderImageMessage(message, container, loadingNode) {
  try {
    let src = message.previewUrl || '';
    if (!src && message.content) {
      src = await resolveImageSource(message.content);
    }
    if (!src) {
      loadingNode.textContent = 'Imagen en cola';
      return;
    }
    const image = document.createElement('img');
    image.alt = `Imagen de ${message.sender || 'usuario'}`;
    image.src = src;
    image.loading = 'lazy';
    image.addEventListener('click', () => {
      window.open(src, '_blank', 'noopener');
    });
    loadingNode.replaceWith(image);
  } catch (error) {
    loadingNode.textContent = 'No se pudo reconstruir la imagen';
    console.error(error);
  }
}

async function resolveImageSource(content) {
  if (imageCache.has(content)) {
    return imageCache.get(content);
  }
  if (content.startsWith('data:') || /\.(png|jpg|jpeg|gif|webp)$/i.test(content)) {
    imageCache.set(content, content);
    return content;
  }
  const manifest = await fetchJsonWithAuth(content);
  const buffers = [];
  for (let index = 0; index < manifest.chunks.length; index += 1) {
    const partUrl = publicStorageUrl(manifest.chunks[index].path);
    const response = await fetch(partUrl, { cache: 'force-cache' });
    if (!response.ok) {
      throw new Error('No se pudo leer un bloque de imagen');
    }
    const arrayBuffer = await response.arrayBuffer();
    const actualHash = await sha256Hex(arrayBuffer);
    if (actualHash !== manifest.chunks[index].sha256) {
      throw new Error('Integridad de bloque invalida');
    }
    buffers.push(arrayBuffer);
  }
  const merged = mergeArrayBuffers(buffers);
  const blob = new Blob([merged], { type: manifest.contentType || 'image/jpeg' });
  const objectUrl = URL.createObjectURL(blob);
  imageCache.set(content, objectUrl);
  await dbPut(CACHE_STORE, { id: content, blob });
  return objectUrl;
}

function mergeArrayBuffers(buffers) {
  const total = buffers.reduce((sum, item) => sum + item.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const buffer of buffers) {
    merged.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  }
  return merged.buffer;
}

async function enqueueTextMessage(text) {
  const message = {
    local_id: createId('msg'),
    sender: state.config.senderId,
    type: 'text',
    content: text,
    timestamp: new Date().toISOString(),
    status: state.online && isConfigured() ? 'pending' : 'pending',
    chunks_total: 0,
    chunks_sent: 0,
    session_id: state.config.sessionId
  };
  upsertMessage(message);
  state.queuedTexts.push(message);
  persistQueuedTexts();
  updateQueueSize();
  setComposerHint(state.online ? 'Enviando texto...' : 'Sin conexion. El texto quedo guardado localmente.');
  flushQueues();
}

async function enqueueImageMessage(file) {
  if (!isConfigured()) {
    setComposerHint('Configura Supabase antes de enviar imagenes.');
    return;
  }
  const targetKb = getTargetImageKb();
  setComposerHint(`Comprimiendo imagen a menos de ${targetKb} KB...`);
  const compressed = await compressImage(file, targetKb, getMaxDimensionForMode());
  const localId = createId('img');
  const previewUrl = URL.createObjectURL(compressed);
  const chunks = await buildChunkManifest(compressed, localId);
  const message = {
    local_id: localId,
    sender: state.config.senderId,
    type: 'image',
    content: '',
    timestamp: new Date().toISOString(),
    status: 'pending',
    chunks_total: chunks.length,
    chunks_sent: 0,
    session_id: state.config.sessionId,
    previewUrl
  };
  upsertMessage(message);

  const uploadJob = {
    id: localId,
    fileName: file.name,
    contentType: compressed.type || 'image/jpeg',
    size: compressed.size,
    createdAt: message.timestamp,
    sessionId: state.config.sessionId,
    sender: state.config.senderId,
    uploadedIndices: [],
    chunks,
    remoteInserted: false,
    previewUrl,
    resumed: false
  };

  await dbPut(UPLOAD_STORE, uploadJob);
  await insertPendingImageMessage(message, uploadJob);
  updateQueueSize();
  processUploadJob(uploadJob).catch((error) => {
    console.error(error);
    markMessageError(localId);
  });
}

async function insertPendingImageMessage(message, uploadJob) {
  if (!state.online) {
    return;
  }
  try {
    await insertMessageRemote(message);
    uploadJob.remoteInserted = true;
    await dbPut(UPLOAD_STORE, uploadJob);
  } catch (error) {
    console.error(error);
  }
}

async function buildChunkManifest(blob, localId) {
  const chunks = [];
  for (let offset = 0, index = 0; offset < blob.size; offset += CHUNK_SIZE, index += 1) {
    const part = blob.slice(offset, offset + CHUNK_SIZE, blob.type);
    const buffer = await part.arrayBuffer();
    const sha256 = await sha256Hex(buffer);
    chunks.push({
      index,
      blob: part,
      size: part.size,
      sha256,
      path: `chunks/${state.config.sessionId}/${localId}/${String(index).padStart(6, '0')}.part`
    });
  }
  return chunks;
}

async function processUploadJob(job) {
  if (!state.online || !isConfigured()) {
    return;
  }
  let liveJob = await dbGet(UPLOAD_STORE, job.id);
  if (!liveJob) {
    return;
  }
  for (const chunk of liveJob.chunks) {
    if (!state.online) {
      return;
    }
    if (liveJob.uploadedIndices.includes(chunk.index)) {
      continue;
    }
    const currentBuffer = await chunk.blob.arrayBuffer();
    const currentHash = await sha256Hex(currentBuffer);
    if (currentHash !== chunk.sha256) {
      throw new Error('Bloque corrupto antes de subir');
    }
    await uploadFileToStorage(chunk.path, chunk.blob, `chunk-${chunk.index}.part`);
    liveJob.uploadedIndices.push(chunk.index);
    liveJob.resumed = liveJob.uploadedIndices.length > 1;
    await dbPut(UPLOAD_STORE, liveJob);
    await patchImageProgress(liveJob);
  }

  const manifest = {
    version: 1,
    type: 'chunked-image',
    sessionId: liveJob.sessionId,
    sender: liveJob.sender,
    localId: liveJob.id,
    createdAt: liveJob.createdAt,
    contentType: liveJob.contentType,
    size: liveJob.size,
    chunks: liveJob.chunks.map((chunk) => ({
      index: chunk.index,
      path: chunk.path,
      size: chunk.size,
      sha256: chunk.sha256
    }))
  };

  const manifestPath = `manifests/${liveJob.sessionId}/${liveJob.id}.json`;
  const manifestBlob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  await uploadFileToStorage(manifestPath, manifestBlob, `${liveJob.id}.json`);

  const finalStatus = liveJob.resumed ? 'resumed' : 'sent';
  const manifestUrl = publicStorageUrl(manifestPath);
  await finalizeImageMessage(liveJob.id, manifestUrl, finalStatus, liveJob.chunks.length);
  await dbDelete(UPLOAD_STORE, liveJob.id);
  updateQueueSize();
  setComposerHint('Imagen enviada.');
}

async function patchImageProgress(job) {
  const sent = job.uploadedIndices.length;
  const localMessage = state.messages.find((item) => item.local_id === job.id);
  if (localMessage) {
    upsertMessage({ ...localMessage, chunks_sent: sent, status: 'pending' });
  }
  try {
    await updateMessageRemote(job.id, {
      chunks_sent: sent,
      status: 'pending'
    });
  } catch (error) {
    console.error(error);
  }
}

async function finalizeImageMessage(localId, manifestUrl, status, totalChunks) {
  const localMessage = state.messages.find((item) => item.local_id === localId);
  if (localMessage) {
    upsertMessage({
      ...localMessage,
      content: manifestUrl,
      status,
      chunks_sent: totalChunks,
      chunks_total: totalChunks
    });
  }

  const payload = {
    sender: state.config.senderId,
    type: 'image',
    content: manifestUrl,
    timestamp: localMessage ? localMessage.timestamp : new Date().toISOString(),
    status,
    chunks_total: totalChunks,
    chunks_sent: totalChunks,
    session_id: state.config.sessionId,
    local_id: localId
  };

  try {
    await updateMessageRemote(localId, payload);
  } catch {
    await insertMessageRemote(payload);
  }
}

function markMessageError(localId) {
  const message = state.messages.find((item) => item.local_id === localId);
  if (message) {
    upsertMessage({ ...message, status: 'error' });
  }
}

async function flushQueues() {
  if (!state.online || !isConfigured()) {
    updateQueueSize();
    return;
  }

  while (state.queuedTexts.length > 0) {
    const message = state.queuedTexts[0];
    try {
      await insertMessageRemote({
        sender: message.sender,
        type: message.type,
        content: message.content,
        timestamp: message.timestamp,
        status: 'sent',
        chunks_total: 0,
        chunks_sent: 0,
        session_id: message.session_id,
        local_id: message.local_id
      });
      upsertMessage({ ...message, status: 'sent' });
      state.queuedTexts.shift();
      persistQueuedTexts();
      updateQueueSize();
    } catch (error) {
      console.error(error);
      setComposerHint('No se pudo enviar la cola. Revisa las politicas de Supabase.');
      break;
    }
  }

  const jobs = await dbGetAll(UPLOAD_STORE);
  for (const job of jobs) {
    if (!state.online) {
      break;
    }
    processUploadJob(job).catch((error) => {
      console.error(error);
      markMessageError(job.id);
    });
  }
  updateQueueSize();
}

async function refreshHistory() {
  if (!isConfigured()) {
    return;
  }
  try {
    const remoteMessages = await fetchMessagesRemote();
    for (const message of remoteMessages) {
      if (message.id) {
        state.knownRemoteIds.add(message.id);
      }
      upsertMessage(message);
    }
    persistKnownRemoteIds();
    setComposerHint('Historial cargado.');
  } catch (error) {
    console.error(error);
    setComposerHint('No se pudo cargar el historial.');
  }
}

async function fetchMessagesRemote() {
  const filter = encodeURIComponent(`session_id=eq.${state.config.sessionId}`);
  const url = `${state.config.supabaseUrl}/rest/v1/messages?select=*&${filter}&order=timestamp.asc`;
  const response = await fetch(url, {
    headers: supabaseHeaders()
  });
  if (!response.ok) {
    throw new Error('Fallo al leer mensajes');
  }
  return response.json();
}

async function insertMessageRemote(message) {
  const response = await fetch(`${state.config.supabaseUrl}/rest/v1/messages`, {
    method: 'POST',
    headers: {
      ...supabaseHeaders(),
      Prefer: 'return=representation'
    },
    body: JSON.stringify([message])
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const rows = await response.json();
  if (rows[0] && rows[0].id) {
    state.knownRemoteIds.add(rows[0].id);
    persistKnownRemoteIds();
    upsertMessage(rows[0]);
  }
}

async function updateMessageRemote(localId, patch) {
  const url = `${state.config.supabaseUrl}/rest/v1/messages?local_id=eq.${encodeURIComponent(localId)}&session_id=eq.${encodeURIComponent(state.config.sessionId)}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      ...supabaseHeaders(),
      Prefer: 'return=representation'
    },
    body: JSON.stringify(patch)
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const rows = await response.json();
  if (rows[0]) {
    upsertMessage(rows[0]);
  }
}

async function uploadFileToStorage(path, blob, fileName) {
  const form = new FormData();
  form.append('file', blob, fileName);
  const response = await fetch(`${state.config.supabaseUrl}/storage/v1/object/${state.config.bucketName}/${path}`, {
    method: 'POST',
    headers: {
      apikey: state.config.supabaseKey,
      Authorization: `Bearer ${state.config.supabaseKey}`,
      'x-upsert': 'true'
    },
    body: form
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

function publicStorageUrl(path) {
  return `${state.config.supabaseUrl}/storage/v1/object/public/${state.config.bucketName}/${path}`;
}

function supabaseHeaders() {
  return {
    apikey: state.config.supabaseKey,
    Authorization: `Bearer ${state.config.supabaseKey}`,
    'Content-Type': 'application/json'
  };
}

async function fetchJsonWithAuth(url) {
  const response = await fetch(url, {
    headers: {
      apikey: state.config.supabaseKey,
      Authorization: `Bearer ${state.config.supabaseKey}`
    }
  });
  if (!response.ok) {
    throw new Error('No se pudo leer el manifiesto');
  }
  return response.json();
}

function connectRealtime() {
  if (!isConfigured()) {
    return;
  }
  disconnectRealtime();
  const wsUrl = state.config.supabaseUrl.replace(/^http/i, 'ws') + `/realtime/v1/websocket?apikey=${encodeURIComponent(state.config.supabaseKey)}&vsn=1.0.0`;
  const socket = new WebSocket(wsUrl);
  state.realtimeSocket = socket;

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({
      topic: 'realtime:public:messages',
      event: 'phx_join',
      payload: {
        config: {
          broadcast: { self: false },
          postgres_changes: [
            {
              event: '*',
              schema: 'public',
              table: 'messages',
              filter: `session_id=eq.${state.config.sessionId}`
            }
          ]
        }
      },
      ref: '1'
    }));
    state.heartbeatTimer = window.setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(Date.now()) }));
      }
    }, HEARTBEAT_MS);
  });

  socket.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.event === 'postgres_changes' && data.payload && data.payload.data && data.payload.data.record) {
        const record = data.payload.data.record;
        if (record.session_id !== state.config.sessionId) {
          return;
        }
        if (record.id) {
          state.knownRemoteIds.add(record.id);
          persistKnownRemoteIds();
        }
        upsertMessage(record);
      }
    } catch (error) {
      console.error(error);
    }
  });

  socket.addEventListener('close', () => {
    clearRealtimeTimers();
    if (state.online && isConfigured()) {
      window.setTimeout(connectRealtime, 3000);
    }
  });

  socket.addEventListener('error', () => {
    clearRealtimeTimers();
  });
}

function disconnectRealtime() {
  clearRealtimeTimers();
  if (state.realtimeSocket) {
    state.realtimeSocket.close();
    state.realtimeSocket = null;
  }
}

function clearRealtimeTimers() {
  if (state.heartbeatTimer) {
    window.clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }
}

function startConnectionMonitoring() {
  if (state.resumeTimer) {
    window.clearInterval(state.resumeTimer);
  }
  state.resumeTimer = window.setInterval(async () => {
    await probeConnection();
    if (state.online) {
      flushQueues();
    }
  }, 20000);
}

async function probeConnection() {
  const sample = {
    ok: navigator.onLine,
    latency: 0,
    kbps: 0
  };

  if (navigator.onLine && isConfigured()) {
    const started = performance.now();
    try {
      const response = await fetch(`${state.config.supabaseUrl}/rest/v1/messages?select=id&limit=1`, {
        headers: supabaseHeaders(),
        cache: 'no-store'
      });
      const text = await response.text();
      const elapsed = Math.max(1, performance.now() - started);
      sample.ok = response.ok;
      sample.latency = elapsed;
      sample.kbps = Math.round(((text.length || 32) * 8) / elapsed);
    } catch {
      sample.ok = false;
      sample.latency = 2500;
      sample.kbps = 0;
    }
  }

  if (navigator.connection && typeof navigator.connection.downlink === 'number') {
    sample.kbps = Math.max(sample.kbps, Math.round(navigator.connection.downlink * 1000));
  }

  state.probeSamples.push(sample);
  if (state.probeSamples.length > PROBE_HISTORY) {
    state.probeSamples.shift();
  }

  const okSamples = state.probeSamples.filter((item) => item.ok);
  const failedSamples = state.probeSamples.length - okSamples.length;
  state.online = sample.ok;
  state.latency = okSamples.length ? Math.round(okSamples.reduce((sum, item) => sum + item.latency, 0) / okSamples.length) : 0;
  state.kbps = okSamples.length ? Math.round(okSamples.reduce((sum, item) => sum + item.kbps, 0) / okSamples.length) : 0;
  state.stability = state.probeSamples.length ? okSamples.length / state.probeSamples.length : 0;
  state.loss = state.probeSamples.length ? failedSamples / state.probeSamples.length : 0;
  state.mode = selectConnectionMode();
  updateConnectionUi();
}

function selectConnectionMode() {
  if (!isConfigured()) {
    return 'Sin configurar';
  }
  if (!state.online || state.kbps < 150 || state.latency > 1400 || state.stability < 0.7 || state.loss > 0.25) {
    return 'Ultra-ligero';
  }
  if (state.kbps < 800 || state.latency > 500 || state.stability < 0.9 || state.loss > 0.1) {
    return 'Inteligente';
  }
  return 'Turbo';
}

function updateConnectionUi() {
  elements.connectionMode.textContent = state.mode;
  elements.connectionSpeed.textContent = state.kbps ? `${state.kbps} kbps` : state.online ? 'Midiendo' : 'Offline';
  elements.connectionLatency.textContent = state.latency ? `${state.latency} ms` : '-';
  elements.connectionStability.textContent = `${Math.round(state.stability * 100)}%`;
  elements.connectionLoss.textContent = `${Math.round(state.loss * 100)}%`;
  updateQueueSize();
}

async function restoreUploadJobs() {
  const jobs = await dbGetAll(UPLOAD_STORE);
  for (const job of jobs) {
    const existing = state.messages.find((item) => item.local_id === job.id);
    if (!existing) {
      upsertMessage({
        local_id: job.id,
        sender: job.sender,
        type: 'image',
        content: '',
        timestamp: job.createdAt,
        status: 'pending',
        chunks_total: job.chunks.length,
        chunks_sent: job.uploadedIndices.length,
        session_id: job.sessionId,
        previewUrl: job.previewUrl || ''
      });
    }
  }
}

function updateQueueSize() {
  dbGetAll(UPLOAD_STORE).then((jobs) => {
    elements.queueSize.textContent = String(state.queuedTexts.length + jobs.length);
  }).catch(() => {
    elements.queueSize.textContent = String(state.queuedTexts.length);
  });
}

function getTargetImageKb() {
  if (state.mode === 'Ultra-ligero') {
    return 50;
  }
  if (state.mode === 'Inteligente') {
    return 80;
  }
  return 150;
}

function getMaxDimensionForMode() {
  if (state.mode === 'Ultra-ligero') {
    return 960;
  }
  if (state.mode === 'Inteligente') {
    return 1280;
  }
  return 1600;
}

async function compressImage(file, targetKb, maxDimension) {
  const bitmap = await createImageBitmap(file);
  let width = bitmap.width;
  let height = bitmap.height;
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  canvas.width = width;
  canvas.height = height;
  context.drawImage(bitmap, 0, 0, width, height);

  let quality = 0.82;
  let blob = await canvasToJpeg(canvas, quality);
  while (blob.size > targetKb * 1024 && quality > 0.28) {
    quality -= 0.08;
    blob = await canvasToJpeg(canvas, quality);
  }

  while (blob.size > targetKb * 1024 && Math.max(canvas.width, canvas.height) > 320) {
    canvas.width = Math.max(320, Math.round(canvas.width * 0.85));
    canvas.height = Math.max(320, Math.round(canvas.height * 0.85));
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    quality = Math.max(0.22, quality - 0.06);
    blob = await canvasToJpeg(canvas, quality);
  }

  bitmap.close();
  return blob;
}

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('No se pudo comprimir la imagen'));
      }
    }, 'image/jpeg', quality);
  });
}

async function sha256Hex(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash)).map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function exportHistory() {
  if (!isConfigured()) {
    setComposerHint('Configura Supabase antes de exportar.');
    return;
  }
  const transcript = buildTranscript();
  if (!state.online) {
    downloadTextFile(transcript, `${state.config.sessionId}-historial.txt`, 'text/plain');
    setComposerHint('Sin conexion. Se descargo el historial en TXT local.');
    return;
  }
  const url = `${state.config.supabaseUrl}/functions/v1/${state.config.exportEndpoint}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify({
        sender: state.config.senderId,
        session_id: state.config.sessionId,
        email: state.config.exportEmail,
        transcript
      })
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    setComposerHint('Solicitud de exportacion enviada a la funcion exportHistory.');
  } catch (error) {
    console.error(error);
    downloadTextFile(transcript, `${state.config.sessionId}-historial.txt`, 'text/plain');
    setComposerHint('La funcion exportHistory no respondio. Se descargo el TXT local como respaldo.');
  }
}

function buildTranscript() {
  return state.messages.map((message) => {
    const header = `[${formatDate(message.timestamp)}] ${message.sender} ${message.type}`;
    const body = message.type === 'image' ? message.content || 'imagen-pendiente' : message.content;
    return `${header}\n${body}\n`;
  }).join('\n');
}

function downloadTranscript() {
  downloadTextFile(buildTranscript(), `${state.config.sessionId}-historial.txt`, 'text/plain');
}

function downloadTextFile(content, fileName, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function buildSetupRequirements() {
  const sessionId = state.config.sessionId || 'sala-principal';
  return [
    'Proyecto detectado por la anon key:',
    'ref: kxhgjamftlniaspagfjo',
    'URL esperada: https://kxhgjamftlniaspagfjo.supabase.co',
    '',
    '1. Tabla messages',
    '',
    'create extension if not exists pgcrypto;',
    '',
    'create table if not exists public.messages (',
    '  id uuid primary key default gen_random_uuid(),',
    '  sender text not null,',
    "  type text not null check (type in ('text','image','audio')),",
    "  content text not null default '',",
    '  timestamp timestamptz not null default now(),',
    "  status text not null default 'pending' check (status in ('sent','pending','resumed')),",
    '  chunks_total integer not null default 0,',
    '  chunks_sent integer not null default 0,',
    '  session_id text not null,',
    '  local_id text not null',
    ');',
    '',
    'alter publication supabase_realtime add table public.messages;',
    '',
    'create index if not exists messages_session_time_idx on public.messages (session_id, timestamp);',
    'create unique index if not exists messages_session_local_idx on public.messages (session_id, local_id);',
    '',
    '2. Bucket publico chat-files',
    '',
    'insert into storage.buckets (id, name, public)',
    "values ('chat-files', 'chat-files', true)",
    'on conflict (id) do update set public = true;',
    '',
    '3. Politicas minimas para cliente anon',
    '',
    'Necesitas permitir select, insert y update sobre public.messages.',
    'Necesitas permitir insert y select sobre storage.objects del bucket chat-files.',
    'Si quieres restringir por sala, usa session_id y sender en tus politicas RLS.',
    '',
    '4. Edge Function exportHistory',
    '',
    'Debe recibir sender o user id, session_id, email y transcript.',
    'Debe leer public.messages, descargar manifiestos e imagenes del bucket, generar TXT y ZIP, y enviar correo.',
    '',
    '5. Realtime',
    '',
    `La app escucha cambios de la sala ${sessionId} en public.messages.`,
    '',
    '6. Nota tecnica',
    '',
    'La app usa subida por bloques de 5 KB hacia Storage y guarda un manifiesto JSON para reanudar y reconstruir imagenes con verificacion SHA-256.'
  ].join('\n');
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(UPLOAD_STORE)) {
        db.createObjectStore(UPLOAD_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbStore(storeName, mode) {
  return state.db.transaction(storeName, mode).objectStore(storeName);
}

function dbPut(storeName, value) {
  return new Promise((resolve, reject) => {
    if (!state.db) {
      resolve();
      return;
    }
    const request = dbStore(storeName, 'readwrite').put(value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbGet(storeName, key) {
  return new Promise((resolve, reject) => {
    if (!state.db) {
      resolve(null);
      return;
    }
    const request = dbStore(storeName, 'readonly').get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

function dbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    if (!state.db) {
      resolve([]);
      return;
    }
    const request = dbStore(storeName, 'readonly').getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function dbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    if (!state.db) {
      resolve();
      return;
    }
    const request = dbStore(storeName, 'readwrite').delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function normalizeOutgoingText(text) {
  return text.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function applyTypingCorrections(input) {
  const cursor = input.selectionStart ?? input.value.length;
  const updated = correctLastWordIfNeeded(input.value, cursor);
  if (!updated.changed) {
    return;
  }
  input.value = updated.text;
  if (typeof input.setSelectionRange === 'function') {
    input.setSelectionRange(updated.cursor, updated.cursor);
  }
}

function correctLastWordIfNeeded(text, cursor) {
  const before = text.slice(0, cursor);
  const after = text.slice(cursor);

  if (!/\s$/.test(before)) {
    return { changed: false, text, cursor };
  }

  const match = before.match(/([A-Za-zÁÉÍÓÚáéíóúÑñ]+)\s$/);
  if (!match) {
    return { changed: false, text, cursor };
  }

  const originalWord = match[1];
  const fixedWord = fixWord(originalWord);
  if (!fixedWord || fixedWord === originalWord) {
    return { changed: false, text, cursor };
  }

  const fixedBefore = `${before.slice(0, before.length - originalWord.length - 1)}${fixedWord} `;
  const fixedText = fixedBefore + after;
  const newCursor = fixedBefore.length;

  return { changed: true, text: fixedText, cursor: newCursor };
}

function fixWord(word) {
  const lookup = COMMON_TYPO_FIXES[word.toLowerCase()];
  if (!lookup) {
    return word;
  }
  if (word === word.toUpperCase()) {
    return lookup.toUpperCase();
  }
  if (word[0] === word[0].toUpperCase()) {
    return lookup[0].toUpperCase() + lookup.slice(1);
  }
  return lookup;
}
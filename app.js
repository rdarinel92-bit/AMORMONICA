const STORAGE_KEYS = {
  config: 'chat-lite-config',
  queuedTexts: 'chat-lite-queued-texts',
  localMessages: 'chat-lite-local-messages',
  knownRemoteIds: 'chat-lite-known-remote-ids',
  configLocked: 'chat-lite-config-locked',
  identity: 'chat-lite-identity',
  deviceId: 'chat-lite-device-id',
  identityByDevice: 'chat-lite-identity-by-device',
  autoSavedImages: 'chat-lite-auto-saved-images',
  forceImages: 'chat-lite-force-images',
  dataSaver: 'chat-lite-data-saver',
  haptics: 'chat-lite-haptics',
  profileHaptics: 'chat-lite-profile-haptics',
  notificationMode: 'chat-lite-notification-mode',
  profileNotificationMode: 'chat-lite-profile-notification-mode',
  profileSystemNotifications: 'chat-lite-profile-system-notifications',
  installAudit: 'chat-lite-install-audit',
  e2eeUnlockUntil: 'chat-lite-e2ee-unlock-until',
  profilePhoto: 'chat-lite-profile-photo',
  identityEntryMessage: 'chat-lite-identity-entry-message',
  appVersion: 'chat-lite-app-version',
  emojiRecent: 'chat-lite-emoji-recent'
};
const APP_VERSION = '2026-08-08-v49';

const DB_NAME = 'chat-lite-db';
const DB_VERSION = 1;
const UPLOAD_STORE = 'uploads';
const CACHE_STORE = 'cache';
const CHUNK_SIZE = 5 * 1024;
const HEARTBEAT_MS = 25000;
const PROBE_HISTORY = 8;
const IMAGE_UPLOAD_MAX_RETRIES = 0;
const IMAGE_UPLOAD_RETRY_BASE_MS = 1500;
const IMAGE_UPLOAD_RETRY_MAX_MS = 60000;
const IMAGE_DRAFT_PREVIEW_ENABLED = false;
const VOICE_MAX_SECONDS = 120;
const VOICE_MIN_BYTES = 400;
const VOICE_BITRATE_KBPS_LOW = 16;
const VOICE_BITRATE_KBPS_MEDIUM = 24;
const VOICE_BITRATE_KBPS_HIGH = 32;
const BOOT_PROBE_TIMEOUT_MS = 8000;
const BOOT_HISTORY_TIMEOUT_MS = 12000;
const HISTORY_FETCH_TIMEOUT_MS = 10000;
const PROBE_FETCH_TIMEOUT_MS = 7000;
const RESET_FUNCTION_TIMEOUT_MS = 25000;
const HISTORY_PAGE_SIZE = 80;
const IDENTITY_ENTRY_STEPS = [
  { pct: 24, text: 'Conectando corazones...' },
  { pct: 52, text: 'Preparando la sala para ustedes...' },
  { pct: 78, text: 'Casi lista, mi amor...' },
  { pct: 100, text: 'Bienvenida, disfruta cada segundo.' }
];
const ENC_PREFIX = 'enc:v1:';
const DAILY_UNLOCK_MS = 24 * 60 * 60 * 1000;
const imageCache = new Map();
let deferredInstallPrompt = null;
let serviceWorkerReloaded = false;
let keyboardViewportRaf = 0;
let renderRaf = 0;
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
  senderId: '',
  bucketName: 'chat-files',
  exportEndpoint: 'exportHistory',
  resetEndpoint: 'resetRoomAdmin',
  resetAdminSecret: '',
  exportEmail: '',
  e2eePassphrase: ''
};

const state = {
  config: { ...defaultConfig, ...loadJson(STORAGE_KEYS.config, {}) },
  unreadCount: 0,
  configLocked: loadJson(STORAGE_KEYS.configLocked, true),
  identity: loadJson(STORAGE_KEYS.identity, ''),
  mode: 'Sin configurar',
  kbps: 0,
  latency: 0,
  stability: 0,
  loss: 0,
  online: navigator.onLine,
  messages: [],
  queuedTexts: [],
  knownRemoteIds: new Set(),
  probeSamples: [],
  db: null,
  realtimeSocket: null,
  heartbeatTimer: null,
  resumeTimer: null,
  imageRetryTimers: new Map(),
  uploadRetryTimers: new Map(),
  canceledUploadIds: new Set(),
  imageDraftQueue: [],
  activeUploadLocalId: '',
  uploadPumpRunning: false,
  autoSavedImages: new Set(),
  forceImages: loadJson(STORAGE_KEYS.forceImages, true),
  dataSaver: false,
  haptics: loadJson(STORAGE_KEYS.haptics, false),
  notificationMode: loadJson(STORAGE_KEYS.notificationMode, 'both'),
  systemNotificationsEnabled: false,
  installAudit: loadJson(STORAGE_KEYS.installAudit, {
    promptAvailable: false,
    lastChoice: '',
    lastChoiceAt: '',
    lastInstalledAt: ''
  }),
  e2eeUnlockUntil: loadJson(STORAGE_KEYS.e2eeUnlockUntil, 0),
  selectedMessageKey: '',
  e2eeKeyPromise: null,
  e2eeKeyFingerprint: '',
  lastSyncAt: null,
  pendingUploadsCount: 0,
  initialized: false,
  historyOldestTimestamp: null,
  historyHasMore: true,
  deviceId: localStorage.getItem(STORAGE_KEYS.deviceId) || '',
  identityByDevice: loadJson(STORAGE_KEYS.identityByDevice, {}),
  pendingUrlIdentity: '',
  imageDraft: null,
  imageDraftFile: null,
  profileMenuOpen: false,
  emojiPanelOpen: false,
  emojiPanelManuallyClosed: false,
  emojiCategory: 'recientes',
  emojiRecent: [],
  voiceRecorder: null,
  voiceStream: null,
  voiceChunks: [],
  voiceStartedAt: 0,
  voiceStopTimer: null,
  // Typing indicators
  typingState: new Map(), // Map of sender -> timestamp
  typingDebounceTimer: null,
  myLastTypingAt: 0
};

const EMOJI_CATEGORIES = {
  recientes: {
    label: 'Recientes',
    emojis: () => state.emojiRecent.length > 0 ? state.emojiRecent : ['😀', '👍', '❤️']
  },
  caras: {
    label: 'Caras',
    emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '🙂', '😉', '😍', '😘', '😎', '🤔', '😴', '🤯', '😭']
  },
  manos: {
    label: 'Manos',
    emojis: ['👍', '👎', '👌', '🤝', '👏', '🙏', '💪', '🫶', '✋', '👋', '🤟', '🖐️', '🤘', '👉', '👈']
  },
  objetos: {
    label: 'Objetos',
    emojis: ['💬', '📷', '⚙️', '🛠️', '🔧', '🧰', '💡', '🔋', '📌', '📝', '🧠', '💻', '📦', '🔒', '🔔']
  },
  viajes: {
    label: 'Viajes',
    emojis: ['🚗', '🏍️', '🛻', '🚌', '🚚', '🚀', '🛣️', '⛽', '🧭', '🗺️', '🛞', '🛠️', '🏁', '📍', '🚦']
  },
  clima: {
    label: 'Clima',
    emojis: ['☀️', '⛅', '🌤️', '🌧️', '⛈️', '🌪️', '❄️', '🔥', '🌙', '⭐', '✨', '💧', '🌈', '🌫️']
  }
};

const elements = {
  netFab: document.getElementById('net-fab'),
  netFabMode: document.getElementById('net-fab-mode'),
  netPanel: document.getElementById('net-panel'),
  syncNow: document.getElementById('sync-now'),
  hardRefresh: document.getElementById('hard-refresh'),
  haptics: document.getElementById('haptics'),
  installApp: document.getElementById('install-app'),
  shareChat: document.getElementById('share-chat'),
  netUser: document.getElementById('net-user'),
  netRoom: document.getElementById('net-room'),
  netLastSync: document.getElementById('net-last-sync'),
  netPending: document.getElementById('net-pending'),
  activeUser: document.getElementById('active-user'),
  identityGate: document.getElementById('identity-gate'),
  identityRoberto: document.getElementById('identity-roberto'),
  identityMonica: document.getElementById('identity-monica'),
  identityRobertoAvatar: document.getElementById('identity-roberto-avatar'),
  identityRobertoFallback: document.getElementById('identity-roberto-fallback'),
  identityMonicaAvatar: document.getElementById('identity-monica-avatar'),
  identityMonicaFallback: document.getElementById('identity-monica-fallback'),
  identityEntryProgress: document.getElementById('identity-entry-progress'),
  identityEntryMessage: document.getElementById('identity-entry-message'),
  identityProgressFill: document.getElementById('identity-progress-fill'),
  identityEntryCustomMessage: document.getElementById('identity-entry-custom-message'),
  identityCustom: document.getElementById('identity-custom'),
  identityCustomSubmit: document.getElementById('identity-custom-submit'),
  toggleSetup: document.getElementById('toggle-setup'),
  setupPanel: document.getElementById('setup-panel'),
  configForm: document.getElementById('config-form'),
  saveConfig: document.getElementById('save-config'),
  toggleConfigLock: document.getElementById('toggle-config-lock'),
  e2eePassphrase: document.getElementById('e2ee-passphrase'),
  supabaseUrl: document.getElementById('supabase-url'),
  supabaseKey: document.getElementById('supabase-key'),
  sessionId: document.getElementById('session-id'),
  senderId: document.getElementById('sender-id'),
  bucketName: document.getElementById('bucket-name'),
  exportEndpoint: document.getElementById('export-endpoint'),
  resetEndpoint: document.getElementById('reset-endpoint'),
  resetAdminSecret: document.getElementById('reset-admin-secret'),
  exportEmail: document.getElementById('export-email'),
  reloadHistory: document.getElementById('reload-history'),
  resetRoom: document.getElementById('reset-room'),
  exportHistory: document.getElementById('export-history'),
  downloadTranscript: document.getElementById('download-transcript'),
  setupRequirements: document.getElementById('setup-requirements'),
  chatLog: document.getElementById('chat-log'),
  messageTemplate: document.getElementById('message-template'),
  messageForm: document.getElementById('message-form'),
  messageInput: document.getElementById('message-input'),
  imageInput: document.getElementById('image-input'),
  cameraInput: document.getElementById('camera-input'),
  openCamera: document.getElementById('open-camera'),
  sendLocation: document.getElementById('send-location'),
  connectionMode: document.getElementById('connection-mode'),
  connectionSpeed: document.getElementById('connection-speed'),
  connectionLatency: document.getElementById('connection-latency'),
  connectionStability: document.getElementById('connection-stability'),
  connectionLoss: document.getElementById('connection-loss'),
  queueSize: document.getElementById('queue-size'),
  composerHint: document.getElementById('composer-hint'),
  imageDraftPanel: document.getElementById('image-draft-panel'),
  draftImagePreview: document.getElementById('draft-image-preview'),
  draftSize: document.getElementById('draft-size'),
  draftResolution: document.getElementById('draft-resolution'),
  draftMode: document.getElementById('draft-mode'),
  draftEstimate: document.getElementById('draft-estimate'),
  draftSendButton: document.getElementById('draft-send'),
  draftQueueCount: document.getElementById('draft-queue-count'),
  draftChangeButton: document.getElementById('draft-change'),
  draftDiscardButton: document.getElementById('draft-discard'),
  profilePhotoInput: document.getElementById('profile-photo-input'),
  profileTriggerFloating: document.getElementById('profile-trigger-floating'),
  profileTriggerTopbar: document.getElementById('profile-trigger-topbar'),
  profileMenu: document.getElementById('profile-menu'),
  profileOpenSettings: document.getElementById('profile-open-settings'),
  profileOpenAdvanced: document.getElementById('profile-open-advanced'),
  profileSwitchUser: document.getElementById('profile-switch-user'),
  profileChangePhoto: document.getElementById('profile-change-photo'),
  profileClearPhoto: document.getElementById('profile-clear-photo'),
  profileSettingsPanel: document.getElementById('profile-settings-panel'),
  profileSettingsForm: document.getElementById('profile-settings-form'),
  profileSettingsClose: document.getElementById('profile-settings-close'),
  profileSettingsName: document.getElementById('profile-settings-name'),
  profileSettingsEntryMessage: document.getElementById('profile-settings-entry-message'),
  profileSettingsHaptics: document.getElementById('profile-settings-haptics'),
  profileSettingsNotificationMode: document.getElementById('profile-settings-notification-mode'),
  profileSettingsSystemNotifications: document.getElementById('profile-settings-system-notifications'),
  profileSettingsAllowNotifications: document.getElementById('profile-settings-allow-notifications'),
  profileSettingsNotificationStatus: document.getElementById('profile-settings-notification-status'),
  profileSettingsRefreshInstall: document.getElementById('profile-settings-refresh-install'),
  profileSettingsInstallStatus: document.getElementById('profile-settings-install-status'),
  identityInstallApp: document.getElementById('identity-install-app'),
  identityInstallStatus: document.getElementById('identity-install-status'),
  profileAvatarImg: document.getElementById('profile-avatar-img'),
  profileAvatarFallback: document.getElementById('profile-avatar-fallback'),
  profileAvatarImgTopbar: document.getElementById('profile-avatar-img-topbar'),
  profileAvatarFallbackTopbar: document.getElementById('profile-avatar-fallback-topbar'),
  emojiPanel: document.getElementById('emoji-panel'),
  emojiCategories: document.getElementById('emoji-categories'),
  emojiRecentGrid: document.getElementById('emoji-recent-grid'),
  emojiGrid: document.getElementById('emoji-grid'),
  emojiToggle: document.getElementById('emoji-toggle'),
  emojiPanelClose: document.getElementById('emoji-panel-close'),
  voiceRecord: document.getElementById('voice-record'),
  loadMoreHistory: document.getElementById('load-more-history'),
  typingStatusIndicator: document.getElementById('typing-status-indicator'),
  messageQuickMenu: document.getElementById('message-quick-menu'),
  messageQuickCopy: document.getElementById('message-quick-copy'),
  messageQuickCopyLocation: document.getElementById('message-quick-copy-location'),
  messageQuickCopyMedia: document.getElementById('message-quick-copy-media'),
  messageQuickEdit: document.getElementById('message-quick-edit'),
  messageQuickDelete: document.getElementById('message-quick-delete'),
  messageQuickClose: document.getElementById('message-quick-close')
};

boot().catch((error) => {
  console.error(error);
  setComposerHint('Fallo al iniciar la aplicacion. Revisa la consola del navegador.');
});

async function boot() {
  bindUi();
  setupKeyboardViewportHandling();
  await enforceAppVersion();
  ensureDeviceId();
  applyUrlContext();
  renderEmojiPanel();
  loadProfilePhoto();
  updateVoiceRecordButton();
  if (elements.voiceRecord && !canUseVoiceNotes()) {
    elements.voiceRecord.disabled = true;
    elements.voiceRecord.title = 'Grabación no soportada en este navegador';
  }
  registerPwa();
  applyConfigToForm();
  setComposerLocked(true);

  try {
    await ensureIdentitySelected();
    updateIdentityEntryLoadingStatus('Preparando cifrado de mensajes...', 36);
    await ensureE2EEUnlocked(true);
    updateIdentityEntryLoadingStatus('Cargando datos locales...', 52);
    elements.setupRequirements.textContent = buildSetupRequirements();
    renderMessages();
    updateQueueSize();
    updateConnectionUi();
    state.db = await openDb();
    state.initialized = true;
    await restoreUploadJobs();
    updateIdentityEntryLoadingStatus('Midiendo conexión...', 68);
    startConnectionMonitoring();

    await runWithTimeout(() => probeConnection(), BOOT_PROBE_TIMEOUT_MS, 'probeConnection');

    if (isConfigured()) {
      updateIdentityEntryLoadingStatus('Sincronizando historial...', 84);
      await runWithTimeout(() => refreshHistory({ silent: true }), BOOT_HISTORY_TIMEOUT_MS, 'refreshHistory');
      connectRealtime();
      flushQueues();
      updateIdentityEntryLoadingStatus('Historial listo. Entrando...', 100);
    } else {
      updateIdentityEntryLoadingStatus('Configuración lista. Entrando...', 100);
    }
  } catch (error) {
    console.error(error);
    setComposerHint('Entrando con datos locales. Seguiremos sincronizando en segundo plano.');
  } finally {
    finalizeIdentityEntry();
    setComposerLocked(false);
  }
}

async function runWithTimeout(taskFactory, timeoutMs, label) {
  let timeoutId = null;
  try {
    return await Promise.race([
      Promise.resolve().then(() => taskFactory()),
      new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error(`Timeout en ${label}`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }
}

function scheduleKeyboardViewportUpdate() {
  if (keyboardViewportRaf) {
    window.cancelAnimationFrame(keyboardViewportRaf);
  }
  keyboardViewportRaf = window.requestAnimationFrame(() => {
    keyboardViewportRaf = 0;
    applyKeyboardViewportOffset();
  });
}

function isTypingTargetFocused() {
  const active = document.activeElement;
  if (!active) {
    return false;
  }
  if (active === elements.messageInput) {
    return true;
  }
  return Boolean(active instanceof HTMLElement && active.closest('.composer'));
}

function applyKeyboardViewportOffset() {
  const root = document.documentElement;
  const vv = window.visualViewport;
  if (!vv) {
    root.style.setProperty('--vk-offset', '0px');
    return;
  }

  const keyboardHeight = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  const isOpen = keyboardHeight > 70;
  const lift = isOpen && isTypingTargetFocused() ? Math.max(0, Math.round(keyboardHeight - 8)) : 0;
  root.style.setProperty('--vk-offset', `${lift}px`);
}

function setupKeyboardViewportHandling() {
  if (!window.visualViewport) {
    return;
  }
  const vv = window.visualViewport;
  vv.addEventListener('resize', scheduleKeyboardViewportUpdate);
  vv.addEventListener('scroll', scheduleKeyboardViewportUpdate);
  window.addEventListener('orientationchange', scheduleKeyboardViewportUpdate);
  window.addEventListener('resize', scheduleKeyboardViewportUpdate);
  scheduleKeyboardViewportUpdate();
}

function getShareUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set('session', state.config.sessionId || defaultConfig.sessionId);
  url.searchParams.set('sender', state.config.senderId || state.identity || defaultConfig.senderId || 'roberto');
  return url.toString();
}

function normalizeSessionId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function applyUrlContext() {
  const params = new URLSearchParams(window.location.search);
  const nextSessionId = normalizeSessionId(params.get('session') || params.get('session_id'));
  const nextSenderId = normalizeIdentity(params.get('sender') || params.get('user') || '');
  let changed = false;

  if (nextSessionId && nextSessionId !== state.config.sessionId) {
    state.config.sessionId = nextSessionId;
    changed = true;
  }

  if (nextSenderId) {
    state.pendingUrlIdentity = nextSenderId;
  } else {
    state.pendingUrlIdentity = '';
  }

  if (nextSenderId && nextSenderId !== normalizeIdentity(state.config.senderId || '')) {
    state.config.senderId = nextSenderId;
    state.identity = nextSenderId;
    changed = true;
  }

  if (changed) {
    saveJson(STORAGE_KEYS.config, state.config);
    saveJson(STORAGE_KEYS.identity, state.identity);
    if (elements.sessionId) {
      elements.sessionId.value = state.config.sessionId;
    }
    if (elements.senderId) {
      elements.senderId.value = state.config.senderId;
    }
  }
}

async function enforceAppVersion() {
  const previousVersion = localStorage.getItem(STORAGE_KEYS.appVersion);
  if (previousVersion === APP_VERSION) {
    return;
  }

  localStorage.setItem(STORAGE_KEYS.appVersion, APP_VERSION);

  // First run on a device should not trigger a forced reload.
  if (!previousVersion) {
    return;
  }

  const reloadGuard = `reloaded-${APP_VERSION}`;
  if (sessionStorage.getItem(reloadGuard) === '1') {
    return;
  }

  try {
    if (typeof caches !== 'undefined' && caches.keys) {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((key) => caches.delete(key)));
    }

    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.update()));
    }

    sessionStorage.setItem(reloadGuard, '1');
    window.location.reload();
  } catch (error) {
    console.error(error);
  }
}

function bindUi() {
  elements.netFab.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = !elements.netPanel.hidden;
    elements.netPanel.hidden = isOpen;
    elements.netFab.setAttribute('aria-expanded', String(!isOpen));
  });

  elements.netPanel.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  elements.syncNow.addEventListener('click', async () => {
    setComposerHint('Sincronizando ahora...');
    await probeConnection();
    await refreshHistory({ silent: true });
    await flushQueues();
    updateSyncSummary();
    setComposerHint('Sincronización manual completada.');
  });

  if (elements.shareChat) {
    elements.shareChat.addEventListener('click', async () => {
      const shareUrl = getShareUrl();
      const shareTitle = 'Chat privado ligero';
      const shareText = `Abrir mi chat en la sala ${state.config.sessionId || defaultConfig.sessionId}`;

      try {
        if (navigator.share) {
          await navigator.share({
            title: shareTitle,
            text: shareText,
            url: shareUrl
          });
          setComposerHint('Enlace compartido.');
          return;
        }

        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(shareUrl);
          setComposerHint('Enlace copiado al portapapeles.');
          return;
        }

        window.prompt('Copia este enlace para compartir el chat:', shareUrl);
        setComposerHint('Enlace listo para copiar.');
      } catch (error) {
        console.error(error);
        setComposerHint('No se pudo compartir el enlace.');
      }
    });
  }

  if (elements.loadMoreHistory) {
    elements.loadMoreHistory.addEventListener('click', async () => {
      if (!state.historyHasMore) {
        setComposerHint('No hay más mensajes anteriores.');
        return;
      }
      setComposerHint('Cargando mensajes anteriores...');
      await refreshHistory({ older: true });
      updateSyncSummary();
    });
  }

  if (elements.hardRefresh) {
    elements.hardRefresh.addEventListener('click', async () => {
      setComposerHint('Actualizando aplicación...');
      try {
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const registration of registrations) {
            await registration.update();
          }
        }

        if (typeof caches !== 'undefined' && caches.keys) {
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
        }

        setComposerHint('Cache limpiada. Recargando...');
        window.location.reload();
      } catch (error) {
        console.error(error);
        setComposerHint('No se pudo forzar la actualización automática.');
      }
    });
  }

  if (elements.haptics) {
    elements.haptics.addEventListener('change', () => {
      state.haptics = Boolean(elements.haptics.checked);
      saveJson(STORAGE_KEYS.haptics, state.haptics);
      saveProfileHapticsPreference(state.haptics);
      if (state.haptics && navigator.vibrate) {
        navigator.vibrate(14);
      }
      setComposerHint(state.haptics ? 'Vibración activada.' : 'Vibración desactivada.');
    });
  }

  if (elements.sendLocation) {
    elements.sendLocation.addEventListener('click', async () => {
      if (!window.isSecureContext) {
        setComposerHint('La ubicación requiere HTTPS o localhost en este navegador.');
        return;
      }

      if (!navigator.geolocation) {
        setComposerHint('Ubicación no disponible en este navegador.');
        return;
      }

      setComposerHint('Obteniendo ubicación...');
      try {
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 12000,
            maximumAge: 0
          });
        });
        const lat = Number(position.coords.latitude).toFixed(5);
        const lon = Number(position.coords.longitude).toFixed(5);
        const accuracy = Number(position.coords.accuracy || 0);
        const mapUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
        const accuracyText = accuracy > 0 ? `, precisión aprox. ${Math.round(accuracy)} m` : '';
        await enqueueTextMessage(`Ubicación GPS: ${lat}, ${lon}${accuracyText} ${mapUrl}`);
      } catch (error) {
        console.error(error);
        if (error && error.code === error.PERMISSION_DENIED) {
          setComposerHint('Permiso de ubicación denegado. Actívalo en el navegador.');
          return;
        }
        if (error && error.code === error.TIMEOUT) {
          setComposerHint('No se logró fijar GPS a tiempo. Intenta de nuevo con mejor señal.');
          return;
        }
        setComposerHint('No se pudo obtener la ubicación GPS.');
      }
    });
  }

  if (elements.voiceRecord) {
    let pointerDown = false;

    elements.voiceRecord.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }
      event.preventDefault();
      pointerDown = true;
      startVoiceRecording().then(() => {
        if (state.voiceRecorder && state.voiceRecorder.state === 'recording') {
          setComposerHint('Grabando... suelta para enviar.');
        }
      }).catch((error) => {
        console.error(error);
        pointerDown = false;
      });
    });

    const stopHoldRecording = () => {
      const recording = Boolean(state.voiceRecorder && state.voiceRecorder.state === 'recording');
      pointerDown = false;
      if (!recording) {
        return;
      }
      stopVoiceRecording().catch((error) => {
        console.error(error);
      });
    };

    elements.voiceRecord.addEventListener('pointerup', stopHoldRecording);
    elements.voiceRecord.addEventListener('pointercancel', stopHoldRecording);
    elements.voiceRecord.addEventListener('pointerleave', () => {
      if (pointerDown) {
        stopHoldRecording();
      }
    });

    elements.voiceRecord.addEventListener('keydown', async (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      event.preventDefault();
      const recording = Boolean(state.voiceRecorder && state.voiceRecorder.state === 'recording');
      if (recording) {
        await stopVoiceRecording();
      } else {
        await startVoiceRecording();
      }
    });
  }

  if (elements.installApp) {
    elements.installApp.addEventListener('click', () => {
      requestAppInstall().catch((error) => {
        console.error(error);
        setComposerHint('No se pudo iniciar la instalación.');
      });
    });
  }

  if (elements.identityInstallApp) {
    elements.identityInstallApp.addEventListener('click', () => {
      requestAppInstall().catch((error) => {
        console.error(error);
        setComposerHint('No se pudo iniciar la instalación.');
      });
    });
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    state.installAudit.promptAvailable = true;
    persistInstallAudit();
    updateInstallStatusUi();
    if (elements.installApp) {
      elements.installApp.hidden = false;
      elements.installApp.setAttribute('aria-hidden', 'false');
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    state.installAudit.lastInstalledAt = new Date().toISOString();
    state.installAudit.promptAvailable = false;
    persistInstallAudit();
    updateInstallStatusUi();
    if (elements.installApp) {
      elements.installApp.hidden = true;
      elements.installApp.setAttribute('aria-hidden', 'true');
    }
    setComposerHint('\u2713 ¡Instalada! Búscala en tu pantalla de inicio o en el cajón de apps. Si no la ves, desliza hacia la derecha en el home.');
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopVoiceRecording().catch(() => {
      });
    } else {
      clearUnreadBadge();
      syncVisibleMessageReceipts().catch((error) => {
        console.error(error);
      });
    }
  });

  window.addEventListener('focus', () => {
    clearUnreadBadge();
    syncVisibleMessageReceipts().catch((error) => {
      console.error(error);
    });
  });

  window.addEventListener('beforeunload', () => {
    stopVoiceCaptureStream();
  });

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (!target.closest('.message') && !isMessageQuickMenuTarget(target)) {
      clearSelectedMessage();
    }
    if (state.profileMenuOpen && !isProfileMenuTarget(target)) {
      hideProfileMenu();
    }
    if (state.emojiPanelOpen && !isEmojiPanelTarget(target)) {
      hideEmojiPanel();
    }
    if (elements.netPanel.hidden) {
      return;
    }
    if (elements.netPanel.contains(target) || elements.netFab.contains(target)) {
      return;
    }
    elements.netPanel.hidden = true;
    elements.netFab.setAttribute('aria-expanded', 'false');
  });

  if (elements.messageQuickMenu) {
    elements.messageQuickMenu.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
    });
  }

  if (elements.messageQuickClose) {
    elements.messageQuickClose.addEventListener('click', () => {
      clearSelectedMessage();
    });
  }

  if (elements.messageQuickCopy) {
    elements.messageQuickCopy.addEventListener('click', () => {
      const selectedMessage = getSelectedMessage();
      if (!selectedMessage) {
        return;
      }
      if (selectedMessage.type === 'image' || selectedMessage.type === 'audio') {
        const mediaRef = buildCopyableMediaReference(selectedMessage);
        copyMessageText(mediaRef, 'Enlace copiado.').catch((error) => {
          console.error(error);
          setComposerHint('No se pudo copiar el enlace.');
        });
        return;
      }
      const textValue = String(selectedMessage.display_content || selectedMessage.content || '');
      copyMessageText(textValue).catch((error) => {
        console.error(error);
        setComposerHint('No se pudo copiar el mensaje.');
      });
    });
  }

  if (elements.messageQuickCopyLocation) {
    elements.messageQuickCopyLocation.addEventListener('click', () => {
      const selectedMessage = getSelectedMessage();
      if (!selectedMessage || selectedMessage.type === 'image' || selectedMessage.type === 'audio') {
        return;
      }
      const textValue = String(selectedMessage.display_content || selectedMessage.content || '');
      const locationText = extractLocationText(textValue);
      copyMessageText(locationText, 'Ubicación copiada.').catch((error) => {
        console.error(error);
        setComposerHint('No se pudo copiar la ubicación.');
      });
    });
  }

  if (elements.messageQuickCopyMedia) {
    elements.messageQuickCopyMedia.addEventListener('click', () => {
      const selectedMessage = getSelectedMessage();
      if (!selectedMessage) {
        return;
      }
      const mediaRef = buildCopyableMediaReference(selectedMessage);
      copyMessageText(mediaRef, 'Enlace multimedia copiado.').catch((error) => {
        console.error(error);
        setComposerHint('No se pudo copiar el enlace multimedia.');
      });
    });
  }

  if (elements.messageQuickEdit) {
    elements.messageQuickEdit.addEventListener('click', () => {
      const selectedMessage = getSelectedMessage();
      if (!selectedMessage || !isOwnMessage(selectedMessage)) {
        return;
      }
      editOwnTextMessage(selectedMessage).catch((error) => {
        console.error(error);
        setComposerHint('No se pudo editar el mensaje.');
      });
    });
  }

  if (elements.messageQuickDelete) {
    elements.messageQuickDelete.addEventListener('click', () => {
      const selectedMessage = getSelectedMessage();
      if (!selectedMessage || !isOwnMessage(selectedMessage)) {
        return;
      }
      const isMedia = selectedMessage.type === 'image' || selectedMessage.type === 'audio';
      const action = isMedia ? cancelOrRemoveOwnMedia(selectedMessage) : deleteOwnTextMessage(selectedMessage);
      action.catch((error) => {
        console.error(error);
        setComposerHint(isMedia ? 'No se pudo completar la acción sobre el archivo.' : 'No se pudo eliminar el mensaje.');
      });
    });
  }

  elements.toggleSetup.addEventListener('click', () => {
    toggleAdvancedSetupPanel();
  });

  if (elements.profileOpenSettings) {
    elements.profileOpenSettings.addEventListener('click', () => {
      hideProfileMenu();
      openProfileSettingsPanel();
    });
  }

  if (elements.profileOpenAdvanced) {
    elements.profileOpenAdvanced.addEventListener('click', () => {
      hideProfileMenu();
      openAdvancedSetupPanel();
    });
  }

  if (elements.profileSettingsClose) {
    elements.profileSettingsClose.addEventListener('click', () => {
      closeProfileSettingsPanel();
    });
  }

  if (elements.profileSettingsPanel) {
    elements.profileSettingsPanel.addEventListener('click', (event) => {
      if (event.target === elements.profileSettingsPanel) {
        closeProfileSettingsPanel();
      }
    });
  }

  if (elements.profileSettingsForm) {
    elements.profileSettingsForm.addEventListener('submit', (event) => {
      event.preventDefault();
      saveProfileSettingsFromPanel();
    });
  }

  if (elements.profileSettingsAllowNotifications) {
    elements.profileSettingsAllowNotifications.addEventListener('click', () => {
      requestSystemNotificationPermission().catch((error) => {
        console.error(error);
        setComposerHint('No se pudo solicitar permiso de notificaciones.');
      });
    });
  }

  if (elements.profileSettingsRefreshInstall) {
    elements.profileSettingsRefreshInstall.addEventListener('click', () => {
      updateInstallStatusUi();
      setComposerHint('Estado de instalación actualizado.');
    });
  }

  elements.toggleConfigLock.addEventListener('click', () => {
    state.configLocked = !state.configLocked;
    saveJson(STORAGE_KEYS.configLocked, state.configLocked);
    applyConfigLockUi();
    setComposerHint(state.configLocked
      ? 'Configuración bloqueada para evitar cambios accidentales.'
      : 'Configuración desbloqueada. Guarda si hiciste cambios.');
  });

  elements.configForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.configLocked) {
      setComposerHint('La configuración está bloqueada. Pulsa "Desbloquear config" para editar.');
      return;
    }

    const nextSupabaseKey = elements.supabaseKey.value.trim() || state.config.supabaseKey;
    const nextPassphrase = elements.e2eePassphrase.value.trim() || state.config.e2eePassphrase || '';
    state.config = {
      supabaseUrl: elements.supabaseUrl.value.trim().replace(/\/$/, '') || state.config.supabaseUrl,
      supabaseKey: nextSupabaseKey,
      sessionId: elements.sessionId.value.trim() || defaultConfig.sessionId,
      senderId: elements.senderId.value.trim() || createId('user'),
      bucketName: elements.bucketName.value.trim() || defaultConfig.bucketName,
      exportEndpoint: elements.exportEndpoint.value.trim() || defaultConfig.exportEndpoint,
      resetEndpoint: elements.resetEndpoint.value.trim() || defaultConfig.resetEndpoint,
      resetAdminSecret: elements.resetAdminSecret?.value.trim() || '',
      exportEmail: elements.exportEmail.value.trim(),
      e2eePassphrase: nextPassphrase
    };
    resetE2EECache();
    state.e2eeUnlockUntil = 0;
    saveJson(STORAGE_KEYS.e2eeUnlockUntil, state.e2eeUnlockUntil);
    saveJson(STORAGE_KEYS.config, state.config);
    elements.setupRequirements.textContent = buildSetupRequirements();
    disconnectRealtime();
    updateConnectionUi();
    if (isConfigured()) {
        state.historyOldestTimestamp = null;
        state.historyHasMore = true;
      await refreshHistory();
      connectRealtime();
      flushQueues();
      setComposerHint('Configuración guardada. El chat se conectará si las políticas de Supabase ya están creadas.');
    } else {
      setComposerHint('Falta URL o clave anónima de Supabase.');
    }
  });

  elements.reloadHistory.addEventListener('click', () => {
    state.historyOldestTimestamp = null;
    state.historyHasMore = true;
    refreshHistory({ all: true });
  });

  elements.resetRoom?.addEventListener('click', async () => {
    await resetCurrentRoomForAll();
  });

  elements.messageForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = normalizeOutgoingText(elements.messageInput.value);
    if (!text) {
      return;
    }
    try {
      await enqueueTextMessage(text);
      elements.messageInput.value = '';
      hideEmojiPanel();
    } catch (error) {
      console.error(error);
      setComposerHint('No se pudo enviar: clave E2E pendiente o inválida.');
    }
  });

  elements.messageInput.addEventListener('input', () => {
    applyTypingCorrections(elements.messageInput);
    if (!state.emojiPanelOpen && !state.emojiPanelManuallyClosed) {
      showEmojiPanel();
    }
  });

  elements.messageInput.addEventListener('focus', () => {
    if (!state.emojiPanelManuallyClosed) {
      showEmojiPanel();
    }
    scheduleKeyboardViewportUpdate();
  });

  elements.messageInput.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (!isEmojiPanelTarget(document.activeElement)) {
        hideEmojiPanel();
      }
      scheduleKeyboardViewportUpdate();
    }, 0);
  });

  elements.messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideEmojiPanel();
      return;
    }
    if (event.key === 'ArrowUp' && !elements.messageInput.value.trim()) {
      event.preventDefault();
      editLastOwnTextMessage().catch((error) => {
        console.error(error);
        setComposerHint('No se pudo abrir la edicion del ultimo mensaje.');
      });
    }
  });

  const queueImageFiles = async (files) => {
    if (files.length === 0) {
      return;
    }

    if (!IMAGE_DRAFT_PREVIEW_ENABLED) {
      closImageDraftPanel();
      const incoming = files.map((file) => ({ file }));
      state.imageDraftQueue = [...state.imageDraftQueue, ...incoming];
      setComposerHint(`Cola de imágenes: ${state.imageDraftQueue.length}. Enviando...`);
      processImageSendQueue().catch((error) => {
        console.error(error);
        setComposerHint('No se pudo enviar la cola de imágenes.');
      });
      return;
    }

    await showImageDraftPanel(files[0], files.slice(1));
  };

  elements.imageInput.addEventListener('change', async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    await queueImageFiles(files);
  });

  if (elements.openCamera && elements.cameraInput) {
    elements.openCamera.addEventListener('click', () => {
      elements.cameraInput.click();
    });

    elements.cameraInput.addEventListener('change', async (event) => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      await queueImageFiles(files);
    });
  }

  elements.draftSendButton.addEventListener('click', async () => {
    if (!state.imageDraftFile && (!state.imageDraftQueue || state.imageDraftQueue.length === 0)) {
      return;
    }

    if (state.imageDraftFile) {
      state.imageDraftQueue.unshift({
        file: state.imageDraftFile,
        prepared: state.imageDraft
      });
    }

    closImageDraftPanel();
    setComposerHint(`Cola de imágenes: ${state.imageDraftQueue.length}. Iniciando envío secuencial...`);
    processImageSendQueue().catch((error) => {
      console.error(error);
      setComposerHint('No se pudo procesar la cola de imágenes completa.');
    });
  });

  elements.draftChangeButton.addEventListener('click', () => {
    closImageDraftPanel();
    elements.imageInput.click();
  });

  elements.draftDiscardButton.addEventListener('click', () => {
    state.imageDraftQueue = [];
    closImageDraftPanel();
    setComposerHint('Borrador de imagen descartado.');
  });

  if (elements.profileTriggerFloating) {
    elements.profileTriggerFloating.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleProfileMenu();
    });
  }

  if (elements.profileTriggerTopbar) {
    elements.profileTriggerTopbar.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleProfileMenu();
    });
  }

  if (elements.profileChangePhoto) {
    elements.profileChangePhoto.addEventListener('click', () => {
      hideProfileMenu();
      elements.profilePhotoInput?.click();
    });
  }

  if (elements.profileClearPhoto) {
    elements.profileClearPhoto.addEventListener('click', () => {
      clearProfilePhoto();
      hideProfileMenu();
    });
  }

  if (elements.profileSwitchUser) {
    elements.profileSwitchUser.addEventListener('click', () => {
      switchUserIdentity();
    });
  }

  if (elements.emojiToggle) {
    elements.emojiToggle.addEventListener('click', () => {
      const wasOpen = state.emojiPanelOpen;
      if (wasOpen) {
        state.emojiPanelManuallyClosed = true;
        hideEmojiPanel();
      } else {
        state.emojiPanelManuallyClosed = false;
        showEmojiPanel();
      }
      if (!wasOpen) {
        elements.messageInput.focus({ preventScroll: true });
      }
    });
  }

  if (elements.emojiPanelClose) {
    elements.emojiPanelClose.addEventListener('click', () => {
      state.emojiPanelManuallyClosed = true;
      hideEmojiPanel();
      elements.messageInput.focus({ preventScroll: true });
    });
  }

  if (elements.emojiGrid) {
    elements.emojiGrid.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement)) {
        return;
      }
      const emoji = target.dataset.emoji;
      if (!emoji) {
        return;
      }
      insertTextAtCursor(elements.messageInput, emoji);
      elements.messageInput.focus({ preventScroll: true });
      showEmojiPanel();
    });
  }

  if (elements.emojiCategories) {
    elements.emojiCategories.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement)) {
        return;
      }
      const category = target.dataset.category;
      if (!category) {
        return;
      }
      setEmojiCategory(category);
      showEmojiPanel();
    });
  }

  elements.profilePhotoInput.addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    await saveProfilePhoto(file);
  });

  elements.profileMenu?.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });

  elements.profileMenu?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideProfileMenu();
    }
  });

  elements.emojiPanel?.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });

  elements.exportHistory.addEventListener('click', async () => {
    await exportHistory();
  });

  elements.downloadTranscript.addEventListener('click', () => {
    downloadTranscript();
  });

  window.addEventListener('online', () => {
    state.online = true;
    handleReconnect().catch((error) => {
      console.error(error);
      setComposerHint('Reconectado con incidencias. Reintentando sincronización.');
    });
  });

  window.addEventListener('offline', () => {
    state.online = false;
    updateConnectionUi();
  });

  window.addEventListener('focus', () => {
    if (state.online && isConfigured()) {
      handleReconnect({ soft: true }).catch((error) => console.error(error));
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.online && isConfigured()) {
      handleReconnect({ soft: true }).catch((error) => console.error(error));
    }
  });

  // Attach typing status listeners
  attachTypingStatusListeners();
}

async function handleReconnect(options = {}) {
  const { soft = false } = options;
  if (!isConfigured()) {
    return;
  }

  await probeConnection();
  if (!state.online) {
    return;
  }

  if (!state.realtimeSocket || state.realtimeSocket.readyState === WebSocket.CLOSED) {
    connectRealtime();
  }

  await refreshHistory({ silent: true });
  await flushQueues();
  updateSyncSummary();

  if (!soft) {
    setComposerHint('Reconexión completa: historial y cola sincronizados.');
  }
}

async function registerPwa() {
  if (!('serviceWorker' in navigator)) {
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register(`sw.js?v=${encodeURIComponent(APP_VERSION)}`);
    registration.update().catch(() => {
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (serviceWorkerReloaded) {
        return;
      }
      serviceWorkerReloaded = true;
      window.location.reload();
    });
  } catch (error) {
    console.warn('No se pudo registrar el service worker', error);
  }
}

function applyConfigToForm() {
  elements.e2eePassphrase.value = state.config.e2eePassphrase || '';
  elements.supabaseUrl.value = state.config.supabaseUrl;
  elements.supabaseKey.value = state.config.supabaseKey;
  elements.sessionId.value = state.config.sessionId;
  elements.senderId.value = state.config.senderId;
  elements.bucketName.value = state.config.bucketName;
  elements.exportEndpoint.value = state.config.exportEndpoint;
  if (elements.resetEndpoint) {
    elements.resetEndpoint.value = state.config.resetEndpoint || defaultConfig.resetEndpoint;
  }
  if (elements.resetAdminSecret) {
    elements.resetAdminSecret.value = state.config.resetAdminSecret || '';
  }
  elements.exportEmail.value = state.config.exportEmail;
  if (elements.haptics) {
    elements.haptics.checked = state.haptics;
  }
  applyConfigLockUi();
  updateActiveUserUi();
}

function ensureIdentitySelected() {
  return new Promise((resolve) => {
    const deviceId = ensureDeviceId();

    const completeSelection = () => {
      updateIdentityEntryLoadingStatus('Cargando historial...', 32);
      finalizeIdentityEntry();
      resolve();
    };

    if (state.pendingUrlIdentity) {
      const chosen = state.pendingUrlIdentity;
      state.identity = chosen;
      state.config.senderId = chosen;
      state.identityByDevice[deviceId] = chosen;
      saveJson(STORAGE_KEYS.identity, state.identity);
      saveJson(STORAGE_KEYS.identityByDevice, state.identityByDevice);
      saveJson(STORAGE_KEYS.config, state.config);
      loadActiveUserState();
      elements.senderId.value = state.config.senderId;
      elements.identityCustom.value = chosen;
      syncIdentityCustomEntryMessage(chosen);
      state.pendingUrlIdentity = '';
      setIdentityGateVisible(true);
      runIdentityEntryProgress(chosen)
        .catch((error) => {
          console.error('Identity progress failed', error);
        })
        .finally(completeSelection);
      updateActiveUserUi();
      return;
    }

    state.identity = '';
    state.config.senderId = '';
    saveJson(STORAGE_KEYS.identity, state.identity);
    saveJson(STORAGE_KEYS.config, state.config);
    elements.senderId.value = '';
    elements.identityCustom.value = '';

    setIdentityGateVisible(true);
    updateIdentityProfilesUi();
    if (state.identityByDevice[deviceId]) {
      elements.identityCustom.value = normalizeIdentity(state.identityByDevice[deviceId]);
    }
    syncIdentityCustomEntryMessage(elements.identityCustom.value || '');

    const choose = (rawName) => {
      const name = normalizeIdentity(rawName);
      if (!name) {
        setComposerHint('Escribe un nombre valido para entrar al chat.');
        return;
      }

      if (state.identityEntryBusy) {
        return;
      }

      resetTransientChatState();
      state.identity = name;
      state.config.senderId = name;
      state.identityByDevice[deviceId] = name;
      saveJson(STORAGE_KEYS.identity, state.identity);
      saveJson(STORAGE_KEYS.identityByDevice, state.identityByDevice);
      saveJson(STORAGE_KEYS.config, state.config);
      persistIdentityCustomEntryMessage(name);
      loadActiveUserState();
      elements.senderId.value = state.config.senderId;

      runIdentityEntryProgress(name)
        .catch((error) => {
          console.error('Identity progress failed', error);
        })
        .finally(completeSelection);
    };

    elements.identityRoberto.onclick = () => choose('roberto');
    elements.identityMonica.onclick = () => choose('monica');
    elements.identityCustomSubmit.onclick = () => choose(elements.identityCustom.value);
    elements.identityRoberto.onfocus = () => syncIdentityCustomEntryMessage('roberto');
    elements.identityMonica.onfocus = () => syncIdentityCustomEntryMessage('monica');
    elements.identityCustom.onkeydown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        choose(elements.identityCustom.value);
      }
    };
    elements.identityCustom.oninput = () => {
      syncIdentityCustomEntryMessage(elements.identityCustom.value);
    };
  });
}

function setIdentityGateVisible(visible) {
  elements.identityGate.hidden = !visible;
  elements.identityGate.style.display = visible ? 'grid' : 'none';
  document.body.classList.toggle('identity-lock', visible);
  if (visible) {
    resetIdentityEntryProgressUi();
    updateIdentityProfilesUi();
    updateInstallStatusUi();
    window.requestAnimationFrame(() => {
      if (elements.identityMonica) {
        elements.identityMonica.focus();
      }
    });
  }
}

function toggleAdvancedSetupPanel() {
  elements.setupPanel.hidden = !elements.setupPanel.hidden;
  elements.setupPanel.setAttribute('aria-hidden', elements.setupPanel.hidden ? 'true' : 'false');
}

function openAdvancedSetupPanel() {
  elements.setupPanel.hidden = false;
  elements.setupPanel.setAttribute('aria-hidden', 'false');
}

function profileHapticsStorageKey(identityValue = '') {
  const identity = normalizeIdentity(identityValue || state.config.senderId || state.identity || '');
  return `${STORAGE_KEYS.profileHaptics}:${identity || 'anon'}`;
}

function loadProfileHapticsPreference(identityValue = '') {
  const fallback = loadJson(STORAGE_KEYS.haptics, false);
  return loadJson(profileHapticsStorageKey(identityValue), fallback);
}

function saveProfileHapticsPreference(value, identityValue = '') {
  saveJson(profileHapticsStorageKey(identityValue), Boolean(value));
}

function normalizeNotificationMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'vibrate' || mode === 'sound') {
    return mode;
  }
  return 'both';
}

function profileNotificationModeStorageKey(identityValue = '') {
  const identity = normalizeIdentity(identityValue || state.config.senderId || state.identity || '');
  return `${STORAGE_KEYS.profileNotificationMode}:${identity || 'anon'}`;
}

function loadProfileNotificationModePreference(identityValue = '') {
  const fallback = normalizeNotificationMode(loadJson(STORAGE_KEYS.notificationMode, 'both'));
  return normalizeNotificationMode(loadJson(profileNotificationModeStorageKey(identityValue), fallback));
}

function saveProfileNotificationModePreference(value, identityValue = '') {
  saveJson(profileNotificationModeStorageKey(identityValue), normalizeNotificationMode(value));
}

function profileSystemNotificationsStorageKey(identityValue = '') {
  const identity = normalizeIdentity(identityValue || state.config.senderId || state.identity || '');
  return `${STORAGE_KEYS.profileSystemNotifications}:${identity || 'anon'}`;
}

function loadProfileSystemNotificationsPreference(identityValue = '') {
  return Boolean(loadJson(profileSystemNotificationsStorageKey(identityValue), false));
}

function saveProfileSystemNotificationsPreference(value, identityValue = '') {
  saveJson(profileSystemNotificationsStorageKey(identityValue), Boolean(value));
}

function readNotificationPermissionState() {
  if (!('Notification' in window)) {
    return 'unsupported';
  }
  return String(Notification.permission || 'default');
}

function updateNotificationPermissionUi() {
  if (!elements.profileSettingsNotificationStatus || !elements.profileSettingsAllowNotifications) {
    return;
  }

  const permission = readNotificationPermissionState();
  if (permission === 'granted') {
    elements.profileSettingsNotificationStatus.textContent = 'Estado de notificaciones: permiso concedido.';
    elements.profileSettingsAllowNotifications.textContent = 'Permiso activo';
    elements.profileSettingsAllowNotifications.disabled = true;
    return;
  }

  if (permission === 'denied') {
    elements.profileSettingsNotificationStatus.textContent = 'Estado de notificaciones: bloqueadas por el navegador.';
    elements.profileSettingsAllowNotifications.textContent = 'Permiso bloqueado';
    elements.profileSettingsAllowNotifications.disabled = true;
    return;
  }

  if (permission === 'unsupported') {
    elements.profileSettingsNotificationStatus.textContent = 'Estado de notificaciones: no soportadas en este navegador.';
    elements.profileSettingsAllowNotifications.textContent = 'No soportado';
    elements.profileSettingsAllowNotifications.disabled = true;
    return;
  }

  elements.profileSettingsNotificationStatus.textContent = 'Estado de notificaciones: falta conceder permiso.';
  elements.profileSettingsAllowNotifications.textContent = 'Permitir notificaciones';
  elements.profileSettingsAllowNotifications.disabled = false;
}

async function requestSystemNotificationPermission() {
  if (!('Notification' in window)) {
    setComposerHint('Este navegador no soporta notificaciones del sistema.');
    updateNotificationPermissionUi();
    return false;
  }

  const result = await Notification.requestPermission();
  updateNotificationPermissionUi();
  if (result === 'granted') {
    setComposerHint('Permiso de notificaciones concedido.');
    return true;
  }

  setComposerHint('Permiso de notificaciones no concedido.');
  return false;
}

function persistInstallAudit() {
  saveJson(STORAGE_KEYS.installAudit, state.installAudit || {});
}

function isRunningStandalone() {
  const byMedia = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  const byNavigator = typeof navigator.standalone !== 'undefined' && Boolean(navigator.standalone);
  return Boolean(byMedia || byNavigator);
}

function formatInstallAuditDate(value) {
  if (!value) {
    return 'nunca';
  }
  return formatDate(value);
}

function updateInstallStatusUi() {
  const standalone = isRunningStandalone();
  const promptReady = Boolean(deferredInstallPrompt || (state.installAudit && state.installAudit.promptAvailable));
  const lastChoice = String((state.installAudit && state.installAudit.lastChoice) || 'sin intentos');
  const lastChoiceAt = formatInstallAuditDate(state.installAudit && state.installAudit.lastChoiceAt);
  const lastInstalledAt = formatInstallAuditDate(state.installAudit && state.installAudit.lastInstalledAt);
  const installMessage = standalone
    ? `Instalada y ejecutándose como app. Última instalación: ${lastInstalledAt}. Último intento: ${lastChoice} (${lastChoiceAt}).`
    : `No está en modo app. Prompt disponible: ${promptReady ? 'sí' : 'no'}. Último intento: ${lastChoice} (${lastChoiceAt}).`;

  if (elements.profileSettingsInstallStatus) {
    elements.profileSettingsInstallStatus.textContent = `Estado instalación: ${installMessage}`;
  }

  if (elements.identityInstallStatus) {
    elements.identityInstallStatus.textContent = standalone
      ? `Ya está instalada en el teléfono. ${installMessage}`
      : `Instalar crea un acceso directo y abre la app como PWA. ${installMessage}`;
  }

  const buttons = [elements.installApp, elements.identityInstallApp];
  for (const button of buttons) {
    if (!button) {
      continue;
    }
    if (standalone) {
      button.textContent = 'Instalada';
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
    } else if (promptReady) {
      button.textContent = 'Instalar en este teléfono';
      button.disabled = false;
      button.removeAttribute('aria-disabled');
    } else {
      button.textContent = 'Instalar disponible al navegar';
      button.disabled = false;
      button.removeAttribute('aria-disabled');
    }
  }
}

async function requestAppInstall() {
  if (isRunningStandalone()) {
    setComposerHint('La app ya está instalada en este teléfono.');
    updateInstallStatusUi();
    return true;
  }

  if (!deferredInstallPrompt) {
    setComposerHint('La instalación todavía no está lista en este navegador. Navega un poco y vuelve a intentarlo.');
    state.installAudit.promptAvailable = false;
    persistInstallAudit();
    updateInstallStatusUi();
    return false;
  }

  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  state.installAudit.lastChoice = String(choice && choice.outcome ? choice.outcome : 'unknown');
  state.installAudit.lastChoiceAt = new Date().toISOString();
  state.installAudit.promptAvailable = false;
  persistInstallAudit();
  updateInstallStatusUi();
  deferredInstallPrompt = null;
  if (elements.installApp) {
    elements.installApp.hidden = false;
    elements.installApp.setAttribute('aria-hidden', 'false');
  }
  setComposerHint(choice.outcome === 'accepted'
    ? 'Instalación iniciada.'
    : 'Instalación cancelada.');
  return choice.outcome === 'accepted';
}

function openProfileSettingsPanel() {
  const identity = normalizeIdentity(state.config.senderId || state.identity || '');
  if (!identity) {
    setComposerHint('Selecciona un perfil antes de abrir sus ajustes.');
    return;
  }
  if (elements.profileSettingsName) {
    elements.profileSettingsName.value = formatUserName(identity);
  }
  if (elements.profileSettingsEntryMessage) {
    elements.profileSettingsEntryMessage.value = getIdentityCustomEntryMessage(identity);
  }
  if (elements.profileSettingsHaptics) {
    elements.profileSettingsHaptics.checked = loadProfileHapticsPreference(identity);
  }
  if (elements.profileSettingsNotificationMode) {
    elements.profileSettingsNotificationMode.value = loadProfileNotificationModePreference(identity);
  }
  if (elements.profileSettingsSystemNotifications) {
    elements.profileSettingsSystemNotifications.checked = loadProfileSystemNotificationsPreference(identity);
  }
  updateNotificationPermissionUi();
  updateInstallStatusUi();
  if (elements.profileSettingsPanel) {
    elements.profileSettingsPanel.hidden = false;
    elements.profileSettingsPanel.setAttribute('aria-hidden', 'false');
  }
}

function closeProfileSettingsPanel() {
  if (!elements.profileSettingsPanel) {
    return;
  }
  elements.profileSettingsPanel.hidden = true;
  elements.profileSettingsPanel.setAttribute('aria-hidden', 'true');
}

function saveProfileSettingsFromPanel() {
  const identity = normalizeIdentity(state.config.senderId || state.identity || '');
  if (!identity) {
    return;
  }

  if (elements.profileSettingsEntryMessage) {
    const rawMessage = String(elements.profileSettingsEntryMessage.value || '').trim();
    const key = identityEntryMessageStorageKey(identity);
    if (rawMessage) {
      localStorage.setItem(key, rawMessage.slice(0, 140));
    } else {
      localStorage.removeItem(key);
    }
    if (elements.identityEntryCustomMessage) {
      elements.identityEntryCustomMessage.value = rawMessage;
    }
  }

  if (elements.profileSettingsHaptics) {
    const nextHaptics = Boolean(elements.profileSettingsHaptics.checked);
    saveProfileHapticsPreference(nextHaptics, identity);
    state.haptics = nextHaptics;
    saveJson(STORAGE_KEYS.haptics, state.haptics);
    if (elements.haptics) {
      elements.haptics.checked = state.haptics;
    }
  }

  if (elements.profileSettingsNotificationMode) {
    const mode = normalizeNotificationMode(elements.profileSettingsNotificationMode.value);
    saveProfileNotificationModePreference(mode, identity);
    state.notificationMode = mode;
    saveJson(STORAGE_KEYS.notificationMode, mode);
  }

  if (elements.profileSettingsSystemNotifications) {
    const enabled = Boolean(elements.profileSettingsSystemNotifications.checked);
    saveProfileSystemNotificationsPreference(enabled, identity);
    state.systemNotificationsEnabled = enabled;
    if (enabled && readNotificationPermissionState() !== 'granted') {
      requestSystemNotificationPermission().catch((error) => {
        console.error(error);
      });
    }
  }

  closeProfileSettingsPanel();
  setComposerHint('Ajustes del perfil guardados.');
}

function normalizeIdentity(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function formatUserName(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return 'Desconocido';
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function updateActiveUserUi() {
  elements.activeUser.textContent = formatUserName(state.config.senderId || state.identity);
  state.haptics = loadProfileHapticsPreference();
  state.notificationMode = loadProfileNotificationModePreference();
  state.systemNotificationsEnabled = loadProfileSystemNotificationsPreference();
  if (elements.haptics) {
    elements.haptics.checked = state.haptics;
  }
  // Clear any previous avatar to prevent cross-contamination between users
  elements.profileAvatarImg.removeAttribute('src');
  elements.profileAvatarImg.style.opacity = '0';
  if (elements.profileAvatarImgTopbar) {
    elements.profileAvatarImgTopbar.removeAttribute('src');
    elements.profileAvatarImgTopbar.style.opacity = '0';
  }
  // Now load the correct profile photo for the active user
  loadProfilePhoto();
  updateProfileFallbackInitial();
  updateSyncSummary();
  updateInstallStatusUi();
}

function switchUserIdentity() {
  hideProfileMenu();
  const deviceId = ensureDeviceId();
  resetTransientChatState();
  resetIdentityEntryProgressUi();
  state.identity = '';
  state.config.senderId = '';
  if (deviceId && state.identityByDevice[deviceId]) {
    delete state.identityByDevice[deviceId];
  }
  saveJson(STORAGE_KEYS.identity, state.identity);
  saveJson(STORAGE_KEYS.identityByDevice, state.identityByDevice);
  saveJson(STORAGE_KEYS.config, state.config);
  elements.senderId.value = '';
  elements.identityCustom.value = '';
  setIdentityGateVisible(true);
  updateActiveUserUi();
  setComposerHint('Selecciona el usuario para continuar.');
}

function updateProfileFallbackInitial() {
  const name = formatUserName(state.config.senderId || state.identity || 'U');
  const initial = String(name || 'U').trim().charAt(0).toUpperCase() || 'U';
  if (elements.profileAvatarFallback) {
    elements.profileAvatarFallback.textContent = initial;
  }
  if (elements.profileAvatarFallbackTopbar) {
    elements.profileAvatarFallbackTopbar.textContent = initial;
  }
}

function syncProfileAvatarVisibility() {
  const rawSrc = elements.profileAvatarImg ? (elements.profileAvatarImg.getAttribute('src') || '') : '';
  const hasSrc = rawSrc.trim().length > 0;
  if (elements.profileAvatarFallback) {
    elements.profileAvatarFallback.style.opacity = hasSrc ? '0' : '1';
  }
  if (elements.profileAvatarFallbackTopbar) {
    elements.profileAvatarFallbackTopbar.style.opacity = hasSrc ? '0' : '1';
  }
}

function setComposerLocked(locked) {
  const nodes = [elements.messageInput, elements.imageInput, elements.cameraInput, elements.openCamera, elements.voiceRecord];
  for (const node of nodes) {
    if (!node) {
      continue;
    }
    node.disabled = locked;
  }
  const submitButton = document.getElementById('send-button');
  if (submitButton) {
    submitButton.disabled = locked;
  }
  const composer = document.querySelector('.composer');
  if (composer) {
    composer.classList.toggle('locked', locked);
  }
}

function applyConfigLockUi() {
  const locked = state.configLocked;
  const lockedInputs = [
    elements.e2eePassphrase,
    elements.supabaseUrl,
    elements.supabaseKey,
    elements.sessionId,
    elements.senderId,
    elements.bucketName,
    elements.exportEndpoint,
    elements.resetEndpoint,
    elements.resetAdminSecret,
    elements.exportEmail,
    elements.saveConfig
  ];
  for (const node of lockedInputs) {
    node.disabled = locked;
  }
  elements.toggleConfigLock.textContent = locked ? 'Desbloquear config' : 'Bloquear config';
}

function isConfigured() {
  return Boolean(state.config.supabaseUrl && state.config.supabaseKey && state.config.sessionId && state.config.senderId);
}

function setComposerHint(text) {
  if (state.haptics && navigator.vibrate) {
    const hint = String(text || '').toLowerCase();
    if (hint.includes('error') || hint.includes('no se pudo')) {
      navigator.vibrate([20, 24, 20]);
    }
  }
  elements.composerHint.textContent = text;
}

function canUseVoiceNotes() {
  return Boolean(
    window.isSecureContext &&
    navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === 'function'
    && typeof window.MediaRecorder !== 'undefined'
  );
}

function chooseVoiceMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus'
  ];
  for (const mimeType of candidates) {
    if (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }
  return '';
}

function chooseVoiceBitrateKbps() {
  const kbps = Number(state.kbps || 0);
  if (!state.online || kbps <= 0) {
    return VOICE_BITRATE_KBPS_MEDIUM;
  }
  if (kbps < 160) {
    return VOICE_BITRATE_KBPS_LOW;
  }
  if (kbps < 700) {
    return VOICE_BITRATE_KBPS_MEDIUM;
  }
  return VOICE_BITRATE_KBPS_HIGH;
}

function formatSecondsLabel(totalSeconds) {
  const value = Math.max(0, Math.round(Number(totalSeconds || 0)));
  return `${value}s`;
}

function updateVoiceRecordButton() {
  if (!elements.voiceRecord) {
    return;
  }
  const recording = Boolean(state.voiceRecorder && state.voiceRecorder.state === 'recording');
  elements.voiceRecord.classList.toggle('recording', recording);
  elements.voiceRecord.setAttribute('aria-pressed', recording ? 'true' : 'false');
  elements.voiceRecord.innerHTML = recording
    ? '<span class="icon">■</span><span>Detener</span>'
    : '<span class="icon">●</span><span>Voz</span>';
}

function stopVoiceCaptureStream() {
  if (!state.voiceStream) {
    return;
  }
  for (const track of state.voiceStream.getTracks()) {
    track.stop();
  }
  state.voiceStream = null;
}

function clearVoiceRecordingState() {
  if (state.voiceStopTimer) {
    window.clearTimeout(state.voiceStopTimer);
    state.voiceStopTimer = null;
  }
  state.voiceRecorder = null;
  state.voiceChunks = [];
  state.voiceStartedAt = 0;
  stopVoiceCaptureStream();
  updateVoiceRecordButton();
}

async function startVoiceRecording() {
  if (!canUseVoiceNotes()) {
    setComposerHint('Notas de voz no disponibles en este dispositivo.');
    return;
  }
  if (!isConfigured()) {
    setComposerHint('Configura Supabase antes de enviar notas de voz.');
    return;
  }
  if (state.voiceRecorder && state.voiceRecorder.state === 'recording') {
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        noiseSuppression: true,
        echoCancellation: true,
        channelCount: 1
      }
    });
    const mimeType = chooseVoiceMimeType();
    const bitrateKbps = chooseVoiceBitrateKbps();
    const recorderOptions = {
      audioBitsPerSecond: bitrateKbps * 1000
    };
    if (mimeType) {
      recorderOptions.mimeType = mimeType;
    }
    let recorder;
    try {
      recorder = new MediaRecorder(stream, recorderOptions);
    } catch (_error) {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    }

    state.voiceStream = stream;
    state.voiceRecorder = recorder;
    state.voiceChunks = [];
    state.voiceStartedAt = Date.now();

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size > 0) {
        state.voiceChunks.push(event.data);
      }
    });

    recorder.addEventListener('stop', async () => {
      const chunks = Array.from(state.voiceChunks || []);
      const durationMs = Math.max(1, Date.now() - Number(state.voiceStartedAt || Date.now()));
      const contentType = recorder.mimeType || mimeType || 'audio/webm';
      clearVoiceRecordingState();

      if (chunks.length === 0) {
        setComposerHint('No se detectó audio.');
        return;
      }

      const blob = new Blob(chunks, { type: contentType });
      if (blob.size < VOICE_MIN_BYTES) {
        setComposerHint('Nota muy corta. Intenta grabar un poco más.');
        return;
      }

      try {
        await enqueueAudioMessage(blob, {
          durationMs,
          contentType,
          fileName: `nota-${Date.now()}.webm`,
          audioBitrateKbps: bitrateKbps
        });
      } catch (error) {
        console.error(error);
        setComposerHint('No se pudo encolar la nota de voz.');
      }
    });

    recorder.addEventListener('error', (event) => {
      console.error(event.error || event);
      clearVoiceRecordingState();
      setComposerHint('Error de grabación de audio.');
    });

    // Record as a single block to preserve correct duration metadata.
    recorder.start();
    state.voiceStopTimer = window.setTimeout(() => {
      stopVoiceRecording().catch((error) => {
        console.error(error);
      });
    }, VOICE_MAX_SECONDS * 1000);

    updateVoiceRecordButton();
    setComposerHint('Grabando nota de voz...');
  } catch (error) {
    console.error('Microphone error:', error);
    clearVoiceRecordingState();
    
    // Provide better error message based on the error type
    let errorMsg = 'No se pudo acceder al micrófono.';
    if (error?.name === 'NotAllowedError') {
      errorMsg = 'Acceso al micrófono denegado. Comprueba los permisos del navegador.';
    } else if (error?.name === 'NotFoundError') {
      errorMsg = 'No se encontró micrófono en este dispositivo.';
    } else if (error?.name === 'SecurityError') {
      errorMsg = 'Requiere HTTPS para acceder al micrófono.';
    } else if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
      errorMsg = 'Esta app requiere HTTPS para acceder al micrófono (no http://).';
    }
    setComposerHint(errorMsg);
  }
}

async function stopVoiceRecording() {
  if (!state.voiceRecorder || state.voiceRecorder.state !== 'recording') {
    return;
  }
  if (state.voiceStopTimer) {
    window.clearTimeout(state.voiceStopTimer);
    state.voiceStopTimer = null;
  }
  state.voiceRecorder.stop();
  setComposerHint('Procesando nota de voz...');
}

function renderEmojiPanel() {
  renderEmojiCategories();
  renderEmojiRecent();
  renderEmojiCategoryGrid();
}

function renderEmojiCategories() {
  if (!elements.emojiCategories) {
    return;
  }

  elements.emojiCategories.innerHTML = '';
  for (const [categoryKey, category] of Object.entries(EMOJI_CATEGORIES)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `emoji-category${state.emojiCategory === categoryKey ? ' active' : ''}`;
    button.dataset.category = categoryKey;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(state.emojiCategory === categoryKey));
    button.textContent = category.label;
    elements.emojiCategories.appendChild(button);
  }
}

function renderEmojiRecent() {
  if (!elements.emojiRecentGrid) {
    return;
  }

  elements.emojiRecentGrid.innerHTML = '';
  const recent = state.emojiRecent.slice(0, 8);
  for (const emoji of recent) {
    elements.emojiRecentGrid.appendChild(createEmojiKeyButton(emoji));
  }
}

function renderEmojiCategoryGrid() {
  if (!elements.emojiGrid) {
    return;
  }

  const category = EMOJI_CATEGORIES[state.emojiCategory] || EMOJI_CATEGORIES.caras;
  const emojis = typeof category.emojis === 'function' ? category.emojis() : category.emojis;
  elements.emojiGrid.innerHTML = '';
  for (const emoji of emojis) {
    elements.emojiGrid.appendChild(createEmojiKeyButton(emoji));
  }
}

function createEmojiKeyButton(emoji) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'emoji-key';
  button.dataset.emoji = emoji;
  button.setAttribute('aria-label', `Insertar ${emoji}`);
  button.textContent = emoji;
  return button;
}

function insertTextAtCursor(target, text) {
  if (!target) {
    return;
  }

  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? target.value.length;
  const before = target.value.slice(0, start);
  const after = target.value.slice(end);
  target.value = `${before}${text}${after}`;

  const nextCursor = start + text.length;
  target.setSelectionRange(nextCursor, nextCursor);
  applyTypingCorrections(target);
  registerRecentEmoji(text);
  renderEmojiRecent();
  renderEmojiCategories();
  renderEmojiCategoryGrid();
}

function registerRecentEmoji(emoji) {
  if (!emoji) {
    return;
  }

  state.emojiRecent = [emoji, ...state.emojiRecent.filter((item) => item !== emoji)].slice(0, 12);
  saveJson(userStorageKey(STORAGE_KEYS.emojiRecent), state.emojiRecent);
}

function setEmojiCategory(categoryKey) {
  if (!EMOJI_CATEGORIES[categoryKey]) {
    return;
  }

  state.emojiCategory = categoryKey;
  renderEmojiCategories();
  renderEmojiCategoryGrid();
}

function isEmojiPanelTarget(target) {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(target.closest('.composer') || target.closest('#emoji-panel'));
}

function showEmojiPanel() {
  if (!elements.emojiPanel) {
    return;
  }
  state.emojiPanelOpen = true;
  elements.emojiPanel.hidden = false;
  elements.emojiToggle?.setAttribute('aria-expanded', 'true');
  renderEmojiCategories();
  renderEmojiRecent();
  renderEmojiCategoryGrid();
}

function hideEmojiPanel() {
  if (!elements.emojiPanel) {
    return;
  }
  state.emojiPanelOpen = false;
  elements.emojiPanel.hidden = true;
  elements.emojiToggle?.setAttribute('aria-expanded', 'false');
}

function toggleEmojiPanel() {
  if (state.emojiPanelOpen) {
    hideEmojiPanel();
    return;
  }
  showEmojiPanel();
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
  saveJson(userStorageKey(STORAGE_KEYS.localMessages), state.messages);
}

function persistQueuedTexts() {
  saveJson(userStorageKey(STORAGE_KEYS.queuedTexts), state.queuedTexts);
}

function persistKnownRemoteIds() {
  saveJson(userStorageKey(STORAGE_KEYS.knownRemoteIds), Array.from(state.knownRemoteIds));
}

function loadActiveUserState() {
  state.messages = loadUserJson(STORAGE_KEYS.localMessages, []);
  state.queuedTexts = loadUserJson(STORAGE_KEYS.queuedTexts, []);
  state.knownRemoteIds = new Set(loadUserJson(STORAGE_KEYS.knownRemoteIds, []));
  state.autoSavedImages = new Set(loadUserJson(STORAGE_KEYS.autoSavedImages, []));
  state.emojiRecent = loadUserJson(STORAGE_KEYS.emojiRecent, []);
}

function userStorageKey(baseKey) {
  const identity = normalizeIdentity(state.config.senderId || state.identity || '');
  return `${baseKey}:${identity || 'anon'}`;
}

function loadUserJson(baseKey, fallback) {
  return loadJson(userStorageKey(baseKey), fallback);
}

function saveUserJson(baseKey, value) {
  saveJson(userStorageKey(baseKey), value);
}

function resetTransientChatState() {
  state.messages = [];
  state.queuedTexts = [];
  state.knownRemoteIds = new Set();
  state.autoSavedImages = new Set();
  state.selectedMessageKey = '';
  state.historyOldestTimestamp = null;
  state.historyHasMore = true;
  state.lastSyncAt = null;
  state.unreadCount = 0;
  imageCache.clear();
  updateTitleBadge();
  renderMessages();
}

async function saveProfilePhoto(file) {
  try {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      setComposerHint('Selecciona una imagen válida para el perfil.');
      return;
    }

    // Show preview immediately so the UI feels instant.
    const instantPreviewUrl = URL.createObjectURL(file);
    elements.profileAvatarImg.src = instantPreviewUrl;
    if (elements.profileAvatarImgTopbar) {
      elements.profileAvatarImgTopbar.src = instantPreviewUrl;
      elements.profileAvatarImgTopbar.style.opacity = '1';
    }
    elements.profileAvatarImg.style.opacity = '1';
    syncProfileAvatarVisibility();

    const optimizedDataUrl = await optimizeProfilePhoto(file);
    
    // Save to localStorage first (quick fallback)
    localStorage.setItem(profilePhotoStorageKey(), optimizedDataUrl);
    
    // Save to Supabase in background
    if (isConfigured()) {
      saveProfilePhotoToSupabase(optimizedDataUrl).catch((error) => {
        console.error('Failed to save profile to Supabase:', error);
      });
    }
    
    elements.profileAvatarImg.src = optimizedDataUrl;
    if (elements.profileAvatarImgTopbar) {
      elements.profileAvatarImgTopbar.src = optimizedDataUrl;
    }
    syncProfileAvatarVisibility();
    updateIdentityProfilesUi();
    setComposerHint('Foto de perfil actualizada.');
    window.setTimeout(() => URL.revokeObjectURL(instantPreviewUrl), 1000);
  } catch (error) {
    console.error(error);
    setComposerHint('No se pudo actualizar la foto de perfil.');
  }
}

function loadProfilePhoto() {
  try {
    const activeIdentity = normalizeIdentity(state.config.senderId || state.identity || '');
    
    // If no user is active, remove all avatars
    if (!activeIdentity) {
      elements.profileAvatarImg.removeAttribute('src');
      elements.profileAvatarImg.style.opacity = '0';
      if (elements.profileAvatarImgTopbar) {
        elements.profileAvatarImgTopbar.removeAttribute('src');
        elements.profileAvatarImgTopbar.style.opacity = '0';
      }
      syncProfileAvatarVisibility();
      updateProfileFallbackInitial();
      updateIdentityProfilesUi();
      return;
    }

    updateProfileFallbackInitial();
    
    // Try to load from localStorage first (fast)
    const correctKey = profilePhotoStorageKey();
    const localPhotoDataUrl = localStorage.getItem(correctKey);
    
    if (localPhotoDataUrl) {
      // User has a profile photo in localStorage
      elements.profileAvatarImg.src = localPhotoDataUrl;
      elements.profileAvatarImg.style.opacity = '1';
      if (elements.profileAvatarImgTopbar) {
        elements.profileAvatarImgTopbar.src = localPhotoDataUrl;
        elements.profileAvatarImgTopbar.style.opacity = '1';
      }
    } else {
      // User has no local photo, show initials
      elements.profileAvatarImg.removeAttribute('src');
      elements.profileAvatarImg.style.opacity = '0';
      if (elements.profileAvatarImgTopbar) {
        elements.profileAvatarImgTopbar.removeAttribute('src');
        elements.profileAvatarImgTopbar.style.opacity = '0';
      }
    }
    syncProfileAvatarVisibility();
    updateIdentityProfilesUi();
    
    // Load from Supabase in background (refreshes remote photos)
    loadProfilePhotoFromSupabase(activeIdentity).catch((error) => {
      console.error('Failed to load profile from Supabase:', error);
    });
  } catch (error) {
    console.error('Error loading profile photo:', error);
  }
}

async function optimizeProfilePhoto(file) {
  const MAX_SIDE = 256;
  const TARGET_QUALITY = 0.78;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const jpegBlob = await canvasToJpeg(canvas, TARGET_QUALITY);
  return blobToDataUrl(jpegBlob);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer la imagen del perfil'));
    reader.readAsDataURL(blob);
  });
}

function persistAutoSavedImages() {
  saveJson(STORAGE_KEYS.autoSavedImages, Array.from(state.autoSavedImages));
}

function profilePhotoStorageKey() {
  const identity = normalizeIdentity(state.config.senderId || state.identity || '');
  return `${STORAGE_KEYS.profilePhoto}:${identity || 'anon'}`;
}

function messageKey(message) {
  return message.local_id || message.id;
}

function isOwnMessage(message) {
  return message.sender === state.config.senderId;
}

function selectMessage(message) {
  const key = messageKey(message);
  if (!key) {
    return;
  }
  state.selectedMessageKey = key;
  scheduleRender();
}

function clearSelectedMessage() {
  if (!state.selectedMessageKey) {
    return;
  }
  state.selectedMessageKey = '';
  scheduleRender();
}

function isMessageQuickMenuTarget(target) {
  return Boolean(target && target.closest('#message-quick-menu'));
}

function getSelectedMessage() {
  return state.messages.find((item) => messageKey(item) === state.selectedMessageKey) || null;
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
  scheduleRender();
}

function scheduleRender() {
  if (renderRaf) {
    return;
  }
  renderRaf = window.requestAnimationFrame(() => {
    renderRaf = 0;
    renderMessages();
  });
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

    const own = isOwnMessage(message);
    const selected = messageKey(message) && messageKey(message) === state.selectedMessageKey;
    let pressTimer = null;
    let longPressTriggered = false;
    sender.textContent = own ? 'Tu' : formatUserName(message.sender || 'desconocido');
    time.textContent = formatDate(message.timestamp || new Date().toISOString());
    const statusInfo = buildMessageStatusInfo(message);
    status.textContent = statusInfo.label;
    status.dataset.state = statusInfo.state;
    root.classList.toggle('mine', own);
    root.classList.toggle('theirs', !own);
    root.classList.toggle('pending', message.status === 'pending');
    root.classList.toggle('error', message.status === 'error');
    root.classList.toggle('selected', selected);
    root.dataset.messageKey = messageKey(message) || '';

    const startSelectTimer = () => {
      if (pressTimer) {
        window.clearTimeout(pressTimer);
      }
      longPressTriggered = false;
      pressTimer = window.setTimeout(() => {
        longPressTriggered = true;
        selectMessage(message);
      }, 650);
    };

    const cancelSelectTimer = () => {
      if (pressTimer) {
        window.clearTimeout(pressTimer);
        pressTimer = null;
      }
    };

    root.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }
      startSelectTimer();
    });

    root.addEventListener('pointerup', cancelSelectTimer);
    root.addEventListener('pointercancel', cancelSelectTimer);
    root.addEventListener('pointerleave', cancelSelectTimer);
    root.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      selectMessage(message);
    });
    root.addEventListener('click', () => {
      if (!state.selectedMessageKey && !longPressTriggered) {
        return;
      }
      if (!selected) {
        selectMessage(message);
        return;
      }
      if (!longPressTriggered) {
        return;
      }
    });

    if (message.type === 'image') {
      if (message.status === 'error' && !message.content) {
        const text = document.createElement('p');
        text.textContent = own ? 'Imagen no enviada (error de subida).' : 'Imagen no disponible.';
        body.appendChild(text);
        elements.chatLog.appendChild(fragment);
        continue;
      }
      const loading = document.createElement('p');
      loading.textContent = message.status === 'pending' ? 'Imagen pendiente...' : 'Cargando imagen...';
      body.appendChild(loading);
      renderImageMessage(message, body, loading, selected);
    } else if (message.type === 'audio') {
      if (message.status === 'error' && !message.content) {
        const text = document.createElement('p');
        text.textContent = own ? 'Audio no enviado (error de subida).' : 'Audio no disponible.';
        body.appendChild(text);
        elements.chatLog.appendChild(fragment);
        continue;
      }
      const loading = document.createElement('p');
      loading.textContent = message.status === 'pending' ? 'Audio pendiente...' : 'Cargando audio...';
      body.appendChild(loading);
      renderAudioMessage(message, body, loading, selected);
    } else {
      const textValue = String(message.display_content || message.content || '');
      const text = document.createElement('p');
      text.textContent = textValue;
      body.appendChild(text);

      const actions = document.createElement('div');
      actions.className = 'message-actions';

      const copyButton = document.createElement('button');
      copyButton.type = 'button';
      copyButton.className = 'button ghost message-edit';
      copyButton.textContent = 'Copiar mensaje';
      copyButton.addEventListener('click', () => {
        copyMessageText(textValue).catch((error) => {
          console.error(error);
          setComposerHint('No se pudo copiar el mensaje.');
        });
      });
      copyButton.hidden = !selected;
      actions.appendChild(copyButton);

      const locationText = extractLocationText(textValue);
      if (locationText) {
        const copyLocationButton = document.createElement('button');
        copyLocationButton.type = 'button';
        copyLocationButton.className = 'button ghost message-edit';
        copyLocationButton.textContent = 'Copiar ubicación';
        copyLocationButton.addEventListener('click', () => {
          copyMessageText(locationText, 'Ubicación copiada.').catch((error) => {
            console.error(error);
            setComposerHint('No se pudo copiar la ubicación.');
          });
        });
        copyLocationButton.hidden = !selected;
        actions.appendChild(copyLocationButton);
      }

      if (own) {
        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'button ghost message-edit';
        editButton.textContent = 'Editar';
        editButton.addEventListener('click', () => {
          editOwnTextMessage(message).catch((error) => {
            console.error(error);
            setComposerHint('No se pudo editar el mensaje.');
          });
        });
        editButton.hidden = !selected;
        actions.appendChild(editButton);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'button ghost message-edit';
        deleteButton.textContent = 'Eliminar';
        deleteButton.addEventListener('click', () => {
          deleteOwnTextMessage(message).catch((error) => {
            console.error(error);
            setComposerHint('No se pudo eliminar el mensaje.');
          });
        });
        deleteButton.hidden = !selected;
        actions.appendChild(deleteButton);
      }

      actions.hidden = !selected;
      body.appendChild(actions);
    }

    elements.chatLog.appendChild(fragment);
  }
  renderSelectedMessageQuickMenu();
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
}

function renderSelectedMessageQuickMenu() {
  if (!elements.messageQuickMenu) {
    return;
  }
  const message = getSelectedMessage();
  if (!message) {
    elements.messageQuickMenu.hidden = true;
    elements.messageQuickMenu.setAttribute('aria-hidden', 'true');
    return;
  }

  const isMedia = message.type === 'image' || message.type === 'audio';
  const isOwn = isOwnMessage(message);
  const textValue = String(message.display_content || message.content || '');
  const locationText = isMedia ? '' : extractLocationText(textValue);
  const mediaRef = isMedia ? buildCopyableMediaReference(message) : '';

  if (elements.messageQuickCopy) {
    elements.messageQuickCopy.hidden = isMedia ? !mediaRef : !textValue.trim();
    elements.messageQuickCopy.textContent = isMedia ? 'Copiar enlace' : 'Copiar mensaje';
  }
  if (elements.messageQuickCopyLocation) {
    elements.messageQuickCopyLocation.hidden = !locationText;
  }
  if (elements.messageQuickCopyMedia) {
    elements.messageQuickCopyMedia.hidden = !mediaRef;
  }
  if (elements.messageQuickEdit) {
    elements.messageQuickEdit.hidden = !(isOwn && !isMedia);
  }
  if (elements.messageQuickDelete) {
    elements.messageQuickDelete.hidden = !isOwn;
    elements.messageQuickDelete.textContent = isOwn && isMedia && message.status === 'pending'
      ? 'Cancelar envío'
      : 'Eliminar';
  }

  elements.messageQuickMenu.hidden = false;
  elements.messageQuickMenu.setAttribute('aria-hidden', 'false');
}

function buildStatusLabel(message) {
  return buildMessageStatusInfo(message).label;
}

function buildMessageStatusInfo(message) {
  if (!isOwnMessage(message)) {
    return {
      state: message.status === 'read' ? 'read' : 'received',
      label: message.status === 'read' ? 'visto' : 'recibido'
    };
  }
  if ((message.type === 'image' || message.type === 'audio') && message.status === 'pending') {
    if (message.type === 'audio' && Number(message.duration_ms || 0) > 0) {
      const sent = Number(message.chunks_sent || 0);
      const total = Math.max(1, Number(message.chunks_total || 1));
      const uploadedSeconds = (sent / total) * (Number(message.duration_ms) / 1000);
      const totalSeconds = Number(message.duration_ms) / 1000;
      return {
        state: 'pending',
        label: `enviando audio ${formatSecondsLabel(uploadedSeconds)}/${formatSecondsLabel(totalSeconds)}`
      };
    }
    return {
      state: 'pending',
      label: `pendiente ${message.chunks_sent || 0}/${message.chunks_total || 0}`
    };
  }
  if (message.status === 'delivered') {
    return {
      state: 'delivered',
      label: '\u2713\u2713 entregado'
    };
  }
  if (message.status === 'read') {
    return {
      state: 'read',
      label: '\u2713\u2713 le\u00eddo'
    };
  }
  if (message.status === 'resumed' || message.status === 'sent') {
    return {
      state: 'sent',
      label: '\u2713 enviado'
    };
  }
  if (message.status === 'error') {
    return {
      state: 'error',
      label: 'error'
    };
  }
  // Own message confirmed in Supabase (has remote id) but with an unexpected status:
  // show as sent rather than hiding all feedback.
  if (message.id) {
    return {
      state: 'sent',
      label: '\u2713 enviado'
    };
  }
  return {
    state: 'pending',
    label: 'pendiente'
  };
}

async function renderImageMessage(message, container, loadingNode, selected = false) {
  try {
    // Check if message was soft-deleted
    if (message.deleted_at) {
      loadingNode.textContent = 'Imagen eliminada por el remitente';
      loadingNode.style.fontStyle = 'italic';
      loadingNode.style.color = 'var(--muted)';
      return;
    }

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
    const actions = document.createElement('div');
    actions.className = 'image-actions';

    const downloadButton = document.createElement('button');
    downloadButton.type = 'button';
    downloadButton.className = 'button ghost button-icon image-download';
    downloadButton.innerHTML = '<span class="icon">⇩</span><span>Descargar imagen</span>';
    downloadButton.addEventListener('click', async () => {
      await downloadMediaAsset(message, src, 'imagen');
    });

    actions.appendChild(downloadButton);

    if (isOwnMessage(message)) {
      const controlButton = document.createElement('button');
      controlButton.type = 'button';
      controlButton.className = 'button ghost image-cancel';
      controlButton.textContent = message.status === 'pending' ? 'Cancelar envio' : 'Eliminar del chat';
      controlButton.addEventListener('click', () => {
        cancelOrRemoveOwnMedia(message).catch((error) => {
          console.error(error);
          setComposerHint('No se pudo completar la accion sobre la imagen.');
        });
      });
      controlButton.hidden = !selected;
      actions.appendChild(controlButton);
    }

    const frame = document.createElement('div');
    frame.className = 'image-frame';
    frame.appendChild(image);

    if (isOwnMessage(message) && message.status === 'pending' && Number(message.chunks_total || 0) > 0) {
      const progressWrap = document.createElement('div');
      progressWrap.className = 'upload-progress';
      const progressBar = document.createElement('div');
      progressBar.className = 'upload-progress-bar';
      const sent = Number(message.chunks_sent || 0);
      const total = Math.max(1, Number(message.chunks_total || 1));
      const percent = Math.max(0, Math.min(100, Math.round((sent / total) * 100)));
      progressBar.style.width = `${percent}%`;
      progressWrap.appendChild(progressBar);
      frame.appendChild(progressWrap);

      const progressText = document.createElement('small');
      progressText.className = 'upload-progress-text';
      const totalSeconds = Number(message.duration_ms || 0) / 1000;
      const uploadedSeconds = totalSeconds > 0 ? (sent / total) * totalSeconds : 0;
      progressText.textContent = totalSeconds > 0
        ? `Enviando ${formatSecondsLabel(uploadedSeconds)} de ${formatSecondsLabel(totalSeconds)} (${percent}%)`
        : `Subiendo ${sent}/${total} (${percent}%)`;
      frame.appendChild(progressText);
    }

    frame.appendChild(actions);

    loadingNode.replaceWith(frame);

  } catch (error) {
    loadingNode.textContent = 'Imagen atrasada. Reintentando...';
    scheduleImageRetry(message);
    console.error(error);
  }
}

async function renderAudioMessage(message, container, loadingNode, selected = false) {
  try {
    // Check if message was soft-deleted
    if (message.deleted_at) {
      loadingNode.textContent = 'Audio eliminado por el remitente';
      loadingNode.style.fontStyle = 'italic';
      loadingNode.style.color = 'var(--muted)';
      return;
    }

    let src = message.previewUrl || '';
    if (!src && message.content) {
      src = await resolveAudioSource(message.content);
    }
    if (!src) {
      loadingNode.textContent = 'Audio en cola';
      return;
    }

    const frame = document.createElement('div');
    frame.className = 'image-frame';

    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'auto';
    audio.src = src;
    frame.appendChild(audio);

    if (Number(message.duration_ms || 0) > 0) {
      const duration = document.createElement('small');
      duration.className = 'upload-progress-text';
      duration.textContent = `Duración ${Math.round(Number(message.duration_ms) / 1000)}s`;
      frame.appendChild(duration);
    }

    if (isOwnMessage(message) && message.status === 'pending' && Number(message.chunks_total || 0) > 0) {
      const progressWrap = document.createElement('div');
      progressWrap.className = 'upload-progress';
      const progressBar = document.createElement('div');
      progressBar.className = 'upload-progress-bar';
      const sent = Number(message.chunks_sent || 0);
      const total = Math.max(1, Number(message.chunks_total || 1));
      const percent = Math.max(0, Math.min(100, Math.round((sent / total) * 100)));
      progressBar.style.width = `${percent}%`;
      progressWrap.appendChild(progressBar);
      frame.appendChild(progressWrap);

      const progressText = document.createElement('small');
      progressText.className = 'upload-progress-text';
      progressText.textContent = `Subiendo ${sent}/${total} (${percent}%)`;
      frame.appendChild(progressText);
    }

    const actions = document.createElement('div');
    actions.className = 'image-actions';

    const downloadButton = document.createElement('button');
    downloadButton.type = 'button';
    downloadButton.className = 'button ghost button-icon image-download';
    downloadButton.innerHTML = '<span class="icon">⇩</span><span>Descargar audio</span>';
    downloadButton.addEventListener('click', async () => {
      await downloadMediaAsset(message, src, 'audio');
    });
    actions.appendChild(downloadButton);

    if (isOwnMessage(message)) {
      const controlButton = document.createElement('button');
      controlButton.type = 'button';
      controlButton.className = 'button ghost image-cancel';
      controlButton.textContent = message.status === 'pending' ? 'Cancelar envio' : 'Eliminar del chat';
      controlButton.addEventListener('click', () => {
        cancelOrRemoveOwnMedia(message).catch((error) => {
          console.error(error);
          setComposerHint('No se pudo completar la accion sobre el audio.');
        });
      });
      controlButton.hidden = !selected;
      actions.appendChild(controlButton);
    }

    frame.appendChild(actions);
    loadingNode.replaceWith(frame);
  } catch (error) {
    loadingNode.textContent = 'Audio atrasado. Reintentando...';
    scheduleImageRetry(message);
    console.error(error);
  }
}

async function downloadMediaAsset(message, src, label) {
  try {
    const isAudio = message.type === 'audio';
    const resolved = src || (message.content
      ? (isAudio ? await resolveAudioSource(message.content) : await resolveImageSource(message.content))
      : '');
    if (!resolved) {
      throw new Error(`No hay ${label} para descargar`);
    }
    const anchor = document.createElement('a');
    anchor.href = resolved;
    anchor.download = `${label}-${message.local_id || message.id || Date.now()}${isAudio ? '.webm' : '.jpg'}`;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } catch (error) {
    console.error(error);
    setComposerHint(`No se pudo descargar ${label}. Intenta de nuevo.`);
  }
}

async function downloadImageAsset(message, src) {
  return downloadMediaAsset(message, src, 'imagen');
}

async function copyMessageText(rawText, successHint = 'Mensaje copiado.') {
  const text = String(rawText || '').trim();
  if (!text) {
    setComposerHint('No hay contenido para copiar.');
    return;
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    setComposerHint(successHint);
    return;
  }

  const fallback = document.createElement('textarea');
  fallback.value = text;
  fallback.setAttribute('readonly', '');
  fallback.style.position = 'fixed';
  fallback.style.top = '-9999px';
  fallback.style.opacity = '0';
  document.body.appendChild(fallback);
  fallback.select();
  const copied = document.execCommand('copy');
  fallback.remove();
  if (!copied) {
    throw new Error('No se pudo copiar usando fallback');
  }
  setComposerHint(successHint);
}

function extractLocationText(textValue) {
  const text = String(textValue || '');
  if (!text) {
    return '';
  }

  const mapUrlMatch = text.match(/https?:\/\/\S+/i);
  if (mapUrlMatch && /maps|mapa|google\.com\/maps/i.test(mapUrlMatch[0])) {
    return mapUrlMatch[0];
  }

  const coordMatch = text.match(/(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (coordMatch) {
    return `${coordMatch[1]}, ${coordMatch[2]}`;
  }

  return '';
}

function buildCopyableMediaReference(message) {
  if (!message) {
    return '';
  }

  const direct = String(message.previewUrl || message.content || '').trim();
  if (/^https?:\/\//i.test(direct)) {
    return direct;
  }

  if (!direct) {
    return '';
  }

  const baseUrl = String(state.config.supabaseUrl || '').trim().replace(/\/$/, '');
  const bucket = String(state.config.bucketName || defaultConfig.bucketName || '').trim();
  if (!baseUrl || !bucket) {
    return direct;
  }

  const encodedPath = direct
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${baseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodedPath}`;
}

async function autoSaveReceivedImage(message, src) {
  const key = messageKey(message);
  if (!key || state.autoSavedImages.has(key)) {
    return;
  }
  state.autoSavedImages.add(key);
  persistAutoSavedImages();
}

function scheduleImageRetry(message) {
  const key = message.local_id || message.id || message.content;
  if (!key || state.imageRetryTimers.has(key)) {
    return;
  }
  const timer = window.setTimeout(() => {
    state.imageRetryTimers.delete(key);
    if (state.online && isConfigured()) {
      refreshHistory({ silent: true });
    }
  }, 4500);
  state.imageRetryTimers.set(key, timer);
}

async function resolveImageSource(content) {
  return resolveChunkedAsset(content, 'image/jpeg', /\.(png|jpg|jpeg|gif|webp)$/i, 'No se pudo leer un bloque de imagen');
}

async function resolveAudioSource(content) {
  return resolveChunkedAsset(content, 'audio/webm', /\.(webm|ogg|mp3|m4a|wav)$/i, 'No se pudo leer un bloque de audio');
}

async function resolveChunkedAsset(content, fallbackContentType, inlinePattern, chunkErrorText) {
  if (imageCache.has(content)) {
    return imageCache.get(content);
  }
  if (content.startsWith('data:') || inlinePattern.test(content)) {
    imageCache.set(content, content);
    return content;
  }
  const manifest = await fetchJsonWithAuth(content);
  const expectsEncryptedChunks = Boolean(manifest.e2ee);
  let mediaE2EEKey = null;
  if (expectsEncryptedChunks) {
    mediaE2EEKey = await getE2EEKey();
  }
  const buffers = [];
  for (let index = 0; index < manifest.chunks.length; index += 1) {
    const partUrl = publicStorageUrl(manifest.chunks[index].path);
    const response = await fetchStorageChunk(partUrl);
    if (!response.ok) {
      throw new Error(chunkErrorText);
    }
    let arrayBuffer = await response.arrayBuffer();
    const actualHash = await sha256Hex(arrayBuffer);
    if (actualHash !== manifest.chunks[index].sha256) {
      throw new Error('Integridad de bloque inválida');
    }

    const chunkMeta = manifest.chunks[index] || {};
    const encryptedChunk = Boolean(expectsEncryptedChunks || chunkMeta.encrypted || chunkMeta.iv);
    if (encryptedChunk) {
      const ivBase64 = String(chunkMeta.iv || '');
      if (!ivBase64) {
        throw new Error('Bloque cifrado sin IV');
      }
      const key = mediaE2EEKey || await getE2EEKey();
      try {
        const plainBuffer = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: fromBase64ToBytes(ivBase64) },
          key,
          arrayBuffer
        );
        arrayBuffer = plainBuffer;
      } catch {
        throw new Error('No se pudo descifrar el archivo multimedia.');
      }
    }

    buffers.push(arrayBuffer);
  }
  const merged = mergeArrayBuffers(buffers);
  const blob = new Blob([merged], { type: manifest.contentType || fallbackContentType });
  const objectUrl = URL.createObjectURL(blob);
  imageCache.set(content, objectUrl);
  await dbPut(CACHE_STORE, { id: content, blob });
  return objectUrl;
}

async function fetchStorageChunk(partUrl) {
  const publicResponse = await fetch(partUrl, { cache: 'force-cache' });
  if (publicResponse.ok) {
    return publicResponse;
  }
  return fetch(partUrl, {
    cache: 'no-store',
    headers: {
      apikey: state.config.supabaseKey,
      Authorization: `Bearer ${state.config.supabaseKey}`
    }
  });
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
  const encoded = await encodeOutgoingText(text);
  const message = {
    local_id: createId('msg'),
    sender: state.config.senderId,
    type: 'text',
    content: encoded.wire,
    display_content: text,
    encrypted: encoded.encrypted,
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
  setComposerHint(state.online ? 'Enviando texto...' : 'Sin conexión. El texto quedó guardado localmente.');
  flushQueues();
}

async function editOwnTextMessage(message) {
  if (!message || message.type !== 'text' || !isOwnMessage(message)) {
    return;
  }

  const current = String(message.display_content || message.content || '');
  const edited = window.prompt('Editar mensaje', current);
  if (edited === null) {
    return;
  }

  const normalized = normalizeOutgoingText(edited);
  if (!normalized) {
    setComposerHint('El mensaje no puede quedar vacío.');
    return;
  }

  if (normalized === current) {
    return;
  }

  const encoded = await encodeOutgoingText(normalized);
  const localPatch = {
    ...message,
    content: encoded.wire,
    display_content: normalized,
    encrypted: encoded.encrypted
  };

  upsertMessage(localPatch);

  const queuedIndex = state.queuedTexts.findIndex((item) => item.local_id === message.local_id);
  if (queuedIndex >= 0) {
    state.queuedTexts[queuedIndex] = {
      ...state.queuedTexts[queuedIndex],
      content: encoded.wire,
      display_content: normalized,
      encrypted: encoded.encrypted
    };
    persistQueuedTexts();
    setComposerHint('Mensaje editado localmente. Se enviará en cuanto haya conexión.');
    return;
  }

  if (!isConfigured()) {
    setComposerHint('No se pudo sincronizar la edición: falta configuración.');
    return;
  }

  if (!state.online) {
    setComposerHint('Sin conexión. Solo se editó localmente.');
    return;
  }

  try {
    await updateMessageRemote(message.local_id, {
      content: encoded.wire
    });
    setComposerHint('Mensaje editado.');
  } catch (error) {
    console.error(error);
    setComposerHint('No se pudo sincronizar la edición del mensaje.');
  }
}

async function editLastOwnTextMessage() {
  const ownTextMessages = state.messages.filter((item) => item.type === 'text' && isOwnMessage(item));
  if (ownTextMessages.length === 0) {
    setComposerHint('No tienes mensajes de texto para editar.');
    return;
  }
  await editOwnTextMessage(ownTextMessages[ownTextMessages.length - 1]);
}

async function deleteOwnTextMessage(message) {
  if (!message || message.type !== 'text' || !isOwnMessage(message)) {
    return;
  }

  const messageRef = message.local_id || message.id;
  if (!messageRef) {
    return;
  }

  const queuedIndex = state.queuedTexts.findIndex((item) => item.local_id === message.local_id || item.local_id === message.id);
  if (queuedIndex >= 0) {
    state.queuedTexts.splice(queuedIndex, 1);
    persistQueuedTexts();
  }

  let deleteSuccess = false;
  if (state.online && isConfigured()) {
    try {
      await deleteMessageRemoteByRef(message);
      deleteSuccess = true;
    } catch (error) {
      await updateMessageRemoteByRef(message, {
        status: 'error',
        content: '',
        chunks_total: 0,
        chunks_sent: 0
      }).catch(() => {
      });
      setComposerHint('No se pudo eliminar el mensaje. Reintentar...');
      return;
    }
  } else {
    deleteSuccess = true;
  }

  if (deleteSuccess) {
    removeLocalMessage(messageRef);
    if (state.selectedMessageKey === messageRef || state.selectedMessageKey === message.local_id || state.selectedMessageKey === message.id) {
      state.selectedMessageKey = '';
    }
    updateQueueSize();
    setComposerHint('Mensaje eliminado del chat.');
  }
}

function removeLocalMessage(localIdOrId) {
  const index = state.messages.findIndex((item) => item.local_id === localIdOrId || item.id === localIdOrId);
  if (index < 0) {
    return null;
  }
  const [removed] = state.messages.splice(index, 1);
  persistMessages();
  renderMessages();
  return removed;
}

async function cancelOrRemoveOwnImage(message) {
  return cancelOrRemoveOwnMedia(message);
}

async function cancelOrRemoveOwnMedia(message) {
  if (!message || (message.type !== 'image' && message.type !== 'audio') || !isOwnMessage(message)) {
    return;
  }

  const messageRef = message.local_id || message.id;
  if (!messageRef) {
    return;
  }

  const isPending = message.status === 'pending';
  state.canceledUploadIds.add(messageRef);

  const retryKey = message.local_id || message.id || message.content;
  const retryTimer = state.imageRetryTimers.get(retryKey);
  if (retryTimer) {
    window.clearTimeout(retryTimer);
    state.imageRetryTimers.delete(retryKey);
  }

  if (message.local_id) {
    await dbDelete(UPLOAD_STORE, message.local_id);
  }

  if (message.content) {
    await deleteOwnMediaAssets(message).catch((error) => {
      console.error(error);
    });

    imageCache.delete(message.content);
    try {
      await dbDelete(CACHE_STORE, message.content);
    } catch (error) {
      console.error(error);
    }
  }

  let deleteSuccess = false;
  if (state.online && isConfigured()) {
    try {
      // Hard delete the media message so it disappears from chat for both users.
      await deleteMessageRemoteByRef(message);
      deleteSuccess = true;
    } catch (error) {
      try {
        // Fallback for environments where direct delete is blocked or fails.
        await updateMessageRemoteByRef(message, {
          deleted_at: new Date().toISOString(),
          content: '',
          chunks_total: 0,
          chunks_sent: 0
        });
        deleteSuccess = true;
      } catch (_fallbackError) {
        await updateMessageRemoteByRef(message, {
          status: 'error',
          content: '',
          chunks_total: 0,
          chunks_sent: 0
        }).catch(() => {
        });
        setComposerHint(message.type === 'audio'
          ? 'No se pudo eliminar el audio. Reintentar...'
          : 'No se pudo eliminar la imagen. Reintentar...');
        return;
      }
    }
  } else {
    deleteSuccess = true;
  }

  if (deleteSuccess) {
    // Remove immediately from local UI to respect the delete action.
    removeLocalMessage(messageRef);
    updateQueueSize();
    if (message.type === 'audio') {
      setComposerHint(isPending ? 'Envio de audio cancelado.' : 'Audio eliminado del chat.');
    } else {
      setComposerHint(isPending ? 'Envio de imagen cancelado.' : 'Imagen eliminada del chat.');
    }
  }
}

async function showImageDraftPanel(file, extraFiles = []) {
  if (!isConfigured()) {
    setComposerHint('Configura Supabase antes de enviar imágenes.');
    return;
  }
  const targetKb = getTargetImageKb();
  setComposerHint(`Comprimiendo imagen a menos de ${targetKb} KB...`);

  try {
    const prepared = await prepareImageDraftItem(file);

    state.imageDraftFile = file;
    state.imageDraftQueue = extraFiles.map((nextFile) => ({ file: nextFile }));
    state.imageDraft = prepared;

    const canvas = await getCanvasFromImageFile(prepared.compressed);
    elements.draftImagePreview.src = prepared.previewUrl;
    elements.draftSize.textContent = `${Math.ceil(prepared.compressed.size / 1024)} KB`;
    elements.draftResolution.textContent = `${canvas.width} × ${canvas.height}`;
    elements.draftMode.textContent = state.mode;

    const estimatedSeconds = estimateUploadTime(prepared.compressed.size);
    elements.draftEstimate.textContent = estimatedSeconds > 0 ? `~${estimatedSeconds}s` : 'Bajo demanda';
    if (elements.draftQueueCount) {
      elements.draftQueueCount.textContent = String(state.imageDraftQueue.length);
    }

    elements.imageDraftPanel.hidden = false;
    if (extraFiles.length > 0) {
      setComposerHint(`Listo para enviar. Hay ${extraFiles.length + 1} imágenes en cola.`);
    } else {
      setComposerHint('Listo para enviar. Toca "Enviar imagen" para comenzar el upload.');
    }
  } catch (error) {
    console.error(error);
    setComposerHint('Error al procesar imagen. Intenta otra.');
  }
}

const showImageDrafPanel = showImageDraftPanel;

async function prepareImageDraftItem(file) {
  const targetKb = getTargetImageKb();
  const compressed = await compressImage(file, targetKb, getMaxDimensionForMode());
  const previewUrl = URL.createObjectURL(compressed);
  const localId = createId('img');
  const chunks = await buildChunkManifest(compressed, localId);
  return {
    compressed,
    previewUrl,
    targetKb,
    fileName: file.name,
    originalSize: file.size,
    localId,
    chunks
  };
}

async function prepareImageQueueItems(queueItems) {
  const total = queueItems.length;
  for (let index = 0; index < total; index += 1) {
    const item = queueItems[index];
    if (!item || !item.file || item.prepared) {
      continue;
    }
    setComposerHint(`Preparando imágenes ${index + 1}/${total}...`);
    item.prepared = await prepareImageDraftItem(item.file);
  }
}

async function processImageSendQueue() {
  if (state.uploadPumpRunning) {
    return;
  }

  state.uploadPumpRunning = true;
  try {
    await prepareImageQueueItems(state.imageDraftQueue);

    const total = state.imageDraftQueue.length;
    let processed = 0;
    while (state.imageDraftQueue.length > 0) {
      const next = state.imageDraftQueue.shift();
      if (!next || !next.file) {
        continue;
      }

      if (next.prepared) {
        state.imageDraft = next.prepared;
        state.imageDraftFile = next.file;
      } else {
        state.imageDraft = null;
        state.imageDraftFile = null;
      }

      const localId = await enqueueImageMessage(next.file);
      if (localId) {
        await waitForImageUploadSettle(localId);
      }

      processed += 1;
      if (total > 1 && processed < total) {
        setComposerHint(`Cola de imágenes: ${processed}/${total} completadas...`);
      }
    }
  } finally {
    state.uploadPumpRunning = false;
    state.imageDraft = null;
    state.imageDraftFile = null;
  }
}

async function waitForImageUploadSettle(localId, timeoutMs = 240000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const message = state.messages.find((item) => item.local_id === localId);
    if (!message) {
      return 'removed';
    }

    if (message.status === 'sent' || message.status === 'read' || message.status === 'delivered') {
      return message.status;
    }
    if (message.status === 'error') {
      return 'error';
    }

    await new Promise((resolve) => window.setTimeout(resolve, 280));
  }
  return 'timeout';
}

function closImageDraftPanel() {
  if (state.imageDraft && state.imageDraft.previewUrl) {
    URL.revokeObjectURL(state.imageDraft.previewUrl);
  }
  state.imageDraft = null;
  state.imageDraftFile = null;
  elements.imageDraftPanel.hidden = true;
  elements.draftImagePreview.src = '';
}

async function getCanvasFromImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        resolve(canvas);
      };
      img.onerror = reject;
      img.src = event.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function estimateUploadTime(sizeBytes) {
  if (!state.online || state.kbps === 0) {
    return 0;
  }
  const sizeKbps = (sizeBytes * 8) / 1024;
  const seconds = Math.ceil(sizeKbps / state.kbps);
  return Math.min(seconds, 999);
}

async function enqueueImageMessage(file) {
  if (!isConfigured()) {
    setComposerHint('Configura Supabase antes de enviar imágenes.');
    return '';
  }
  let compressed;
  let chunks;
  let localId;
  let previewUrl;

  if (state.imageDraft && state.imageDraft.chunks) {
    compressed = state.imageDraft.compressed;
    chunks = state.imageDraft.chunks;
    localId = state.imageDraft.localId;
    previewUrl = state.imageDraft.previewUrl;
    setComposerHint('Iniciando upload de imagen...');
  } else {
    const targetKb = getTargetImageKb();
    setComposerHint(`Comprimiendo imagen a menos de ${targetKb} KB...`);
    compressed = await compressImage(file, targetKb, getMaxDimensionForMode());
    localId = createId('img');
    previewUrl = URL.createObjectURL(compressed);
    setComposerHint('Preparando chunks de imagen...');
    chunks = await buildChunkManifest(compressed, localId);
  }

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
    type: 'image',
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

  state.canceledUploadIds.delete(localId);
  await dbPut(UPLOAD_STORE, uploadJob);
  await insertPendingMediaMessage(message, uploadJob);
  updateQueueSize();
  processUploadJob(uploadJob).catch((error) => {
    console.error(error);
    scheduleUploadRetry(uploadJob, error).catch((nestedError) => console.error(nestedError));
  });

  return localId;
}

async function enqueueAudioMessage(blob, metadata = {}) {
  if (!isConfigured()) {
    setComposerHint('Configura Supabase antes de enviar audio.');
    return '';
  }

  const localId = createId('aud');
  const chunks = await buildChunkManifest(blob, localId);
  const previewUrl = URL.createObjectURL(blob);
  const durationMs = Math.max(1, Number(metadata.durationMs || 0));
  const contentType = metadata.contentType || blob.type || 'audio/webm';
  const fileName = metadata.fileName || `nota-${Date.now()}.webm`;
  const audioBitrateKbps = Math.max(1, Number(metadata.audioBitrateKbps || 0));

  const message = {
    local_id: localId,
    sender: state.config.senderId,
    type: 'audio',
    content: '',
    timestamp: new Date().toISOString(),
    status: 'pending',
    chunks_total: chunks.length,
    chunks_sent: 0,
    session_id: state.config.sessionId,
    previewUrl,
    duration_ms: durationMs
  };
  upsertMessage(message);

  const uploadJob = {
    id: localId,
    type: 'audio',
    fileName,
    contentType,
    size: blob.size,
    createdAt: message.timestamp,
    sessionId: state.config.sessionId,
    sender: state.config.senderId,
    uploadedIndices: [],
    chunks,
    remoteInserted: false,
    previewUrl,
    resumed: false,
    durationMs,
    audioBitrateKbps
  };

  state.canceledUploadIds.delete(localId);
  await dbPut(UPLOAD_STORE, uploadJob);
  await insertPendingMediaMessage(message, uploadJob);
  updateQueueSize();
  processUploadJob(uploadJob).catch((error) => {
    console.error(error);
    scheduleUploadRetry(uploadJob, error).catch((nestedError) => console.error(nestedError));
  });
  if (audioBitrateKbps > 0) {
    setComposerHint(`Nota de voz en cola (${audioBitrateKbps} kbps).`);
  } else {
    setComposerHint('Nota de voz en cola.');
  }
  return localId;
}

async function insertPendingImageMessage(message, uploadJob) {
  return insertPendingMediaMessage(message, uploadJob);
}

async function insertPendingMediaMessage(message, uploadJob) {
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
  const shouldEncrypt = isE2EEEnabled();
  let e2eeKey = null;
  if (shouldEncrypt) {
    if (!await ensureE2EEUnlocked(true)) {
      throw new Error('Debes desbloquear E2E para enviar multimedia cifrada.');
    }
    e2eeKey = await getE2EEKey();
  }

  for (let offset = 0, index = 0; offset < blob.size; offset += CHUNK_SIZE, index += 1) {
    const part = blob.slice(offset, offset + CHUNK_SIZE, blob.type);
    const plainBuffer = await part.arrayBuffer();
    let payloadBuffer = plainBuffer;
    let payloadBlob = part;
    let ivBase64 = '';

    if (e2eeKey) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, e2eeKey, plainBuffer);
      payloadBuffer = cipherBuffer;
      payloadBlob = new Blob([payloadBuffer], { type: 'application/octet-stream' });
      ivBase64 = toBase64(iv);
    }

    const sha256 = await sha256Hex(payloadBuffer);
    chunks.push({
      index,
      blob: payloadBlob,
      size: payloadBlob.size,
      plain_size: part.size,
      sha256,
      encrypted: Boolean(e2eeKey),
      iv: ivBase64,
      path: `chunks/${state.config.sessionId}/${localId}/${String(index).padStart(6, '0')}.part`
    });
  }
  return chunks;
}

async function processUploadJob(job) {
  if (!state.online || !isConfigured()) {
    return;
  }
  if (state.canceledUploadIds.has(job.id)) {
    clearUploadRetryTimer(job.id);
    await dbDelete(UPLOAD_STORE, job.id);
    return;
  }
  let liveJob = await dbGet(UPLOAD_STORE, job.id);
  if (!liveJob) {
    return;
  }
  const mediaType = liveJob.type === 'audio' ? 'audio' : 'image';
  for (const chunk of liveJob.chunks) {
    if (state.canceledUploadIds.has(liveJob.id)) {
      clearUploadRetryTimer(liveJob.id);
      await dbDelete(UPLOAD_STORE, liveJob.id);
      return;
    }
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
    await uploadFileToStorage(chunk.path, chunk.blob);
    liveJob.uploadedIndices.push(chunk.index);
    liveJob.resumed = liveJob.uploadedIndices.length > 1;
    await dbPut(UPLOAD_STORE, liveJob);
    await patchMediaProgress(liveJob);
  }

  const manifest = {
    version: 1,
    type: `chunked-${mediaType}`,
    e2ee: liveJob.chunks.some((chunk) => chunk.encrypted),
    sessionId: liveJob.sessionId,
    sender: liveJob.sender,
    localId: liveJob.id,
    createdAt: liveJob.createdAt,
    contentType: liveJob.contentType,
    size: liveJob.size,
    durationMs: Number(liveJob.durationMs || 0),
    chunks: liveJob.chunks.map((chunk) => ({
      index: chunk.index,
      path: chunk.path,
      size: chunk.size,
      plain_size: Number(chunk.plain_size || 0),
      sha256: chunk.sha256,
      encrypted: Boolean(chunk.encrypted),
      iv: chunk.iv || ''
    }))
  };

  const manifestPath = `manifests/${liveJob.sessionId}/${liveJob.id}.json`;
  const manifestBlob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  await uploadFileToStorage(manifestPath, manifestBlob);

  if (state.canceledUploadIds.has(liveJob.id)) {
    clearUploadRetryTimer(liveJob.id);
    await dbDelete(UPLOAD_STORE, liveJob.id);
    return;
  }
  const manifestUrl = publicStorageUrl(manifestPath);
  await finalizeMediaMessage(liveJob.id, manifestUrl, liveJob.chunks.length, mediaType, Number(liveJob.durationMs || 0));
  clearUploadRetryTimer(liveJob.id);
  await dbDelete(UPLOAD_STORE, liveJob.id);
  state.canceledUploadIds.delete(liveJob.id);
  updateQueueSize();
  if (mediaType === 'audio') {
    setComposerHint(liveJob.resumed ? 'Audio enviado tras reanudar la subida.' : 'Audio enviado.');
  } else {
    setComposerHint(liveJob.resumed ? 'Imagen enviada tras reanudar la subida.' : 'Imagen enviada.');
  }
}

async function patchImageProgress(job) {
  return patchMediaProgress(job);
}

async function patchMediaProgress(job) {
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

async function finalizeImageMessage(localId, manifestUrl, totalChunks) {
  return finalizeMediaMessage(localId, manifestUrl, totalChunks, 'image', 0);
}

async function finalizeMediaMessage(localId, manifestUrl, totalChunks, mediaType, durationMs = 0) {
  const localMessage = state.messages.find((item) => item.local_id === localId);
  if (localMessage) {
    upsertMessage({
      ...localMessage,
      content: manifestUrl,
      status: 'sent',
      chunks_sent: totalChunks,
      chunks_total: totalChunks,
      duration_ms: durationMs || localMessage.duration_ms || 0
    });
    // CRITICAL: Save to localStorage so image persists after reload
    persistMessages();
  }

  const payload = {
    sender: state.config.senderId,
    type: mediaType,
    content: manifestUrl,
    timestamp: localMessage ? localMessage.timestamp : new Date().toISOString(),
    status: 'sent',
    chunks_total: totalChunks,
    chunks_sent: totalChunks,
    session_id: state.config.sessionId,
    local_id: localId
  };
  if (mediaType === 'audio') {
    payload.duration_ms = Number(durationMs || 0);
  }

  try {
    await upsertMessageRemote(payload);
  } catch {
    await updateMessageRemote(localId, payload).catch(async () => {
      await insertMessageRemote(payload);
    });
  }
}

async function upsertMessageRemote(message) {
  const url = `${state.config.supabaseUrl}/rest/v1/messages?on_conflict=session_id,local_id`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...supabaseHeaders(),
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify([message])
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const rows = await response.json();
  if (rows[0]) {
    const hydrated = await hydrateIncomingMessage(rows[0]);
    upsertMessage(hydrated);
  }
}

function markMessageError(localId) {
  const message = state.messages.find((item) => item.local_id === localId);
  if (message) {
    upsertMessage({ ...message, status: 'error' });
  }
}

function markMessagePending(localId) {
  const message = state.messages.find((item) => item.local_id === localId);
  if (message) {
    upsertMessage({ ...message, status: 'pending' });
  }
}

function clearUploadRetryTimer(jobId) {
  const timer = state.uploadRetryTimers.get(jobId);
  if (!timer) {
    return;
  }
  window.clearTimeout(timer);
  state.uploadRetryTimers.delete(jobId);
}

async function scheduleUploadRetry(jobOrId, sourceError) {
  const jobId = typeof jobOrId === 'string' ? jobOrId : jobOrId.id;
  if (!jobId || state.canceledUploadIds.has(jobId)) {
    return;
  }
  if (state.uploadRetryTimers.has(jobId)) {
    return;
  }

  const liveJob = await dbGet(UPLOAD_STORE, jobId);
  if (!liveJob) {
    return;
  }

  const retryCount = Number(liveJob.retryCount || 0);
  if (IMAGE_UPLOAD_MAX_RETRIES > 0 && retryCount >= IMAGE_UPLOAD_MAX_RETRIES) {
    clearUploadRetryTimer(jobId);
    markMessageError(jobId);
    const failedMessage = state.messages.find((item) => item.local_id === jobId);
    const mediaLabel = failedMessage && failedMessage.type === 'audio' ? 'audio' : 'imagen';
    setComposerHint(`No se pudo subir el ${mediaLabel} tras varios intentos. Revisa bucket/policies de Storage y vuelve a intentar.`);
    return;
  }

  const nextRetryCount = retryCount + 1;
  liveJob.retryCount = nextRetryCount;
  await dbPut(UPLOAD_STORE, liveJob);
  markMessagePending(jobId);

  const waitMs = Math.min(IMAGE_UPLOAD_RETRY_MAX_MS, IMAGE_UPLOAD_RETRY_BASE_MS * (2 ** Math.max(0, nextRetryCount - 1)));
  const timer = window.setTimeout(async () => {
    state.uploadRetryTimers.delete(jobId);
    if (!state.online || !isConfigured() || state.canceledUploadIds.has(jobId)) {
      return;
    }
    const latest = await dbGet(UPLOAD_STORE, jobId);
    if (!latest) {
      return;
    }
    processUploadJob(latest).catch((error) => {
      console.error(error);
      scheduleUploadRetry(jobId, error).catch((nestedError) => console.error(nestedError));
    });
  }, waitMs);

  state.uploadRetryTimers.set(jobId, timer);
  const pendingMessage = state.messages.find((item) => item.local_id === jobId);
  const mediaLabel = pendingMessage && pendingMessage.type === 'audio' ? 'audio' : 'imagen';
  setComposerHint(`Reintentando ${mediaLabel} en ${Math.ceil(waitMs / 1000)}s...`);
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
      setComposerHint('No se pudo enviar la cola. Revisa las políticas de Supabase.');
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
      scheduleUploadRetry(job, error).catch((nestedError) => console.error(nestedError));
    });
  }
  updateQueueSize();
}

async function refreshHistory(options = {}) {
  const { silent = false, older = false, all = false } = options;
  if (!isConfigured()) {
    return;
  }
  try {
    const fetched = all
      ? await fetchMessagesRemote({ all: true })
      : await fetchMessagesRemote({ older, limit: HISTORY_PAGE_SIZE + 1 });
    const hasMore = !all && fetched.length > HISTORY_PAGE_SIZE;
    const remoteMessages = hasMore ? fetched.slice(0, HISTORY_PAGE_SIZE) : fetched;
    const remoteLocalIds = new Set();
    
    // Insert messages quickly WITHOUT waiting for full hydration
    // This makes the UI feel responsive even with E2E decoding overhead
    for (const rawMessage of remoteMessages) {
      if (rawMessage.id) {
        state.knownRemoteIds.add(rawMessage.id);
      }
      const tempMessageId = rawMessage.local_id || rawMessage.id || `${Date.now()}-${Math.random()}`;
      if (tempMessageId) {
        remoteLocalIds.add(tempMessageId);
      }
      // Upsert without awaiting full hydration
      upsertMessage(rawMessage);
      syncMessageReceipt(rawMessage);
    }
    
    // Start E2E decoding in background (non-blocking)
    if (remoteMessages.length > 0) {
      hydrateMessagesBackground(remoteMessages).catch((error) => {
        console.error('Background hydration error:', error);
      });
    }
    
    if (all) {
      pruneMissingSessionMessages(remoteLocalIds);
    }
    if (remoteMessages.length > 0) {
      const ordered = remoteMessages
        .map((item) => item.timestamp)
        .filter(Boolean)
        .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
      if (ordered.length > 0) {
        state.historyOldestTimestamp = ordered[0];
      }
    }
    if (all) {
      state.historyHasMore = false;
    } else if (remoteMessages.length === 0) {
      state.historyHasMore = false;
    } else {
      state.historyHasMore = hasMore;
    }
    persistKnownRemoteIds();
    state.lastSyncAt = new Date().toISOString();
    updateSyncSummary();
    
    // Render NOW with unhydrated messages (text shows raw/encrypted)
    renderMessages();
    
    if (!silent) {
      setComposerHint(all ? 'Historial completo cargado.' : 'Historial reciente cargado.');
    }
  } catch (error) {
    console.error(error);
    if (!silent) {
      setComposerHint('No se pudo cargar el historial.');
    }
  }
}

async function hydrateMessagesBackground(rawMessages) {
  // Hydrate messages in background without blocking
  for (const rawMessage of rawMessages) {
    try {
      const hydrated = await hydrateIncomingMessage(rawMessage);
      // Update the message with decrypted content if it changed
      if (hydrated.display_content !== rawMessage.display_content) {
        upsertMessage(hydrated);
        renderMessages(); // Re-render to show decrypted content
      }
    } catch (error) {
      console.error('Error hydrating message:', error);
    }
  }
}

async function fetchMessagesRemote(options = {}) {
  const { older = false, all = false, limit = HISTORY_PAGE_SIZE } = options;
  const filter = encodeURIComponent(`session_id=eq.${state.config.sessionId}`);
  const parts = [`select=*`, filter];
  if (!all) {
    if (older && state.historyOldestTimestamp) {
      parts.push(`timestamp=lt.${encodeURIComponent(state.historyOldestTimestamp)}`);
    }
    parts.push('order=timestamp.desc');
    parts.push(`limit=${encodeURIComponent(String(limit))}`);
  } else {
    parts.push('order=timestamp.asc');
  }
  const url = `${state.config.supabaseUrl}/rest/v1/messages?${parts.join('&')}`;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), HISTORY_FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      headers: supabaseHeaders(),
      signal: controller.signal
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error('Timeout al leer mensajes de Supabase');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
  if (!response.ok) {
    throw new Error('Fallo al leer mensajes');
  }
  const rows = await response.json();
  return all ? rows : rows.reverse();
}

async function fetchMessagesForResetFallback() {
  const filter = encodeURIComponent(`session_id=eq.${state.config.sessionId}`);
  const url = `${state.config.supabaseUrl}/rest/v1/messages?select=type,content&${filter}`;
  const response = await fetch(url, {
    headers: supabaseHeaders()
  });
  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`No se pudo consultar mensajes para reset REST: HTTP ${response.status} ${raw}`);
  }
  return response.json();
}

async function resetCurrentRoomForAll() {
  if (!isConfigured()) {
    setComposerHint('Configura Supabase antes de reiniciar la sala.');
    return;
  }

  const actor = normalizeIdentity(state.config.senderId || state.identity);
  if (actor !== 'roberto') {
    setComposerHint('Solo Roberto puede reiniciar la sala para todos.');
    return;
  }

  const confirmed = window.confirm(`Esto borrará para TODOS la sala "${state.config.sessionId}". ¿Continuar?`);
  if (!confirmed) {
    setComposerHint('Reinicio de sala cancelado.');
    return;
  }

  const phrase = window.prompt('Escribe BORRAR para confirmar el reinicio total de la sala:');
  if (phrase !== 'BORRAR') {
    setComposerHint('Confirmación inválida. No se realizó el reinicio.');
    return;
  }

  setComposerLocked(true);
  try {
    const secureEndpoint = String(state.config.resetEndpoint || '').trim();
    let mode = 'REST';

    if (secureEndpoint) {
      setComposerHint(`Solicitando reinicio seguro vía función ${secureEndpoint}...`);
      await resetRoomViaFunction(secureEndpoint);
      mode = 'FUNCTION';
    } else {
      setComposerHint('Borrando historial e imágenes de la sala...');
      const remoteMessages = await fetchMessagesForResetFallback();
      for (const message of remoteMessages) {
        if (message && (message.type === 'image' || message.type === 'audio') && message.content) {
          try {
            await deleteOwnMediaAssets(message);
          } catch (error) {
            console.error(error);
          }
        }
      }

      const deleted = await deleteMessagesByCurrentSessionRemote();
      if (remoteMessages.length > 0 && deleted === 0) {
        throw new Error('DELETE ejecutado pero no eliminó filas. RLS probablemente bloquea la operación.');
      }
    }

    await clearCurrentRoomLocalState();
    await refreshHistory({ silent: true });
    setComposerHint(mode === 'FUNCTION'
      ? 'Sala reiniciada para todos (modo seguro por función).'
      : 'Sala reiniciada para todos (modo directo REST).');
  } catch (error) {
    console.error(error);
    const detail = formatSupabaseError(error);
    setComposerHint(`No se pudo reiniciar la sala: ${detail}`);
  } finally {
    setComposerLocked(false);
  }
}

async function resetRoomViaFunction(endpointName) {
  const url = `${state.config.supabaseUrl}/functions/v1/${endpointName}`;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), RESET_FUNCTION_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify({
        sender: state.config.senderId,
        session_id: state.config.sessionId,
        bucket_name: state.config.bucketName,
        admin_secret: state.config.resetAdminSecret || undefined,
        action: 'reset_room'
      }),
      signal: controller.signal
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error(`La función ${endpointName} tardó más de ${Math.round(RESET_FUNCTION_TIMEOUT_MS / 1000)}s.`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const raw = await response.text();
    if (response.status === 404) {
      throw new Error(`Función ${endpointName} no existe en Supabase (HTTP 404).`);
    }
    throw new Error(`Función ${endpointName} devolvió HTTP ${response.status}: ${raw}`);
  }
}

async function deleteMessagesByCurrentSessionRemote() {
  const url = `${state.config.supabaseUrl}/rest/v1/messages?session_id=eq.${encodeURIComponent(state.config.sessionId)}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      ...supabaseHeaders(),
      Prefer: 'return=representation'
    }
  });
  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${raw}`);
  }
  const raw = await response.text();
  if (!raw) {
    return 0;
  }
  try {
    const rows = JSON.parse(raw);
    return Array.isArray(rows) ? rows.length : 0;
  } catch (_error) {
    return 0;
  }
}

function formatSupabaseError(error) {
  if (!error) {
    return 'error desconocido.';
  }
  const text = String(error.message || error);
  if (text.includes('invalid admin secret')) {
    return 'clave admin inválida para reset. Verifica reset-admin-secret y RESET_ADMIN_SECRET.';
  }
  if (text.includes('HTTP 404')) {
    return 'endpoint de reset no encontrado. Revisa reset-endpoint y despliegue de la función.';
  }
  if (text.includes('timed out') || text.includes('tardó más de')) {
    return 'la función de reset excedió el tiempo de espera. Reintenta o revisa logs en Supabase.';
  }
  if (text.length > 220) {
    return `${text.slice(0, 220)}...`;
  }
  return text;
}

async function clearCurrentRoomLocalState() {
  state.messages = [];
  state.queuedTexts = [];
  state.knownRemoteIds = new Set();
  state.imageDraftQueue = [];
  state.imageDraft = null;
  state.imageDraftFile = null;
  clearVoiceRecordingState();
  state.canceledUploadIds.clear();

  for (const timer of state.imageRetryTimers.values()) {
    window.clearTimeout(timer);
  }
  state.imageRetryTimers.clear();

  for (const timer of state.uploadRetryTimers.values()) {
    window.clearTimeout(timer);
  }
  state.uploadRetryTimers.clear();

  persistMessages();
  persistQueuedTexts();
  persistKnownRemoteIds();
  closImageDraftPanel();
  imageCache.clear();
  await dbClear(UPLOAD_STORE);
  await dbClear(CACHE_STORE);
  updateQueueSize();
  updateSyncSummary();
  renderMessages();
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
    const hydrated = await hydrateIncomingMessage(rows[0]);
    state.knownRemoteIds.add(rows[0].id);
    persistKnownRemoteIds();
    upsertMessage(hydrated);
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
    const hydrated = await hydrateIncomingMessage(rows[0]);
    upsertMessage(hydrated);
  }
}

function buildMessageRemoteFilter(message) {
  if (!message || !state.config.sessionId) {
    return '';
  }
  if (message.local_id) {
    return `local_id=eq.${encodeURIComponent(message.local_id)}&session_id=eq.${encodeURIComponent(state.config.sessionId)}`;
  }
  if (message.id) {
    return `id=eq.${encodeURIComponent(message.id)}&session_id=eq.${encodeURIComponent(state.config.sessionId)}`;
  }
  return '';
}

async function updateMessageRemoteByRef(message, patch) {
  const filter = buildMessageRemoteFilter(message);
  if (!filter) {
    throw new Error('No hay identificador remoto para actualizar el mensaje');
  }
  const url = `${state.config.supabaseUrl}/rest/v1/messages?${filter}`;
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
    const hydrated = await hydrateIncomingMessage(rows[0]);
    upsertMessage(hydrated);
  }
}

async function deleteMessageRemoteByRef(message) {
  const filter = buildMessageRemoteFilter(message);
  if (!filter) {
    throw new Error('No hay identificador remoto para eliminar el mensaje');
  }
  const url = `${state.config.supabaseUrl}/rest/v1/messages?${filter}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      ...supabaseHeaders(),
      Prefer: 'return=representation'
    }
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

async function deleteMessageRemote(localId) {
  const url = `${state.config.supabaseUrl}/rest/v1/messages?local_id=eq.${encodeURIComponent(localId)}&session_id=eq.${encodeURIComponent(state.config.sessionId)}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      ...supabaseHeaders(),
      Prefer: 'return=representation'
    }
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

function removeMessageByRemoteRecord(record) {
  const key = record && (record.local_id || record.id);
  if (!key) {
    return;
  }
  const index = state.messages.findIndex((item) => item.local_id === key || item.id === key || (record.id && item.id === record.id));
  if (index < 0) {
    return;
  }
  state.messages.splice(index, 1);
  if (state.selectedMessageKey === key || state.selectedMessageKey === record.id) {
    state.selectedMessageKey = '';
  }
  persistMessages();
  renderMessages();
}

function pruneMissingSessionMessages(remoteLocalIds) {
  const before = state.messages.length;
  const queuedIds = new Set(state.queuedTexts.map((item) => item.local_id));
  state.messages = state.messages.filter((message) => {
    if (message.session_id !== state.config.sessionId) {
      return true;
    }
    if (!message.local_id) {
      return true;
    }
    if (queuedIds.has(message.local_id)) {
      return true;
    }
    if (message.status === 'pending' && state.canceledUploadIds && !state.canceledUploadIds.has(message.local_id)) {
      return true;
    }
    return remoteLocalIds.has(message.local_id);
  });
  if (state.messages.length !== before) {
    if (state.selectedMessageKey && !state.messages.some((item) => messageKey(item) === state.selectedMessageKey)) {
      state.selectedMessageKey = '';
    }
    persistMessages();
    renderMessages();
  }
}

async function deleteStorageObject(path) {
  const response = await fetch(`${state.config.supabaseUrl}/storage/v1/object/${state.config.bucketName}/${path}`, {
    method: 'DELETE',
    headers: supabaseHeaders()
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

async function deleteOwnImageAssets(message) {
  return deleteOwnMediaAssets(message);
}

async function deleteOwnMediaAssets(message) {
  if (!message || !message.content) {
    return;
  }
  const manifest = await fetchJsonWithAuth(message.content);
  if (manifest && Array.isArray(manifest.chunks)) {
    for (const chunk of manifest.chunks) {
      await deleteStorageObject(chunk.path);
    }
  }
  if (manifest && manifest.sessionId && manifest.localId) {
    await deleteStorageObject(`manifests/${manifest.sessionId}/${manifest.localId}.json`);
  }
}

function statusRank(status) {
  if (status === 'read') {
    return 3;
  }
  if (status === 'delivered') {
    return 2;
  }
  if (status === 'sent' || status === 'resumed') {
    return 1;
  }
  return 0;
}

function notifyIncomingMessage(message) {
  state.unreadCount += 1;
  updateTitleBadge();

  const mode = normalizeNotificationMode(state.notificationMode);
  const useVibration = mode === 'both' || mode === 'vibrate';
  const useSound = mode === 'both' || mode === 'sound';

  if (useVibration && navigator.vibrate) {
    navigator.vibrate(message.type === 'audio' ? [12, 60, 12] : [18]);
  }

  if (useSound) {
    playNotificationTone(message.type);
  }

  const label = message.type === 'audio'
    ? `🎤 Nota de voz de ${formatUserName(message.sender || '')}`
    : message.type === 'image'
      ? `📷 Imagen de ${formatUserName(message.sender || '')}`
      : `💬 ${formatUserName(message.sender || '')}: ${String(message.display_content || message.content || '').slice(0, 60)}`;

  notifySystemMessage(message, label);
  setComposerHint(label);
}

async function notifySystemMessage(message, label) {
  if (!state.systemNotificationsEnabled || !document.hidden) {
    return;
  }
  if (!('Notification' in window) || readNotificationPermissionState() !== 'granted') {
    return;
  }

  const title = `Chat: ${formatUserName(message.sender || '')}`;
  const body = label;
  const targetUrl = getShareUrl();
  const options = {
    body,
    icon: 'icon.svg',
    badge: 'icon.svg',
    tag: `chat-${state.config.sessionId || 'sala'}`,
    renotify: false,
    data: {
      url: targetUrl
    }
  };

  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration && registration.showNotification) {
        await registration.showNotification(title, options);
        return;
      }
    }

    const fallback = new Notification(title, options);
    fallback.onclick = () => {
      window.focus();
      window.location.href = targetUrl;
      fallback.close();
    };
  } catch (error) {
    console.error(error);
  }
}

function updateTitleBadge() {
  const base = 'Chat Privado Ligero';
  document.title = state.unreadCount > 0 ? `(${state.unreadCount}) ${base}` : base;
}

function clearUnreadBadge() {
  state.unreadCount = 0;
  updateTitleBadge();
}

function playNotificationTone(type) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      return;
    }
    const ctx = new AudioCtx();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    if (type === 'audio') {
      const freqs = [660, 880];
      freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.12);
        gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.12);
        gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + i * 0.12 + 0.02);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + i * 0.12 + 0.13);
        osc.connect(gain);
        osc.start(ctx.currentTime + i * 0.12);
        osc.stop(ctx.currentTime + i * 0.12 + 0.14);
      });
    } else {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(type === 'image' ? 740 : 820, ctx.currentTime);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.018);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.12);
      osc.connect(gain);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.13);
    }

    window.setTimeout(() => ctx.close(), 600);
  } catch (_error) {
    // audio not available
  }
}

function syncMessageReceipt(message) {
  if (!state.online || !isConfigured() || isOwnMessage(message) || !message.local_id) {
    return;
  }
  const targetStatus = document.hidden ? 'delivered' : 'read';
  if (statusRank(message.status) >= statusRank(targetStatus)) {
    return;
  }
  updateMessageRemote(message.local_id, { status: targetStatus }).catch((error) => {
    console.error(error);
  });
}

async function syncVisibleMessageReceipts() {
  if (document.hidden || !state.online || !isConfigured()) {
    return;
  }

  const pendingMessages = state.messages.filter((message) => !isOwnMessage(message) && message.local_id && statusRank(message.status) < statusRank('read'));
  if (pendingMessages.length === 0) {
    return;
  }

  await Promise.allSettled(pendingMessages.map((message) => updateMessageRemote(message.local_id, { status: 'read' })));
}

async function uploadFileToStorage(path, blob) {
  const response = await fetch(`${state.config.supabaseUrl}/storage/v1/object/${state.config.bucketName}/${path}`, {
    method: 'POST',
    headers: {
      apikey: state.config.supabaseKey,
      Authorization: `Bearer ${state.config.supabaseKey}`,
      'x-upsert': 'true',
      'Content-Type': blob.type || 'application/octet-stream'
    },
    body: blob
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

    // Subscribe to typing status changes
    socket.send(JSON.stringify({
      topic: 'realtime:public:typing_status',
      event: 'phx_join',
      payload: {
        config: {
          broadcast: { self: false },
          postgres_changes: [
            {
              event: '*',
              schema: 'public',
              table: 'typing_status',
              filter: `session_id=eq.${state.config.sessionId}`
            }
          ]
        }
      },
      ref: '2'
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
      if (data.event === 'postgres_changes' && data.payload && data.payload.data) {
        const change = data.payload.data;
        const record = change.record || change.new || change.new_record || null;
        const oldRecord = change.old_record || change.old || null;
        const eventType = String(change.eventType || data.type || data.eventType || '').toUpperCase();

        // Handle typing status changes
        if (data.topic && data.topic.includes('typing_status')) {
          handleTypingStatusChange(record, eventType);
          return;
        }

        // Handle message changes
        if (eventType === 'DELETE' || (!record && oldRecord)) {
          const target = oldRecord || record;
          if (target && target.session_id === state.config.sessionId) {
            removeMessageByRemoteRecord(target);
          }
          return;
        }

        if (!record || record.session_id !== state.config.sessionId) {
          return;
        }

        if (record.id) {
          state.knownRemoteIds.add(record.id);
          persistKnownRemoteIds();
        }
        hydrateIncomingMessage(record)
          .then((hydrated) => {
            const isNew = !state.messages.some((item) => item.local_id === hydrated.local_id && item.status === hydrated.status);
            upsertMessage(hydrated);
            syncMessageReceipt(hydrated);
            if (isNew && hydrated.sender !== state.config.senderId) {
              notifyIncomingMessage(hydrated);
            }
          })
          .catch((error) => console.error(error));
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

function handleTypingStatusChange(record, eventType) {
  if (!record || !record.sender || record.session_id !== state.config.sessionId) {
    return;
  }

  const sender = record.sender;
  const isOwnStatus = sender === state.config.senderId;
  
  // Ignore our own typing status updates
  if (isOwnStatus) {
    return;
  }

  if (eventType === 'DELETE' || !record.is_typing) {
    state.typingState.delete(sender);
  } else {
    state.typingState.set(sender, Date.now());
  }

  updateTypingIndicator();
}

function updateTypingIndicator() {
  const now = Date.now();
  const TYPING_TIMEOUT = 3000; // 3 seconds

  // Remove expired typing statuses
  for (const [sender, timestamp] of state.typingState.entries()) {
    if (now - timestamp > TYPING_TIMEOUT) {
      state.typingState.delete(sender);
    }
  }

  const indicator = elements.typingStatusIndicator || document.getElementById('typing-status-indicator');
  if (!indicator) {
    return;
  }

  if (state.typingState.size === 0) {
    indicator.hidden = true;
    return;
  }

  const typingUsers = Array.from(state.typingState.keys());
  const typingText = indicator.querySelector('.typing-status-text');
  
  if (typingUsers.length === 1) {
    typingText.textContent = `${formatUserName(typingUsers[0])} está escribiendo...`;
  } else if (typingUsers.length === 2) {
    typingText.textContent = `${formatUserName(typingUsers[0])} y ${formatUserName(typingUsers[1])} están escribiendo...`;
  } else {
    typingText.textContent = `${typingUsers.length} personas están escribiendo...`;
  }

  indicator.hidden = false;
}

async function sendTypingStatus(isTyping) {
  if (!isConfigured() || !state.config.supabaseUrl) {
    return;
  }

  try {
    const now = Date.now();
    const minInterval = 500; // Don't send more than every 500ms when typing
    
    if (isTyping && now - state.myLastTypingAt < minInterval) {
      return; // Skip if we just sent a status
    }

    state.myLastTypingAt = now;

    const response = await fetch(`${state.config.supabaseUrl}/rest/v1/typing_status`, {
      method: 'POST',
      headers: {
        'apikey': state.config.supabaseKey,
        'Authorization': `Bearer ${state.config.supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates' // Upsert behavior
      },
      body: JSON.stringify({
        sender: state.config.senderId,
        session_id: state.config.sessionId,
        is_typing: isTyping
      })
    });

    if (!response.ok && response.status !== 409) {
      console.warn('Failed to send typing status:', response.statusText);
    }
  } catch (error) {
    console.error('Error sending typing status:', error);
  }
}

function attachTypingStatusListeners() {
  const messageInput = elements.messageInput || document.getElementById('message-input');
  if (!messageInput) {
    return;
  }

  let isCurrentlyTyping = false;

  messageInput.addEventListener('input', () => {
    const hasText = messageInput.value.trim().length > 0;
    
    if (hasText && !isCurrentlyTyping) {
      isCurrentlyTyping = true;
      sendTypingStatus(true);
    } else if (!hasText && isCurrentlyTyping) {
      isCurrentlyTyping = false;
      sendTypingStatus(false);
    }
  });

  messageInput.addEventListener('blur', () => {
    if (isCurrentlyTyping) {
      isCurrentlyTyping = false;
      sendTypingStatus(false);
    }
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
  const intervalMs = document.hidden ? 45000 : 20000;
  state.resumeTimer = window.setInterval(async () => {
    if (state._monitorBusy) {
      return;
    }
    state._monitorBusy = true;
    try {
      await probeConnection();
      if (state.online) {
        flushQueues();
        refreshHistory({ silent: true });
      }
    } finally {
      state._monitorBusy = false;
    }
  }, intervalMs);
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
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), PROBE_FETCH_TIMEOUT_MS);
      const response = await fetch(`${state.config.supabaseUrl}/rest/v1/messages?select=id&limit=1`, {
        headers: supabaseHeaders(),
        cache: 'no-store',
        signal: controller.signal
      });
      window.clearTimeout(timeoutId);
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
  if (sample.ok) {
    state.lastSyncAt = new Date().toISOString();
  }
  updateConnectionUi();
}

function selectConnectionMode() {
  if (!isConfigured()) {
    return 'Sin configurar';
  }
  if (!state.online || state.kbps < 80 || state.latency > 2000 || state.stability < 0.6 || state.loss > 0.35) {
    return 'Ultra-ligero';
  }
  if (state.kbps < 400 || state.latency > 900 || state.stability < 0.85 || state.loss > 0.15) {
    return 'Inteligente';
  }
  return 'Turbo';
}

function updateConnectionUi() {
  elements.connectionMode.textContent = state.mode;
  elements.netFabMode.textContent = state.mode;
  elements.connectionSpeed.textContent = state.kbps ? `${state.kbps} kbps` : state.online ? 'Midiendo' : 'Sin conexión';
  elements.connectionLatency.textContent = state.latency ? `${state.latency} ms` : '-';
  elements.connectionStability.textContent = `${Math.round(state.stability * 100)}%`;
  elements.connectionLoss.textContent = `${Math.round(state.loss * 100)}%`;
  updateSyncSummary();
  updateQueueSize();
}

async function restoreUploadJobs() {
  const jobs = await dbGetAll(UPLOAD_STORE);
  for (const job of jobs) {
    const existing = state.messages.find((item) => item.local_id === job.id);
    if (!existing) {
      const mediaType = job.type === 'audio' ? 'audio' : 'image';
      upsertMessage({
        local_id: job.id,
        sender: job.sender,
        type: mediaType,
        content: '',
        timestamp: job.createdAt,
        status: 'pending',
        chunks_total: job.chunks.length,
        chunks_sent: job.uploadedIndices.length,
        session_id: job.sessionId,
        previewUrl: job.previewUrl || '',
        duration_ms: Number(job.durationMs || 0)
      });
    }
  }
}

function updateQueueSize() {
  dbGetAll(UPLOAD_STORE).then((jobs) => {
    state.pendingUploadsCount = jobs.length;
    elements.queueSize.textContent = String(state.queuedTexts.length + jobs.length);
    updateSyncSummary();
  }).catch(() => {
    state.pendingUploadsCount = 0;
    elements.queueSize.textContent = String(state.queuedTexts.length);
    updateSyncSummary();
  });
}

function updateSyncSummary() {
  elements.netUser.textContent = formatUserName(state.config.senderId || state.identity);
  elements.netRoom.textContent = state.config.sessionId || '-';
  elements.netLastSync.textContent = state.lastSyncAt ? formatDate(state.lastSyncAt) : 'nunca';
  elements.netPending.textContent = String(state.queuedTexts.length + state.pendingUploadsCount);
  if (elements.reloadHistory) {
    elements.reloadHistory.textContent = state.historyHasMore ? 'Recargar historial' : 'Historial completo';
  }
  if (elements.loadMoreHistory) {
    elements.loadMoreHistory.disabled = !state.historyHasMore;
    elements.loadMoreHistory.textContent = state.historyHasMore ? 'Cargar mensajes anteriores' : 'Sin más mensajes';
  }
}

function getTargetImageKb() {
  if (state.mode === 'Ultra-ligero') {
    return 80;
  }
  if (state.mode === 'Inteligente') {
    return 180;
  }
  return 360;
}

function getMaxDimensionForMode() {
  if (state.mode === 'Ultra-ligero') {
    return 960;
  }
  if (state.mode === 'Inteligente') {
    return 1400;
  }
  return 2200;
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
  while (blob.size > targetKb * 1024 && quality > 0.16) {
    quality -= 0.1;
    blob = await canvasToJpeg(canvas, quality);
  }

  while (blob.size > targetKb * 1024 && Math.max(canvas.width, canvas.height) > 220) {
    canvas.width = Math.max(220, Math.round(canvas.width * 0.78));
    canvas.height = Math.max(220, Math.round(canvas.height * 0.78));
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    quality = Math.max(0.14, quality - 0.08);
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
    setComposerHint('Sin conexión. Se descargó el historial en TXT local.');
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
    setComposerHint('Solicitud de exportación enviada a la función exportHistory.');
  } catch (error) {
    console.error(error);
    downloadTextFile(transcript, `${state.config.sessionId}-historial.txt`, 'text/plain');
    setComposerHint('La función exportHistory no respondió. Se descargó el TXT local como respaldo.');
  }
}

function buildTranscript() {
  return state.messages.map((message) => {
    const header = `[${formatDate(message.timestamp)}] ${message.sender} ${message.type}`;
    let body = message.display_content || message.content;
    if (message.type === 'image') {
      body = message.content || 'imagen-pendiente';
    }
    if (message.type === 'audio') {
      const seconds = Math.max(0, Math.round(Number(message.duration_ms || 0) / 1000));
      body = `${message.content || 'audio-pendiente'} (${seconds}s)`;
    }
    return `${header}\n${body}\n`;
  }).join('\n');
}

function isE2EEEnabled() {
  return Boolean(state.config.e2eePassphrase);
}

function isE2EEUnlocked() {
  return Date.now() < Number(state.e2eeUnlockUntil || 0);
}

async function ensureE2EEUnlocked(interactive) {
  if (!isE2EEEnabled()) {
    return true;
  }
  if (isE2EEUnlocked()) {
    return true;
  }
  if (!interactive) {
    return false;
  }

  const promptText = 'Clave E2E (solo se pedirá una vez al día):';
  const typed = window.prompt(promptText, '');
  if (typed === null) {
    setComposerHint('Cifrado bloqueado. Puedes seguir leyendo, pero mensajes cifrados quedarán ocultos.');
    return false;
  }
  if (typed.trim() !== String(state.config.e2eePassphrase || '').trim()) {
    setComposerHint('Clave E2E incorrecta.');
    return false;
  }

  state.e2eeUnlockUntil = Date.now() + DAILY_UNLOCK_MS;
  saveJson(STORAGE_KEYS.e2eeUnlockUntil, state.e2eeUnlockUntil);
  setComposerHint('Clave aceptada. No se volverá a pedir hoy.');
  return true;
}

function resetE2EECache() {
  state.e2eeKeyPromise = null;
  state.e2eeKeyFingerprint = '';
}

async function getE2EEKey() {
  if (!isE2EEEnabled()) {
    return null;
  }
  if (!await ensureE2EEUnlocked(false)) {
    throw new Error('E2E bloqueado');
  }
  const fingerprint = `${state.config.sessionId}|${state.config.e2eePassphrase}`;
  if (state.e2eeKeyPromise && state.e2eeKeyFingerprint === fingerprint) {
    return state.e2eeKeyPromise;
  }
  state.e2eeKeyFingerprint = fingerprint;
  state.e2eeKeyPromise = deriveAesKey(state.config.e2eePassphrase, state.config.sessionId);
  return state.e2eeKeyPromise;
}

async function deriveAesKey(passphrase, sessionId) {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({
    name: 'PBKDF2',
    salt: encoder.encode(`chat-lite-e2ee|${sessionId}`),
    iterations: 150000,
    hash: 'SHA-256'
  }, baseKey, {
    name: 'AES-GCM',
    length: 256
  }, false, ['encrypt', 'decrypt']);
}

async function encodeOutgoingText(plainText) {
  if (!isE2EEEnabled()) {
    return { wire: plainText, encrypted: false };
  }
  if (!await ensureE2EEUnlocked(true)) {
    throw new Error('E2E no desbloqueado');
  }
  const key = await getE2EEKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payloadBytes = new TextEncoder().encode(plainText);
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payloadBytes);
  const packed = toBase64(JSON.stringify({
    iv: toBase64(iv),
    ct: toBase64(new Uint8Array(cipherBuffer))
  }));
  return {
    wire: `${ENC_PREFIX}${packed}`,
    encrypted: true
  };
}

async function hydrateIncomingMessage(message) {
  const hydrated = { ...message };
  if (hydrated.type !== 'text') {
    return hydrated;
  }
  const decoded = await decodeIncomingText(hydrated.content || '');
  hydrated.display_content = decoded.text;
  hydrated.encrypted = decoded.encrypted;
  return hydrated;
}

async function decodeIncomingText(content) {
  if (!content.startsWith(ENC_PREFIX)) {
    return { text: content, encrypted: false };
  }
  if (!isE2EEEnabled()) {
    return { text: '[Mensaje cifrado. Configura la clave E2E para leerlo.]', encrypted: true };
  }
  try {
    const key = await getE2EEKey();
    const packed = JSON.parse(fromBase64(content.slice(ENC_PREFIX.length)));
    const iv = fromBase64ToBytes(packed.iv);
    const ct = fromBase64ToBytes(packed.ct);
    const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return { text: new TextDecoder().decode(plainBuffer), encrypted: true };
  } catch {
    return { text: '[No se pudo descifrar este mensaje.]', encrypted: true };
  }
}

function toBase64(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function fromBase64(base64) {
  const bytes = fromBase64ToBytes(base64);
  return new TextDecoder().decode(bytes);
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
    'Proyecto detectado por la clave anónima:',
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
    "  status text not null default 'pending' check (status in ('pending','sent','resumed','delivered','read','error')),",
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
    '2. Bucket público chat-files',
    '',
    'insert into storage.buckets (id, name, public)',
    "values ('chat-files', 'chat-files', true)",
    'on conflict (id) do update set public = true;',
    '',
    '3. Políticas para cliente anónimo',
    '',
    'Necesitas permitir select, insert y update sobre public.messages.',
    'Necesitas permitir insert y select sobre storage.objects del bucket chat-files.',
    'Recomendado: NO permitir delete directo al rol anon.',
    'Si quieres restringir por sala, usa session_id y sender en tus políticas RLS.',
    '',
    '4. Reinicio seguro recomendado (sin abrir DELETE al anon)',
    '',
    'Configura una Edge Function resetRoomAdmin con Service Role que valide sender == roberto',
    'y solo entonces elimine mensajes + objetos del bucket para la session_id solicitada.',
    'En la app, define ese nombre en el campo "Función resetRoomAdmin".',
    '',
    '5. Edge Function exportHistory',
    '',
    'Debe recibir sender o user id, session_id, email y transcript.',
    'Debe leer public.messages, descargar manifiestos e imágenes del bucket, generar TXT y ZIP, y enviar correo.',
    '',
    '6. Realtime',
    '',
    `La app escucha cambios de la sala ${sessionId} en public.messages.`,
    '',
    '7. Nota técnica',
    '',
    'La app usa subida por bloques de 5 KB hacia Storage y guarda un manifiesto JSON para reanudar y reconstruir imágenes y audios con verificación SHA-256.'
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

function dbClear(storeName) {
  return new Promise((resolve, reject) => {
    if (!state.db) {
      resolve();
      return;
    }
    const request = dbStore(storeName, 'readwrite').clear();
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

function isProfileMenuTarget(target) {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(
    target.closest('#profile-menu') ||
    target.closest('#profile-trigger-floating') ||
    target.closest('#profile-trigger-topbar')
  );
}

function showProfileMenu() {
  if (!elements.profileMenu) {
    return;
  }
  state.profileMenuOpen = true;
  elements.profileMenu.hidden = false;
  elements.profileTriggerFloating?.setAttribute('aria-expanded', 'true');
  elements.profileTriggerTopbar?.setAttribute('aria-expanded', 'true');
}

function hideProfileMenu() {
  if (!elements.profileMenu) {
    return;
  }
  state.profileMenuOpen = false;
  elements.profileMenu.hidden = true;
  elements.profileTriggerFloating?.setAttribute('aria-expanded', 'false');
  elements.profileTriggerTopbar?.setAttribute('aria-expanded', 'false');
}

function toggleProfileMenu() {
  if (state.profileMenuOpen) {
    hideProfileMenu();
    return;
  }
  showProfileMenu();
}

async function saveProfilePhotoToSupabase(dataUrl) {
  if (!isConfigured()) {
    return;
  }
  try {
    const sender = state.config.senderId;
    const sessionId = state.config.sessionId;
    
    if (!sender || !sessionId) {
      return;
    }

    // Use upsert to update or insert
    const response = await fetch(`${state.config.supabaseUrl}/rest/v1/user_profiles?on_conflict=sender`, {
      method: 'POST',
      headers: {
        'apikey': state.config.supabaseKey,
        'Authorization': `Bearer ${state.config.supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        sender: sender,
        session_id: sessionId,
        avatar_data: dataUrl,
        avatar_mime: 'image/jpeg'
      })
    });

    if (!response.ok) {
      console.warn('Failed to save profile to Supabase:', response.statusText);
    }
  } catch (error) {
    console.error('Error saving profile to Supabase:', error);
  }
}

async function loadProfilePhotoFromSupabase(sender) {
  if (!isConfigured() || !sender) {
    return;
  }
  try {
    const filter = encodeURIComponent(`sender=eq.${sender}`);
    const url = `${state.config.supabaseUrl}/rest/v1/user_profiles?select=avatar_data,avatar_mime,updated_at&${filter}&limit=1`;
    
    const response = await fetch(url, {
      headers: supabaseHeaders()
    });

    if (!response.ok) {
      return; // No profile found, that's OK
    }

    const rows = await response.json();
    if (rows.length === 0) {
      return; // No profile data, that's OK
    }

    const profile = rows[0];
    if (profile.avatar_data) {
      // Update localStorage with Supabase data
      localStorage.setItem(profilePhotoStorageKey(), profile.avatar_data);
      
      // Update UI
      elements.profileAvatarImg.src = profile.avatar_data;
      elements.profileAvatarImg.style.opacity = '1';
      if (elements.profileAvatarImgTopbar) {
        elements.profileAvatarImgTopbar.src = profile.avatar_data;
        elements.profileAvatarImgTopbar.style.opacity = '1';
      }
      syncProfileAvatarVisibility();
    }
  } catch (error) {
    console.error('Error loading profile from Supabase:', error);
  }
}

async function deleteProfilePhotoFromSupabase() {
  if (!isConfigured()) {
    return;
  }
  try {
    const sender = state.config.senderId;
    if (!sender) {
      return;
    }

    const filter = encodeURIComponent(`sender=eq.${sender}`);
    const response = await fetch(`${state.config.supabaseUrl}/rest/v1/user_profiles?${filter}`, {
      method: 'DELETE',
      headers: supabaseHeaders()
    });

    if (!response.ok) {
      console.warn('Failed to delete profile photo from Supabase:', response.statusText);
    }
  } catch (error) {
    console.error('Error deleting profile photo from Supabase:', error);
  }
}

function clearProfilePhoto() {
  localStorage.removeItem(profilePhotoStorageKey());
  localStorage.removeItem(STORAGE_KEYS.profilePhoto);
  elements.profileAvatarImg.removeAttribute('src');
  elements.profileAvatarImg.style.opacity = '0';
  if (elements.profileAvatarImgTopbar) {
    elements.profileAvatarImgTopbar.removeAttribute('src');
    elements.profileAvatarImgTopbar.style.opacity = '0';
  }
  syncProfileAvatarVisibility();
  updateIdentityProfilesUi();
  deleteProfilePhotoFromSupabase().catch((error) => {
    console.error('Failed to delete profile photo from Supabase:', error);
  });
  setComposerHint('Imagen de perfil eliminada.');
}

function resetIdentityEntryProgressUi() {
  state.identityEntryBusy = false;
  if (elements.identityEntryProgress) {
    elements.identityEntryProgress.hidden = true;
  }
  if (elements.identityProgressFill) {
    elements.identityProgressFill.style.width = '0%';
  }
  const track = document.querySelector('.identity-progress-track');
  if (track) {
    track.setAttribute('aria-valuenow', '0');
  }
  if (elements.identityEntryMessage) {
    elements.identityEntryMessage.textContent = 'Preparando sala...';
  }
  setIdentityActionsDisabled(false);
}

function setIdentityActionsDisabled(disabled) {
  const nodes = [elements.identityRoberto, elements.identityMonica, elements.identityCustom, elements.identityCustomSubmit];
  for (const node of nodes) {
    if (!node) {
      continue;
    }
    node.disabled = disabled;
  }
}

async function runIdentityEntryProgress(name) {
  state.identityEntryBusy = true;
  setIdentityActionsDisabled(true);
  if (elements.identityEntryProgress) {
    elements.identityEntryProgress.hidden = false;
  }

  const readableName = formatUserName(name);
  const customIdentityMessage = getIdentityCustomEntryMessage(name);
  for (const step of IDENTITY_ENTRY_STEPS) {
    if (elements.identityProgressFill) {
      elements.identityProgressFill.style.width = `${step.pct}%`;
    }
    const track = document.querySelector('.identity-progress-track');
    if (track) {
      track.setAttribute('aria-valuenow', String(step.pct));
    }
    if (elements.identityEntryMessage) {
      let customText = step.text.includes('mi amor') ? `${step.text}` : `${step.text.replace('ustedes', readableName)}`;
      if (step.pct >= 100 && customIdentityMessage) {
        customText = customIdentityMessage;
      }
      elements.identityEntryMessage.textContent = customText;
    }
    await wait(step.pct >= 100 ? 260 : 220);
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });
}

function profilePhotoStorageKeyForIdentity(identityValue) {
  const identity = normalizeIdentity(identityValue || '');
  return `${STORAGE_KEYS.profilePhoto}:${identity || 'anon'}`;
}

function updateIdentityProfilesUi() {
  paintIdentityProfileChip('roberto', elements.identityRobertoAvatar, elements.identityRobertoFallback, 'R');
  paintIdentityProfileChip('monica', elements.identityMonicaAvatar, elements.identityMonicaFallback, 'M');
}

function paintIdentityProfileChip(identity, avatarImage, fallbackNode, defaultInitial) {
  if (!avatarImage || !fallbackNode) {
    return;
  }
  const profileDataUrl = localStorage.getItem(profilePhotoStorageKeyForIdentity(identity));
  if (profileDataUrl) {
    avatarImage.src = profileDataUrl;
    fallbackNode.style.opacity = '0';
    return;
  }
  avatarImage.removeAttribute('src');
  fallbackNode.textContent = defaultInitial;
  fallbackNode.style.opacity = '1';
}

function identityEntryMessageStorageKey(identityValue) {
  const identity = normalizeIdentity(identityValue || '');
  return `${STORAGE_KEYS.identityEntryMessage}:${identity || 'anon'}`;
}

function getIdentityCustomEntryMessage(identityValue) {
  const key = identityEntryMessageStorageKey(identityValue);
  const message = String(localStorage.getItem(key) || '').trim();
  return message;
}

function persistIdentityCustomEntryMessage(identityValue) {
  if (!elements.identityEntryCustomMessage) {
    return;
  }
  const identity = normalizeIdentity(identityValue || '');
  if (!identity) {
    return;
  }
  const key = identityEntryMessageStorageKey(identity);
  const message = String(elements.identityEntryCustomMessage.value || '').trim();
  if (!message) {
    localStorage.removeItem(key);
    return;
  }
  localStorage.setItem(key, message.slice(0, 140));
}

function syncIdentityCustomEntryMessage(identityValue) {
  if (!elements.identityEntryCustomMessage) {
    return;
  }
  const identity = normalizeIdentity(identityValue || '');
  if (!identity) {
    elements.identityEntryCustomMessage.value = '';
    return;
  }
  elements.identityEntryCustomMessage.value = getIdentityCustomEntryMessage(identity);
}

function ensureDeviceId() {
  if (state.deviceId) {
    return state.deviceId;
  }

  const nextId = createId('device');
  state.deviceId = nextId;
  localStorage.setItem(STORAGE_KEYS.deviceId, nextId);
  return nextId;
}

function updateIdentityEntryLoadingStatus(text, pct) {
  if (elements.identityEntryProgress) {
    elements.identityEntryProgress.hidden = false;
  }
  if (elements.identityEntryMessage && text) {
    elements.identityEntryMessage.textContent = text;
  }
  const normalizedPct = Math.max(0, Math.min(100, Number(pct) || 0));
  if (elements.identityProgressFill) {
    elements.identityProgressFill.style.width = `${normalizedPct}%`;
  }
  const track = document.querySelector('.identity-progress-track');
  if (track) {
    track.setAttribute('aria-valuenow', String(normalizedPct));
  }
}

function finalizeIdentityEntry() {
  setIdentityGateVisible(false);
  updateActiveUserUi();
  setComposerHint(`Entraste como ${formatUserName(state.config.senderId)}.`);
  resetIdentityEntryProgressUi();
}
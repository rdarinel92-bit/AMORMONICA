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
  e2eeUnlockUntil: 'chat-lite-e2ee-unlock-until',
  profilePhoto: 'chat-lite-profile-photo',
  appVersion: 'chat-lite-app-version',
  emojiRecent: 'chat-lite-emoji-recent'
};
const APP_VERSION = '2026-08-08-v13';

const DB_NAME = 'chat-lite-db';
const DB_VERSION = 1;
const UPLOAD_STORE = 'uploads';
const CACHE_STORE = 'cache';
const CHUNK_SIZE = 5 * 1024;
const HEARTBEAT_MS = 25000;
const PROBE_HISTORY = 8;
const IMAGE_UPLOAD_MAX_RETRIES = 4;
const IMAGE_UPLOAD_RETRY_BASE_MS = 1500;
const IMAGE_DRAFT_PREVIEW_ENABLED = false;
const ENC_PREFIX = 'enc:v1:';
const DAILY_UNLOCK_MS = 24 * 60 * 60 * 1000;
const imageCache = new Map();
let deferredInstallPrompt = null;
let serviceWorkerReloaded = false;
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
  exportEmail: '',
  e2eePassphrase: ''
};

const state = {
  config: { ...defaultConfig, ...loadJson(STORAGE_KEYS.config, {}) },
  configLocked: loadJson(STORAGE_KEYS.configLocked, true),
  identity: loadJson(STORAGE_KEYS.identity, ''),
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
  imageRetryTimers: new Map(),
  uploadRetryTimers: new Map(),
  canceledUploadIds: new Set(),
  imageDraftQueue: [],
  activeUploadLocalId: '',
  uploadPumpRunning: false,
  autoSavedImages: new Set(loadJson(STORAGE_KEYS.autoSavedImages, [])),
  forceImages: loadJson(STORAGE_KEYS.forceImages, false),
  e2eeUnlockUntil: loadJson(STORAGE_KEYS.e2eeUnlockUntil, 0),
  selectedMessageKey: '',
  e2eeKeyPromise: null,
  e2eeKeyFingerprint: '',
  lastSyncAt: null,
  pendingUploadsCount: 0,
  initialized: false,
  deviceId: localStorage.getItem(STORAGE_KEYS.deviceId) || '',
  identityByDevice: loadJson(STORAGE_KEYS.identityByDevice, {}),
  imageDraft: null,
  imageDraftFile: null,
  profileMenuOpen: false,
  emojiPanelOpen: false,
  emojiPanelManuallyClosed: false,
  emojiCategory: 'recientes',
  emojiRecent: loadJson(STORAGE_KEYS.emojiRecent, [])
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
  forceImages: document.getElementById('force-images'),
  installApp: document.getElementById('install-app'),
  netUser: document.getElementById('net-user'),
  netRoom: document.getElementById('net-room'),
  netLastSync: document.getElementById('net-last-sync'),
  netPending: document.getElementById('net-pending'),
  activeUser: document.getElementById('active-user'),
  identityGate: document.getElementById('identity-gate'),
  identityRoberto: document.getElementById('identity-roberto'),
  identityMonica: document.getElementById('identity-monica'),
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
  profileChangePhoto: document.getElementById('profile-change-photo'),
  profileClearPhoto: document.getElementById('profile-clear-photo'),
  profileAvatarImg: document.getElementById('profile-avatar-img'),
  profileAvatarFallback: document.getElementById('profile-avatar-fallback'),
  profileAvatarImgTopbar: document.getElementById('profile-avatar-img-topbar'),
  profileAvatarFallbackTopbar: document.getElementById('profile-avatar-fallback-topbar'),
  emojiPanel: document.getElementById('emoji-panel'),
  emojiCategories: document.getElementById('emoji-categories'),
  emojiRecentGrid: document.getElementById('emoji-recent-grid'),
  emojiGrid: document.getElementById('emoji-grid'),
  emojiToggle: document.getElementById('emoji-toggle'),
  emojiPanelClose: document.getElementById('emoji-panel-close')
};

boot().catch((error) => {
  console.error(error);
  setComposerHint('Fallo al iniciar la aplicacion. Revisa la consola del navegador.');
});

async function boot() {
  bindUi();
  await enforceAppVersion();
  ensureDeviceId();
  renderEmojiPanel();
  loadProfilePhoto();
  registerPwa();
  applyConfigToForm();
  setComposerLocked(true);
  await ensureIdentitySelected();
  await ensureE2EEUnlocked(true);
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
  setComposerLocked(false);
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

  if (elements.forceImages) {
    elements.forceImages.addEventListener('change', () => {
      state.forceImages = elements.forceImages.checked;
      saveJson(STORAGE_KEYS.forceImages, state.forceImages);
      setComposerHint(state.forceImages
        ? 'Forzar imagen activado. Se permitirán imágenes incluso con red difícil.'
        : 'Forzar imagen desactivado. Se prioriza texto con red difícil.');
    });
  }

  if (elements.installApp) {
    elements.installApp.addEventListener('click', async () => {
      if (!deferredInstallPrompt) {
        setComposerHint('La instalación aún no está disponible en este navegador.');
        return;
      }
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      elements.installApp.hidden = true;
      elements.installApp.setAttribute('aria-hidden', 'true');
      setComposerHint(choice.outcome === 'accepted'
        ? 'Instalación iniciada.'
        : 'Instalación cancelada.');
    });
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (elements.installApp) {
      elements.installApp.hidden = false;
      elements.installApp.setAttribute('aria-hidden', 'false');
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    if (elements.installApp) {
      elements.installApp.hidden = true;
      elements.installApp.setAttribute('aria-hidden', 'true');
    }
    setComposerHint('Aplicación instalada.');
  });

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (!target.closest('.message')) {
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

  elements.toggleSetup.addEventListener('click', () => {
    elements.setupPanel.hidden = !elements.setupPanel.hidden;
    elements.setupPanel.setAttribute('aria-hidden', elements.setupPanel.hidden ? 'true' : 'false');
  });

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
      await refreshHistory();
      connectRealtime();
      flushQueues();
      setComposerHint('Configuración guardada. El chat se conectará si las políticas de Supabase ya están creadas.');
    } else {
      setComposerHint('Falta URL o clave anónima de Supabase.');
    }
  });

  elements.reloadHistory.addEventListener('click', () => {
    refreshHistory();
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
  });

  elements.messageInput.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (!isEmojiPanelTarget(document.activeElement)) {
        hideEmojiPanel();
      }
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

  elements.imageInput.addEventListener('change', async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length === 0) {
      return;
    }

    if (!IMAGE_DRAFT_PREVIEW_ENABLED) {
      closImageDraftPanel();
      state.imageDraftQueue = files.map((file) => ({ file }));
      setComposerHint(`Cola de imágenes: ${state.imageDraftQueue.length}. Enviando...`);
      processImageSendQueue().catch((error) => {
        console.error(error);
        setComposerHint('No se pudo enviar la cola de imágenes.');
      });
      return;
    }

    await showImageDraftPanel(files[0], files.slice(1));
  });

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
  await refreshHistory({ silent: true });
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
  elements.exportEmail.value = state.config.exportEmail;
  if (elements.forceImages) {
    elements.forceImages.checked = state.forceImages;
  }
  applyConfigLockUi();
  updateActiveUserUi();
}

function ensureIdentitySelected() {
  return new Promise((resolve) => {
    const deviceId = ensureDeviceId();
    const byDevice = normalizeIdentity(state.identityByDevice[deviceId] || '');
    const previous = byDevice;
    if (previous) {
      state.identity = previous;
      state.config.senderId = previous;
      saveJson(STORAGE_KEYS.identity, state.identity);
      saveJson(STORAGE_KEYS.config, state.config);
      state.identityByDevice[deviceId] = previous;
      saveJson(STORAGE_KEYS.identityByDevice, state.identityByDevice);
      elements.senderId.value = state.config.senderId;
      elements.identityCustom.value = previous;
      setIdentityGateVisible(false);
      updateActiveUserUi();
      resolve();
      return;
    }

    state.identity = '';
    state.config.senderId = '';
    saveJson(STORAGE_KEYS.identity, state.identity);
    saveJson(STORAGE_KEYS.config, state.config);
    elements.senderId.value = '';
    elements.identityCustom.value = '';

    setIdentityGateVisible(true);

    const choose = (rawName) => {
      const name = normalizeIdentity(rawName);
      if (!name) {
        setComposerHint('Escribe un nombre valido para entrar al chat.');
        return;
      }

      state.identity = name;
      state.config.senderId = name;
      state.identityByDevice[deviceId] = name;
      saveJson(STORAGE_KEYS.identity, state.identity);
      saveJson(STORAGE_KEYS.identityByDevice, state.identityByDevice);
      saveJson(STORAGE_KEYS.config, state.config);
      elements.senderId.value = state.config.senderId;
      setIdentityGateVisible(false);
      updateActiveUserUi();
      setComposerHint(`Entraste como ${formatUserName(state.config.senderId)}.`);
      resolve();
    };

    elements.identityRoberto.onclick = () => choose('roberto');
    elements.identityMonica.onclick = () => choose('monica');
    elements.identityCustomSubmit.onclick = () => choose(elements.identityCustom.value);
    elements.identityCustom.onkeydown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        choose(elements.identityCustom.value);
      }
    };
  });
}

function setIdentityGateVisible(visible) {
  elements.identityGate.hidden = !visible;
  elements.identityGate.style.display = visible ? 'grid' : 'none';
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
  updateProfileFallbackInitial();
  updateSyncSummary();
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
  const nodes = [elements.messageInput, elements.imageInput];
  for (const node of nodes) {
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
  elements.composerHint.textContent = text;
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
  saveJson(STORAGE_KEYS.emojiRecent, state.emojiRecent);
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
  saveJson(STORAGE_KEYS.localMessages, state.messages);
}

function persistQueuedTexts() {
  saveJson(STORAGE_KEYS.queuedTexts, state.queuedTexts);
}

function persistKnownRemoteIds() {
  saveJson(STORAGE_KEYS.knownRemoteIds, Array.from(state.knownRemoteIds));
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
    localStorage.setItem(STORAGE_KEYS.profilePhoto, optimizedDataUrl);
    elements.profileAvatarImg.src = optimizedDataUrl;
    if (elements.profileAvatarImgTopbar) {
      elements.profileAvatarImgTopbar.src = optimizedDataUrl;
    }
    syncProfileAvatarVisibility();
    setComposerHint('Foto de perfil actualizada.');
    window.setTimeout(() => URL.revokeObjectURL(instantPreviewUrl), 1000);
  } catch (error) {
    console.error(error);
    setComposerHint('No se pudo actualizar la foto de perfil.');
  }
}

function loadProfilePhoto() {
  try {
    updateProfileFallbackInitial();
    const photoDataUrl = localStorage.getItem(STORAGE_KEYS.profilePhoto);
    if (photoDataUrl) {
      elements.profileAvatarImg.src = photoDataUrl;
      elements.profileAvatarImg.style.opacity = '1';
      if (elements.profileAvatarImgTopbar) {
        elements.profileAvatarImgTopbar.src = photoDataUrl;
        elements.profileAvatarImgTopbar.style.opacity = '1';
      }
    } else {
      elements.profileAvatarImg.removeAttribute('src');
      if (elements.profileAvatarImgTopbar) {
        elements.profileAvatarImgTopbar.removeAttribute('src');
      }
    }
    syncProfileAvatarVisibility();
  } catch (error) {
    console.error(error);
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
  renderMessages();
}

function clearSelectedMessage() {
  if (!state.selectedMessageKey) {
    return;
  }
  state.selectedMessageKey = '';
  renderMessages();
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

    const own = isOwnMessage(message);
    const selected = messageKey(message) && messageKey(message) === state.selectedMessageKey;
    let pressTimer = null;
    let longPressTriggered = false;
    sender.textContent = own ? 'Tu' : formatUserName(message.sender || 'desconocido');
    time.textContent = formatDate(message.timestamp || new Date().toISOString());
    status.textContent = buildStatusLabel(message);
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
        text.textContent = own ? 'Imagen cancelada.' : 'Imagen cancelada por el remitente.';
        body.appendChild(text);
        elements.chatLog.appendChild(fragment);
        continue;
      }
      const loading = document.createElement('p');
      loading.textContent = message.status === 'pending' ? 'Imagen pendiente...' : 'Cargando imagen...';
      body.appendChild(loading);
      renderImageMessage(message, body, loading, selected);
    } else {
      const text = document.createElement('p');
      text.textContent = message.display_content || message.content || '';
      body.appendChild(text);

      if (own) {
        const actions = document.createElement('div');
        actions.className = 'message-actions';
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
        actions.hidden = !selected;
        body.appendChild(actions);
      }
    }

    elements.chatLog.appendChild(fragment);
  }
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
}

function buildStatusLabel(message) {
  if (!isOwnMessage(message)) {
    return message.status === 'read' ? 'visto' : 'recibido';
  }
  if (message.type === 'image' && message.status === 'pending') {
    return `pendiente ${message.chunks_sent || 0}/${message.chunks_total || 0}`;
  }
  if (message.status === 'delivered') {
    return 'entregado';
  }
  if (message.status === 'read') {
    return 'leído';
  }
  if (message.status === 'resumed') {
    return 'enviado';
  }
  if (message.status === 'sent') {
    return 'enviado';
  }
  if (message.status === 'error') {
    return 'error';
  }
  return 'pendiente';
}

async function renderImageMessage(message, container, loadingNode, selected = false) {
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
    const actions = document.createElement('div');
    actions.className = 'image-actions';

    const downloadButton = document.createElement('button');
    downloadButton.type = 'button';
    downloadButton.className = 'button ghost button-icon image-download';
    downloadButton.innerHTML = '<span class="icon">⇩</span><span>Descargar imagen</span>';
    downloadButton.addEventListener('click', async () => {
      await downloadImageAsset(message, src);
    });

    actions.appendChild(downloadButton);

    if (isOwnMessage(message)) {
      const controlButton = document.createElement('button');
      controlButton.type = 'button';
      controlButton.className = 'button ghost image-cancel';
      controlButton.textContent = message.status === 'pending' ? 'Cancelar envio' : 'Eliminar del chat';
      controlButton.addEventListener('click', () => {
        cancelOrRemoveOwnImage(message).catch((error) => {
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
      progressText.textContent = `Subiendo ${sent}/${total} (${percent}%)`;
      frame.appendChild(progressText);
    }

    frame.appendChild(actions);

    loadingNode.replaceWith(frame);

    if (!isOwnMessage(message)) {
      autoSaveReceivedImage(message, src).catch((error) => console.error(error));
    }
  } catch (error) {
    loadingNode.textContent = 'Imagen atrasada. Reintentando...';
    scheduleImageRetry(message);
    console.error(error);
  }
}

async function downloadImageAsset(message, src) {
  try {
    const resolved = src || (message.content ? await resolveImageSource(message.content) : '');
    if (!resolved) {
      throw new Error('No hay imagen para descargar');
    }
    const anchor = document.createElement('a');
    anchor.href = resolved;
    anchor.download = `imagen-${message.local_id || message.id || Date.now()}.jpg`;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } catch (error) {
    console.error(error);
    setComposerHint('No se pudo descargar la imagen. Intenta de nuevo.');
  }
}

async function autoSaveReceivedImage(message, src) {
  const key = messageKey(message);
  if (!key || state.autoSavedImages.has(key)) {
    return;
  }
  state.autoSavedImages.add(key);
  persistAutoSavedImages();

  if (document.hidden) {
    return;
  }

  window.setTimeout(() => {
    downloadImageAsset(message, src).catch((error) => console.error(error));
  }, 250);
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
    const response = await fetchStorageChunk(partUrl);
    if (!response.ok) {
      throw new Error('No se pudo leer un bloque de imagen');
    }
    const arrayBuffer = await response.arrayBuffer();
    const actualHash = await sha256Hex(arrayBuffer);
    if (actualHash !== manifest.chunks[index].sha256) {
      throw new Error('Integridad de bloque inválida');
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
  if (!message || message.type !== 'text' || !isOwnMessage(message) || !message.local_id) {
    return;
  }

  const queuedIndex = state.queuedTexts.findIndex((item) => item.local_id === message.local_id);
  if (queuedIndex >= 0) {
    state.queuedTexts.splice(queuedIndex, 1);
    persistQueuedTexts();
  }

  let deleteSuccess = false;
  if (state.online && isConfigured()) {
    try {
      await deleteMessageRemote(message.local_id);
      deleteSuccess = true;
    } catch (error) {
      await updateMessageRemote(message.local_id, {
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
    removeLocalMessage(message.local_id);
    if (state.selectedMessageKey === message.local_id) {
      state.selectedMessageKey = '';
    }
    updateQueueSize();
    setComposerHint('Mensaje eliminado del chat.');
  }
}

function removeLocalMessage(localId) {
  const index = state.messages.findIndex((item) => item.local_id === localId);
  if (index < 0) {
    return null;
  }
  const [removed] = state.messages.splice(index, 1);
  persistMessages();
  renderMessages();
  return removed;
}

async function cancelOrRemoveOwnImage(message) {
  if (!message || message.type !== 'image' || !isOwnMessage(message) || !message.local_id) {
    return;
  }

  const isPending = message.status === 'pending';
  state.canceledUploadIds.add(message.local_id);

  const retryKey = message.local_id || message.id || message.content;
  const retryTimer = state.imageRetryTimers.get(retryKey);
  if (retryTimer) {
    window.clearTimeout(retryTimer);
    state.imageRetryTimers.delete(retryKey);
  }

  await dbDelete(UPLOAD_STORE, message.local_id);

  if (message.content) {
    await deleteOwnImageAssets(message).catch((error) => {
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
      await deleteMessageRemote(message.local_id);
      deleteSuccess = true;
    } catch (error) {
      await updateMessageRemote(message.local_id, {
        status: 'error',
        content: '',
        chunks_total: 0,
        chunks_sent: 0
      }).catch(() => {
      });
      setComposerHint('No se pudo eliminar la imagen. Reintentar...');
      return;
    }
  } else {
    deleteSuccess = true;
  }

  if (deleteSuccess) {
    removeLocalMessage(message.local_id);
    updateQueueSize();
    setComposerHint(isPending ? 'Envio de imagen cancelado.' : 'Imagen eliminada del chat.');
  }
}

async function showImageDraftPanel(file, extraFiles = []) {
  if (!isConfigured()) {
    setComposerHint('Configura Supabase antes de enviar imágenes.');
    return;
  }
  if (state.mode === 'Ultra-ligero' && !state.forceImages) {
    setComposerHint('Red muy lenta: la imagen quedó bloqueada. Activa Forzar imagen si la necesitas.');
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
  if (state.mode === 'Ultra-ligero' && !state.forceImages) {
    setComposerHint('Red muy lenta: la imagen quedó bloqueada. Activa Forzar imagen si la necesitas.');
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
  await insertPendingImageMessage(message, uploadJob);
  updateQueueSize();
  processUploadJob(uploadJob).catch((error) => {
    console.error(error);
    scheduleUploadRetry(uploadJob, error).catch((nestedError) => console.error(nestedError));
  });

  return localId;
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
  if (state.canceledUploadIds.has(job.id)) {
    clearUploadRetryTimer(job.id);
    await dbDelete(UPLOAD_STORE, job.id);
    return;
  }
  let liveJob = await dbGet(UPLOAD_STORE, job.id);
  if (!liveJob) {
    return;
  }
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
  await uploadFileToStorage(manifestPath, manifestBlob);

  if (state.canceledUploadIds.has(liveJob.id)) {
    clearUploadRetryTimer(liveJob.id);
    await dbDelete(UPLOAD_STORE, liveJob.id);
    return;
  }
  const manifestUrl = publicStorageUrl(manifestPath);
  await finalizeImageMessage(liveJob.id, manifestUrl, liveJob.chunks.length);
  clearUploadRetryTimer(liveJob.id);
  await dbDelete(UPLOAD_STORE, liveJob.id);
  state.canceledUploadIds.delete(liveJob.id);
  updateQueueSize();
  setComposerHint(liveJob.resumed ? 'Imagen enviada tras reanudar la subida.' : 'Imagen enviada.');
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

async function finalizeImageMessage(localId, manifestUrl, totalChunks) {
  const localMessage = state.messages.find((item) => item.local_id === localId);
  if (localMessage) {
    upsertMessage({
      ...localMessage,
      content: manifestUrl,
      status: 'sent',
      chunks_sent: totalChunks,
      chunks_total: totalChunks
    });
  }

  const payload = {
    sender: state.config.senderId,
    type: 'image',
    content: manifestUrl,
    timestamp: localMessage ? localMessage.timestamp : new Date().toISOString(),
    status: 'sent',
    chunks_total: totalChunks,
    chunks_sent: totalChunks,
    session_id: state.config.sessionId,
    local_id: localId
  };

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
  if (retryCount >= IMAGE_UPLOAD_MAX_RETRIES) {
    clearUploadRetryTimer(jobId);
    markMessageError(jobId);
    setComposerHint('No se pudo subir la imagen tras varios intentos. Puedes reenviarla.');
    return;
  }

  const nextRetryCount = retryCount + 1;
  liveJob.retryCount = nextRetryCount;
  await dbPut(UPLOAD_STORE, liveJob);
  markMessagePending(jobId);

  const waitMs = IMAGE_UPLOAD_RETRY_BASE_MS * (2 ** (nextRetryCount - 1));
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
  setComposerHint(`Reintentando imagen en ${Math.ceil(waitMs / 1000)}s...`);
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
  const { silent = false } = options;
  if (!isConfigured()) {
    return;
  }
  try {
    const remoteMessages = await fetchMessagesRemote();
    const remoteLocalIds = new Set();
    for (const rawMessage of remoteMessages) {
      const message = await hydrateIncomingMessage(rawMessage);
      if (message.id) {
        state.knownRemoteIds.add(message.id);
      }
      if (message.local_id) {
        remoteLocalIds.add(message.local_id);
      }
      upsertMessage(message);
      syncMessageReceipt(message);
    }
    pruneMissingSessionMessages(remoteLocalIds);
    persistKnownRemoteIds();
    state.lastSyncAt = new Date().toISOString();
    updateSyncSummary();
    if (!silent) {
      setComposerHint('Historial cargado.');
    }
  } catch (error) {
    console.error(error);
    if (!silent) {
      setComposerHint('No se pudo cargar el historial.');
    }
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
    let usedSecureFunction = false;

    if (secureEndpoint) {
      try {
        setComposerHint(`Solicitando reinicio seguro vía función ${secureEndpoint}...`);
        await resetRoomViaFunction(secureEndpoint);
        usedSecureFunction = true;
      } catch (secureError) {
        console.error(secureError);
        setComposerHint('La función segura falló. Intentando borrado directo por REST...');
      }
    }

    if (!usedSecureFunction) {
      setComposerHint('Borrando historial e imágenes de la sala...');
      const remoteMessages = await fetchMessagesRemote();
      for (const message of remoteMessages) {
        if (message && message.type === 'image' && message.content) {
          try {
            await deleteOwnImageAssets(message);
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
    setComposerHint(usedSecureFunction
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
  const response = await fetch(url, {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify({
      sender: state.config.senderId,
      session_id: state.config.sessionId,
      action: 'reset_room'
    })
  });
  if (!response.ok) {
    const raw = await response.text();
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
            upsertMessage(hydrated);
            syncMessageReceipt(hydrated);
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
      refreshHistory({ silent: true });
    }
  }, document.hidden || state.mode === 'Ultra-ligero' ? 30000 : 20000);
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
}

function getTargetImageKb() {
  if (state.mode === 'Ultra-ligero') {
    return 30;
  }
  if (state.mode === 'Inteligente') {
    return 50;
  }
  return 150;
}

function getMaxDimensionForMode() {
  if (state.mode === 'Ultra-ligero') {
    return 560;
  }
  if (state.mode === 'Inteligente') {
    return 800;
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
    const body = message.type === 'image'
      ? message.content || 'imagen-pendiente'
      : message.display_content || message.content;
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
    'La app usa subida por bloques de 5 KB hacia Storage y guarda un manifiesto JSON para reanudar y reconstruir imágenes con verificación SHA-256.'
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

function clearProfilePhoto() {
  localStorage.removeItem(STORAGE_KEYS.profilePhoto);
  elements.profileAvatarImg.removeAttribute('src');
  elements.profileAvatarImg.style.opacity = '0';
  if (elements.profileAvatarImgTopbar) {
    elements.profileAvatarImgTopbar.removeAttribute('src');
    elements.profileAvatarImgTopbar.style.opacity = '0';
  }
  syncProfileAvatarVisibility();
  setComposerHint('Imagen de perfil eliminada.');
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
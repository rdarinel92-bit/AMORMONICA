import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

type QueueRow = {
  id: string;
  receiver: string;
  retry_count: number;
  payload: {
    sender?: string;
    body?: string;
    message_id?: string;
    local_id?: string;
    session_id?: string;
    type?: string;
  };
};

type DeviceTokenRow = {
  token: string;
  platform: string;
};

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function importPrivateKey(privateKeyPem: string): Promise<CryptoKey> {
  const pem = privateKeyPem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');

  const binary = Uint8Array.from(atob(pem), (char) => char.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    binary.buffer,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  );
}

async function createAccessToken(serviceAccount: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  })));
  const unsignedJwt = `${header}.${payload}`;

  const key = await importPrivateKey(serviceAccount.private_key);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsignedJwt)
  );
  const jwt = `${unsignedJwt}.${base64UrlEncode(new Uint8Array(signature))}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`No se pudo obtener access token: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return String(data.access_token || '');
}

function buildNotificationBody(rawBody: string | undefined): string {
  const text = String(rawBody || '').trim();
  if (!text) return 'Tienes un mensaje nuevo';
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

function isUnregisteredError(errorText: string): boolean {
  const normalized = errorText.toUpperCase();
  return normalized.includes('UNREGISTERED') || normalized.includes('NOTREGISTERED');
}

async function sendFcmMessage(
  accessToken: string,
  projectId: string,
  deviceToken: string,
  sender: string,
  body: string,
  queueId: string,
  receiver: string,
  messageId: string,
  localId: string,
  sessionId: string,
  messageType: string,
) {
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        // Data-only high priority push allows background handlers to sync first.
        data: {
          event_type: 'chat_message',
          sender: sender || 'Nuevo mensaje',
          body,
          queue_id: queueId,
          receiver: receiver || '',
          message_id: messageId,
          local_id: localId,
          session_id: sessionId,
          message_type: messageType || 'text',
        },
        android: {
          priority: 'high',
          ttl: '86400s',
          collapse_key: sessionId || 'shared-room',
        },
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`FCM error ${response.status}: ${errorText}`);
  }
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const firebaseServiceAccountRaw = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON');
  const firebaseServiceAccountB64 = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON_B64');

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const resolvedServiceAccountRaw = firebaseServiceAccountRaw
    || (firebaseServiceAccountB64 ? atob(firebaseServiceAccountB64) : '');

  if (!resolvedServiceAccountRaw) {
    return new Response(JSON.stringify({ error: 'Missing FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_JSON_B64 secret' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
  });

  try {
    console.log(JSON.stringify({ level: 'info', request_id: requestId, event: 'dispatch_start' }));
    const requestBody = await req.json().catch(() => ({}));
    const requestedLimit = Number(requestBody?.limit || 10);
    const limit = Math.max(1, Math.min(50, Number.isFinite(requestedLimit) ? requestedLimit : 10));

    const { data: queueRows, error: queueError } = await admin
      .from('notification_queue')
      .select('id, receiver, retry_count, payload')
      .eq('status', 'pending')
      .or(`next_retry_at.is.null,next_retry_at.lte.${new Date().toISOString()}`)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (queueError) {
      throw new Error(queueError.message);
    }

    const items = (queueRows || []) as QueueRow[];
    if (items.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0, sent: 0 }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const serviceAccount = JSON.parse(resolvedServiceAccountRaw) as ServiceAccount;
    const accessToken = await createAccessToken(serviceAccount);

    let sent = 0;
    const failures: Array<{ id: string; error: string }> = [];

    for (const item of items) {
      const { error: claimError } = await admin
        .from('notification_queue')
        .update({ status: 'processing' })
        .eq('id', item.id)
        .eq('status', 'pending');

      if (claimError) {
        failures.push({ id: item.id, error: claimError.message });
        continue;
      }

      const { data: tokens, error: tokenError } = await admin
        .from('device_tokens')
        .select('token, platform')
        .eq('profile_id', item.receiver)
        .eq('platform', 'android')
        .eq('active', true);

      if (tokenError) {
        failures.push({ id: item.id, error: tokenError.message });
        await admin
          .from('notification_queue')
          .update({
            status: 'failed',
            retry_count: (item.retry_count || 0) + 1,
            next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
          })
          .eq('id', item.id);
        continue;
      }

      const deviceTokens = (tokens || []) as DeviceTokenRow[];
      if (deviceTokens.length === 0) {
        await admin
          .from('notification_queue')
          .update({ status: 'sent' })
          .eq('id', item.id);
        continue;
      }

      const sender = String(item.payload?.sender || 'Nuevo mensaje');
      const body = buildNotificationBody(item.payload?.body);
      const messageId = String(item.payload?.message_id || '').trim();
      const localId = String(item.payload?.local_id || '').trim();
      const sessionId = String(item.payload?.session_id || 'shared-room').trim();
      const messageType = String(item.payload?.type || 'text').trim();

      let successCount = 0;
      let lastError: string | null = null;

      for (const device of deviceTokens) {
        try {
          await sendFcmMessage(
            accessToken,
            serviceAccount.project_id,
            device.token,
            sender,
            body,
            item.id,
            item.receiver,
            messageId,
            localId,
            sessionId,
            messageType,
          );
          successCount += 1;
        } catch (error) {
          const errorText = String(error);
          lastError = errorText;

          if (isUnregisteredError(errorText)) {
            await admin
              .from('device_tokens')
              .update({ active: false })
              .eq('token', device.token);
          }
        }
      }

      if (successCount > 0) {
        sent += successCount;
        console.log(JSON.stringify({
          level: 'info',
          request_id: requestId,
          queue_id: item.id,
          receiver: item.receiver,
          message_id: messageId,
          event: 'push_sent',
          targets: successCount,
        }));
        await admin
          .from('notification_queue')
          .update({ status: 'sent' })
          .eq('id', item.id);

        if (messageId) {
          await admin
            .from('messages')
            .update({ status: 'delivered' })
            .eq('id', messageId)
            .eq('status', 'sent');
        }
      } else {
        const retryCount = (item.retry_count || 0) + 1;
        const delayMinutes = Math.min(30, Math.max(1, retryCount * 2));
        console.warn(JSON.stringify({
          level: 'warn',
          request_id: requestId,
          queue_id: item.id,
          receiver: item.receiver,
          message_id: messageId,
          event: 'push_failed',
          retry_count: retryCount,
          error: lastError || 'No delivery target available',
        }));
        failures.push({ id: item.id, error: lastError || 'No delivery target available' });
        await admin
          .from('notification_queue')
          .update({
            status: 'failed',
            retry_count: retryCount,
            next_retry_at: new Date(Date.now() + delayMinutes * 60 * 1000).toISOString()
          })
          .eq('id', item.id);
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      processed: items.length,
      sent,
      failures
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      request_id: requestId,
      event: 'dispatch_fatal',
      error: String(error),
    }));
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

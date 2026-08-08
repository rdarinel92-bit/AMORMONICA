import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type MessageRow = {
  id: string;
  type: string;
  content: string;
  session_id: string;
};

type ManifestChunk = {
  path?: string;
};

type ManifestPayload = {
  chunks?: ManifestChunk[];
  sessionId?: string;
  localId?: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function normalizeIdentity(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-');
}

function extractManifestPath(publicUrl: string, bucketName: string): string | null {
  try {
    const url = new URL(publicUrl);
    const marker = `/storage/v1/object/public/${bucketName}/`;
    const idx = url.pathname.indexOf(marker);
    if (idx < 0) {
      return null;
    }
    const path = url.pathname.slice(idx + marker.length);
    return path || null;
  } catch {
    return null;
  }
}

async function fetchManifest(
  admin: ReturnType<typeof createClient>,
  bucketName: string,
  manifestPath: string
): Promise<ManifestPayload | null> {
  const { data, error } = await admin.storage.from(bucketName).download(manifestPath);
  if (error || !data) {
    return null;
  }
  try {
    return (await data.json()) as ManifestPayload;
  } catch {
    return null;
  }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

Deno.serve(async (req) => {
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
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
  });

  try {
    const body = await req.json();
    const sender = normalizeIdentity(body?.sender);
    const sessionId = String(body?.session_id || '').trim();
    const bucketName = String(body?.bucket_name || 'chat-files').trim() || 'chat-files';

    if (!sessionId) {
      return new Response(JSON.stringify({ error: 'session_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (sender !== 'roberto') {
      return new Response(JSON.stringify({ error: 'forbidden: only roberto can reset room' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: rows, error: rowsError } = await admin
      .from('messages')
      .select('id,type,content,session_id')
      .eq('session_id', sessionId);

    if (rowsError) {
      return new Response(JSON.stringify({ error: rowsError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const messages = (rows || []) as MessageRow[];
    const storagePaths = new Set<string>();

    for (const message of messages) {
      if (message.type !== 'image' || !message.content) {
        continue;
      }

      const manifestPath = extractManifestPath(message.content, bucketName);
      if (!manifestPath) {
        continue;
      }

      storagePaths.add(manifestPath);
      const manifest = await fetchManifest(admin, bucketName, manifestPath);
      if (!manifest || !Array.isArray(manifest.chunks)) {
        continue;
      }

      for (const chunk of manifest.chunks) {
        const chunkPath = String(chunk?.path || '').trim();
        if (chunkPath) {
          storagePaths.add(chunkPath);
        }
      }
    }

    const pathList = Array.from(storagePaths);
    for (const pack of chunkArray(pathList, 500)) {
      const { error: removeError } = await admin.storage.from(bucketName).remove(pack);
      if (removeError) {
        return new Response(JSON.stringify({ error: removeError.message, stage: 'storage.remove' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    const { error: deleteError, count } = await admin
      .from('messages')
      .delete({ count: 'exact' })
      .eq('session_id', sessionId);

    if (deleteError) {
      return new Response(JSON.stringify({ error: deleteError.message, stage: 'messages.delete' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        session_id: sessionId,
        deleted_messages: count || 0,
        deleted_storage_objects: pathList.length
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

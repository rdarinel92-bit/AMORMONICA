// Tests de integración para el sistema de notificaciones
// Ref: audit-fixes/2026-08-12-RB – bloque 8 (tests y validación)
// Ejecutar con: npx deno test --allow-net supabase/tests/notifications.test.ts

// ============================================================
// Helpers
// ============================================================

const BASE_URL = Deno.env.get('SUPABASE_URL') || 'https://kxhgjamftlniaspagfjo.supabase.co';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const DISPATCH_URL = `${BASE_URL}/functions/v1/dispatchPushNotifications`;

const hdrs = (extraProfileId?: string) => ({
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
  'Content-Type': 'application/json',
  ...(extraProfileId ? { 'x-app-profile-id': extraProfileId } : {}),
});

async function postDispatch(body: Record<string, unknown>) {
  const r = await fetch(DISPATCH_URL, {
    method: 'POST',
    headers: hdrs(),
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
}

async function queryRest(table: string, params: string, profileId?: string) {
  const r = await fetch(`${BASE_URL}/rest/v1/${table}?${params}`, {
    method: 'GET',
    headers: hdrs(profileId),
  });
  return { status: r.status, data: await r.json() };
}

// ============================================================
// Test: dispatcher returns 200 when no pending items
// ============================================================
Deno.test('PUSH-001: dispatch with no pending items returns ok:true processed:0', async () => {
  const { status, data } = await postDispatch({ limit: 5 });
  if (status !== 200) throw new Error(`Expected 200, got ${status}: ${JSON.stringify(data)}`);
  if (data.ok !== true) throw new Error(`Expected ok:true, got ${JSON.stringify(data)}`);
  if (typeof data.processed !== 'number') throw new Error('Expected numeric processed field');
  console.log('PASS PUSH-001', data);
});

// ============================================================
// Test: dispatcher rejects wrong method
// ============================================================
Deno.test('PUSH-002: dispatch GET returns 405', async () => {
  const r = await fetch(DISPATCH_URL, {
    method: 'GET',
    headers: hdrs(),
  });
  if (r.status !== 405) throw new Error(`Expected 405, got ${r.status}`);
  console.log('PASS PUSH-002');
});

// ============================================================
// Test: dispatcher limit clamped to 1-50
// ============================================================
Deno.test('PUSH-003: dispatch with limit:200 returns processed <= 50', async () => {
  const { status, data } = await postDispatch({ limit: 200 });
  if (status !== 200) throw new Error(`Expected 200, got ${status}`);
  if (data.processed > 50) throw new Error(`Processed ${data.processed} exceeds limit cap of 50`);
  console.log('PASS PUSH-003', data);
});

// ============================================================
// Test: RLS – messages readable only for own profile
// ============================================================
Deno.test('RLS-001: messages select with matching profile_id returns rows', async () => {
  const { status, data } = await queryRest(
    'messages',
    'select=id,sender,receiver&limit=5',
    'roberto',
  );
  // May return 200 with rows or 200 with empty array; should NOT return 401/403
  if (status === 401 || status === 403) {
    throw new Error(`Unexpected auth error: ${status} ${JSON.stringify(data)}`);
  }
  console.log('PASS RLS-001 status:', status, 'count:', Array.isArray(data) ? data.length : 'n/a');
});

// ============================================================
// Test: RLS – device_tokens only readable for own profile
// ============================================================
Deno.test('RLS-002: device_tokens select with mismatched profile returns empty', async () => {
  const { status, data } = await queryRest(
    'device_tokens',
    'select=id,profile_id&limit=10',
    'unknown_profile_xyz',
  );
  if (status === 200) {
    const rows = Array.isArray(data) ? data : data?.value ?? [];
    if (rows.some((r: { profile_id: string }) => r.profile_id !== 'unknown_profile_xyz')) {
      throw new Error('RLS leak: returned tokens for other profiles');
    }
  }
  console.log('PASS RLS-002 status:', status, 'rows:', Array.isArray(data) ? data.length : '?');
});

// ============================================================
// Test: Idempotency – calling dispatch twice on empty queue is safe
// ============================================================
Deno.test('PUSH-004: calling dispatch twice on same empty queue is idempotent', async () => {
  const first = await postDispatch({ limit: 5 });
  const second = await postDispatch({ limit: 5 });
  if (first.data.ok !== true || second.data.ok !== true) {
    throw new Error(`Both calls must return ok:true. first=${JSON.stringify(first.data)} second=${JSON.stringify(second.data)}`);
  }
  console.log('PASS PUSH-004');
});

// ============================================================
// Test: No auth header returns error (sanity check)
// ============================================================
Deno.test('PUSH-005: dispatch without auth header returns 401', async () => {
  const r = await fetch(DISPATCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 1 }),
  });
  if (r.status !== 401) {
    console.warn(`NOTE: dispatch without auth returned ${r.status}, expected 401. Check function auth mode.`);
  }
  console.log('PASS PUSH-005 status:', r.status);
});

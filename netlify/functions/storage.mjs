// Netlify Function : stockage partagé via Netlify Blobs
// Reçoit { method, key, value } en POST, renvoie JSON.

import { getStore } from '@netlify/blobs';

const STORE_NAME = 'binova';

export default async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { method, key, value } = body || {};
  if (!method || !key) {
    return json({ error: 'Missing method or key' }, 400);
  }

  try {
    const store = getStore(STORE_NAME);

    if (method === 'get') {
      const v = await store.get(key);
      return json({ value: v === null ? null : v });
    }

    if (method === 'set') {
      if (value === undefined) return json({ error: 'Missing value' }, 400);
      await store.set(key, value);
      return json({ ok: true });
    }

    if (method === 'delete') {
      await store.delete(key);
      return json({ ok: true });
    }

    if (method === 'list') {
      const result = await store.list();
      return json({ blobs: result.blobs });
    }

    return json({ error: 'Unknown method' }, 400);
  } catch (e) {
    return json({ error: e.message || 'Storage error' }, 500);
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

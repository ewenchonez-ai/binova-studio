// Wrapper qui remplace `window.storage` par des appels à notre fonction Netlify.
// Les données sont stockées côté Netlify Blobs et partagées par toute l'équipe.

async function apiCall(method, key, value) {
  const res = await fetch('/.netlify/functions/storage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, key, value }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error || `Storage ${method} failed (${res.status})`);
  }
  return data;
}

export const storage = {
  async get(key) {
    const data = await apiCall('get', key);
    if (data.value === null || data.value === undefined) {
      throw new Error('Not found');
    }
    return { key, value: data.value };
  },
  async set(key, value) {
    await apiCall('set', key, value);
    return { key, value };
  },
  async delete(key) {
    await apiCall('delete', key);
    return { key, deleted: true };
  },
};

// Exposé aussi en global pour que le code existant qui utilise `window.storage` fonctionne
if (typeof window !== 'undefined') {
  window.storage = storage;
}

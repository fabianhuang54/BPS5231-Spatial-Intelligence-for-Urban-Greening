/** Tiny localStorage cache so public APIs are hit once per TTL. Failures are non-fatal. */
export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  try {
    const raw = localStorage.getItem('cc:' + key);
    if (raw) {
      const { t, v } = JSON.parse(raw);
      if (Date.now() - t < ttlMs) return v as T;
    }
  } catch { /* ignore */ }
  const v = await load();
  try { localStorage.setItem('cc:' + key, JSON.stringify({ t: Date.now(), v })); } catch { /* quota */ }
  return v;
}

export async function getJSON<T>(url: string, init?: RequestInit, timeoutMs = 30000): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return res.json();
}

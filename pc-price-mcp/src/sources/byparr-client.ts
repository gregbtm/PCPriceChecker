/**
 * Byparr REST client (github.com/ThePhaseless/Byparr) — a Camoufox-backed,
 * drop-in-compatible replacement for FlareSolverr's challenge-solving API.
 * Used as a final escalation tier after the stealth Playwright chain, for
 * pages protected by Cloudflare Turnstile / managed challenges that a plain
 * headless browser can't clear.
 *
 * Run the server: docker run -p 8191:8191 ghcr.io/thephaseless/byparr
 * Configure via Settings → Scraper → Byparr Server URL, or FlareSolverr
 * itself at the same URL — both speak the same protocol.
 */

export async function renderWithByparr(url: string, baseUrl: string): Promise<string | null> {
  const base = baseUrl.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'request.get', url, maxTimeout: 60_000 }),
      signal: AbortSignal.timeout(65_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { solution?: { response?: string } };
    return data?.solution?.response ?? null;
  } catch {
    return null;
  }
}

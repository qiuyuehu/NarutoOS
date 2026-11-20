// Crash and diagnostic logs must never keep a ticket-bearing URL. The game handoff
// supports entries such as /game?ticket=..., so recording the raw URL would persist
// login secrets. Keep only the origin and path, matching ResourceProbe.
export function redactURL(value: unknown): string {
  try {
    const target = new URL(String(value));
    if (!/^https?:$/.test(target.protocol)) return '';
    return target.origin + target.pathname;
  } catch {
    return '';
  }
}

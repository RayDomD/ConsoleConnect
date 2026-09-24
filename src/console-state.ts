// Stopgap for the needs-input bar until the per-tool readiness signal (roadmap 2.7) exists.
// Agent tools animate while they work, so a running session that prints nothing for a while
// is usually waiting on its owner. The bar's copy says "may" because this is inferred.

export const needsInputQuietMs = 8_000;

export function needsInput(input: { active: boolean; terminalFocused: boolean; lastOutputAt: number; now: number }) {
  return input.active && !input.terminalFocused && input.now - input.lastOutputAt >= needsInputQuietMs;
}

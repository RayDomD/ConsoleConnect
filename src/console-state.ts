// Per-tool readiness signal (orchestrator ADR Q6, roadmap 2.7). A console is ready when the tool's own
// input marker is the latest thing on screen and output has paused; a dialog drawn after it blocks it.
// Markers come from the tools' real idle screens; matching ignores whitespace because cursor moves
// often replace the spaces.

export type ConsoleReadiness = 'working' | 'ready' | 'blocked';

export const readyQuietMs = 800;
// Antigravity's signed-in input screen has not been captured yet, so it waits longer and relies on quiet.
export const unknownToolQuietMs = 3_000;
const screenTailChars = 6_000;

const readyMarkers: Record<string, string[]> = {
  claude: ['shift+tabtocycle', '?forshortcuts'],
  codex: ['askcodextodoanything', '?forshortcuts'],
};
const blockingMarkers = ['entertoconfirm', 'pressentertocontinue', 'doyoutrust', '(y/n)'];

// Terminal title, cursor, color, and charset sequences, so only printed text remains.
function stripEscapes(output: string) {
  return output.slice(-screenTailChars)
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?>]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()][0-9A-Za-z]/g, '');
}

function normalize(output: string) {
  return stripEscapes(output).replace(/\s+/g, '').toLowerCase();
}

const lastIndex = (text: string, markers: string[]) => Math.max(-1, ...markers.map(marker => text.lastIndexOf(marker)));

export function consoleReadiness(input: { tool: string; output: string; lastOutputAt: number; now: number }): ConsoleReadiness {
  const quietFor = input.now - input.lastOutputAt;
  if (quietFor < readyQuietMs) return 'working';
  const screen = normalize(input.output);
  const blockedAt = lastIndex(screen, blockingMarkers);
  const markers = readyMarkers[input.tool];
  if (!markers) return blockedAt >= 0 ? 'blocked' : quietFor >= unknownToolQuietMs ? 'ready' : 'working';
  const readyAt = lastIndex(screen, markers);
  if (blockedAt > readyAt) return 'blocked';
  return readyAt >= 0 ? 'ready' : 'working';
}

// The bar asks for the owner when a dialog blocks the tool, or when the tool answered them and waits again.
export function needsInput(input: { readiness: ConsoleReadiness; terminalFocused: boolean; lastInputAt: number; lastOutputAt: number }) {
  if (input.terminalFocused) return false;
  if (input.readiness === 'blocked') return true;
  return input.readiness === 'ready' && input.lastInputAt > 0 && input.lastOutputAt > input.lastInputAt;
}

// The Office shows a few readable lines of a shared console (roadmap 3.3), refreshed with presence.
const glimpseLines = 3;
const glimpseWidth = 200;

export function glimpse(output: string) {
  return stripEscapes(output)
    .split(/\r?\n|\r/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(-glimpseLines)
    .map(line => line.slice(0, glimpseWidth));
}

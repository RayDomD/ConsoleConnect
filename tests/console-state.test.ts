import { expect, test } from 'vitest';
import { consoleReadiness, needsInput, readyQuietMs, unknownToolQuietMs } from '../src/console-state';

const at = 1_000_000;
const quiet = at + readyQuietMs;

// Screens as the tools actually print them; cursor moves often strip the spaces.
const codexReady = '› Ask Codex to do anything\r\n  ? for shortcuts';
const codexUpdate = `${codexReady}\r\n✨ Update available! 1. Update now 2. Skip Press enter to continue`;
const claudeTrust = 'Quicksafetycheck:Isthisaprojectyoucreatedoroneyoutrust?❯No,exitYes,ItrustthisfolderEntertoconfirm·Esctocancel';
const claudeReady = '❯ Try "how does <filepath> work?"\r\n  ⏵⏵ auto mode on (shift+tab to cycle)';

test('a tool is ready once its input marker is the latest thing on screen and output pauses', () => {
  expect(consoleReadiness({ tool: 'codex', output: codexReady, lastOutputAt: at, now: quiet })).toBe('ready');
  expect(consoleReadiness({ tool: 'claude', output: `\x1b[2K${claudeReady}\x1b[0m`, lastOutputAt: at, now: quiet })).toBe('ready');
  expect(consoleReadiness({ tool: 'codex', output: codexReady, lastOutputAt: at, now: quiet - 1 })).toBe('working');
});

test('a dialog drawn after the input marker blocks it, whatever the spacing', () => {
  expect(consoleReadiness({ tool: 'codex', output: codexUpdate, lastOutputAt: at, now: quiet })).toBe('blocked');
  expect(consoleReadiness({ tool: 'claude', output: claudeTrust, lastOutputAt: at, now: quiet })).toBe('blocked');
  expect(consoleReadiness({ tool: 'claude', output: `${claudeTrust}\r\n${claudeReady}`, lastOutputAt: at, now: quiet })).toBe('ready');
});

test('a tool without a known marker is ready only after a longer quiet with no dialog', () => {
  expect(consoleReadiness({ tool: 'antigravity', output: 'Welcome', lastOutputAt: at, now: quiet })).toBe('working');
  expect(consoleReadiness({ tool: 'antigravity', output: 'Welcome', lastOutputAt: at, now: at + unknownToolQuietMs })).toBe('ready');
  expect(consoleReadiness({ tool: 'antigravity', output: 'Do you trust the contents of this project? enter Confirm', lastOutputAt: at, now: at + unknownToolQuietMs })).toBe('blocked');
});

test('the needs-input bar shows for a blocking dialog, or when the tool answered and waits again, while the owner looks away', () => {
  const base = { terminalFocused: false, readiness: 'ready' as const, lastInputAt: 0, lastOutputAt: at };
  expect(needsInput({ ...base, readiness: 'blocked' })).toBe(true);
  expect(needsInput(base)).toBe(false);
  expect(needsInput({ ...base, lastInputAt: at - 5_000 })).toBe(true);
  expect(needsInput({ ...base, lastInputAt: at - 5_000, terminalFocused: true })).toBe(false);
  expect(needsInput({ ...base, readiness: 'working', lastInputAt: at - 5_000 })).toBe(false);
});

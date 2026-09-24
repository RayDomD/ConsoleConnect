import { expect, test } from 'vitest';
import { needsInput, needsInputQuietMs } from '../src/console-state';

const lastOutputAt = 1_000_000;

test('a running tool that has gone quiet while its owner looks elsewhere may need input', () => {
  expect(needsInput({ active: true, terminalFocused: false, lastOutputAt, now: lastOutputAt + needsInputQuietMs })).toBe(true);
});

test('output within the quiet window means the tool is still working', () => {
  expect(needsInput({ active: true, terminalFocused: false, lastOutputAt, now: lastOutputAt + needsInputQuietMs - 1 })).toBe(false);
});

test('no prompt while the owner is in the terminal or the session has ended', () => {
  expect(needsInput({ active: true, terminalFocused: true, lastOutputAt, now: lastOutputAt + needsInputQuietMs * 10 })).toBe(false);
  expect(needsInput({ active: false, terminalFocused: false, lastOutputAt, now: lastOutputAt + needsInputQuietMs * 10 })).toBe(false);
});

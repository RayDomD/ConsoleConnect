// Tactile feedback for a renderer that rebuilds its DOM on every render.
// Capture positions before innerHTML replaces the tree, then animate from them afterward.

const EASE_OUT = 'cubic-bezier(.23,1,.32,1)';
const EASE_IN = 'cubic-bezier(.4,0,1,1)';
const GLIDE_MS = 220;
const DISMISS_MS = 180;
const PRESS_SOUND_KEY = 'console-connect.press-sound';

interface Offset { x: number; y: number }
export interface MotionState {
  task: Offset | null;
  tab: Offset | null;
  drawerOpen: boolean;
  toastOpen: boolean;
  messageIds: Set<string> | null;
  unread: number;
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function offsetOf(element: HTMLElement | null): Offset | null {
  return element ? { x: element.offsetLeft, y: element.offsetTop } : null;
}

export function captureMotion(root: HTMLElement): MotionState {
  const stream = root.querySelector('#team-chat-stream');
  return {
    task: offsetOf(root.querySelector<HTMLElement>('.task-list .active')),
    tab: offsetOf(root.querySelector<HTMLElement>('.task-tab.active')),
    drawerOpen: Boolean(root.querySelector('.chat-drawer')),
    toastOpen: Boolean(root.querySelector('.chat-toast')),
    messageIds: stream ? new Set([...stream.querySelectorAll<HTMLElement>('[data-message-id]')].map(item => item.dataset.messageId!)) : null,
    unread: Number(root.querySelector('.chat-count')?.textContent ?? 0),
  };
}

// Places a sliding indicator under the active item, gliding from where the previous one sat.
function indicate(container: HTMLElement | null, active: HTMLElement | null, className: string, previous: Offset | null) {
  if (!container || !active) return;
  const indicator = document.createElement('span');
  indicator.className = className;
  indicator.setAttribute('aria-hidden', 'true');
  indicator.style.width = `${active.offsetWidth}px`;
  indicator.style.height = `${active.offsetHeight}px`;
  const to = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
  indicator.style.transform = to;
  container.prepend(indicator);
  if (!previous || reduced() || (previous.x === active.offsetLeft && previous.y === active.offsetTop)) return;
  indicator.animate([{ transform: `translate(${previous.x}px, ${previous.y}px)` }, { transform: to }], { duration: GLIDE_MS, easing: EASE_OUT });
}

export function playMotion(root: HTMLElement, before: MotionState) {
  indicate(root.querySelector('.task-list'), root.querySelector('.task-list .active'), 'task-indicator', before.task);
  indicate(root.querySelector('.task-tabs'), root.querySelector('.task-tab.active'), 'tab-indicator', before.tab);
  if (!before.drawerOpen) root.querySelector('.chat-drawer')?.classList.add('chat-drawer-enter');
  if (!before.toastOpen) root.querySelector('.chat-toast')?.classList.add('chat-toast-enter');
  const count = root.querySelector('.chat-count');
  if (count && Number(count.textContent) > before.unread) count.classList.add('chat-count-pop');
  if (before.messageIds) {
    for (const message of root.querySelectorAll<HTMLElement>('#team-chat-stream [data-message-id]')) {
      if (!before.messageIds.has(message.dataset.messageId!)) message.classList.add('chat-message-enter');
    }
  }
}

// Plays the exit before state changes remove the element. Resolves immediately under reduced motion.
export async function dismiss(element: Element | null, keyframes: Keyframe[]) {
  if (!element || reduced()) return;
  await element.animate(keyframes, { duration: DISMISS_MS, easing: EASE_IN, fill: 'forwards' }).finished.catch(() => undefined);
}

export const drawerExit: Keyframe[] = [{ transform: 'none', opacity: 1 }, { transform: 'translateX(24px)', opacity: 0 }];

// Desktop has no haptics API. An optional, very short click stands in for it.
let audio: AudioContext | null = null;
export const pressSoundEnabled = () => localStorage.getItem(PRESS_SOUND_KEY) === 'on';
export function setPressSound(enabled: boolean) { localStorage.setItem(PRESS_SOUND_KEY, enabled ? 'on' : 'off'); }

export function installPressSound(root: HTMLElement) {
  root.addEventListener('pointerdown', event => {
    if (!pressSoundEnabled() || !(event.target as HTMLElement).closest('button:not(:disabled)')) return;
    audio ??= new AudioContext();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = 1800;
    gain.gain.setValueAtTime(0.04, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.03);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.035);
  });
}

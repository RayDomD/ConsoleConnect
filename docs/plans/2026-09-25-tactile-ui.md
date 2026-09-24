---
title: Tactile UI pass and sidebar settings button
date: 2026-09-25
status: Done
summary: Replace the generic look with tuned type, soft elevation, status marks, and tactile motion; move Settings to a bottom-left button; apply the same treatment to team chat.
---

# Tactile UI pass and sidebar settings button

## Context

The app reads as generic: system Georgia and Segoe UI, flat 1px border boxes, text-only status, and no transitions anywhere. The user approved the proposed direction from the before/after preview (`docs/mockups/2026-09-25-tactile-ui.html`) and asked for a dedicated bottom-left settings button and the same treatment in the new team chat.

## Decisions

- Layout stays as the Review Desk and `docs/mockups/2026-09-24-team-chat-messenger.html`. This is a Lane B refinement.
- Self-hosted Newsreader (display) and Instrument Sans (UI) via Fontsource, `font-display: swap`. The terminal keeps Consolas so xterm glyph metrics stay stable.
- Settings moves out of the top bar into a gear button at the sidebar bottom, next to the member identity. The unused top-bar theme picker markup is removed; the theme lives in Settings only.
- Desktop has no haptics API. Tactility is visual (press scale, easing) plus an optional soft click sound, off by default, stored per computer.
- `render()` rebuilds via `innerHTML`, so sliding states (task selection, tab underline) use a FLIP helper, and entrance animations run only on the transition that opens them (drawer open, new message arrival).
- All motion honors `prefers-reduced-motion`.

## Steps

1. Fonts: add packages, copy woff2 into `dist/fonts` in `scripts/build.mjs`, `@font-face` in `styles.css`.
2. Base tokens: easing, shadows, radius; buttons, focus ring, panels, tabs, task list, status dots.
3. Sidebar bottom: identity plus gear settings button; remove top-bar Settings and theme select.
4. Motion helper for task indicator and tab underline.
5. Chat: drawer enter/exit, message arrival, Send press, unread pop, toast enter, sentence-case labels.
6. Optional click sound setting.

## Verification

`npm run typecheck`, `npm test`, `npm run smoke` with screenshots of workspace and chat drawer, Impeccable detector over changed CSS.

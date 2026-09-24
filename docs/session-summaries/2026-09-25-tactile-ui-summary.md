# Tactile UI pass: summary

Plan: `docs/plans/2026-09-25-tactile-ui.md`. Mockup: `docs/mockups/2026-09-25-tactile-ui.html`.

## Shipped

- Self-hosted Newsreader (display) and Instrument Sans (UI) via Fontsource, copied to `dist/fonts` by `scripts/build.mjs`. Tabular figures app-wide. Terminal keeps Consolas.
- Buttons: 0.97 press scale, 120–150ms ease-out, layered depth on primary, inset hairline on secondary, accent focus ring. Inputs get an accent focus halo.
- Action panel, package summary, setup forms, console: soft layered shadows instead of 1px border boxes.
- Sidebar: sliding selection card, shape-coded status dots, bottom-left identity row with a gear Settings button. Settings removed from the top bar; dead top-bar theme picker markup removed (theme lives in Settings).
- Tabs: gliding underline.
- `src/motion.ts`: captures positions before `render()` replaces the DOM and animates from them (WAAPI), plus one-shot entrance classes for the chat drawer, toast, new messages, and unread badge. Drawer exit animates before close.
- Optional soft click on button press, off by default, toggled in Settings > Appearance.
- Chat: borderless bubbles with soft lift, sentence-case composer label, "WORKSPACE" kicker removed, tinted quote and reply preview instead of colored side borders.
- All motion respects `prefers-reduced-motion`.

## Deviations

- Fixed a pre-existing chat drawer bug: the drawer inherited `aside` padding and had no background, so the right rail showed through.
- Replaced pre-existing colored side borders on chat quotes and reply preview (detector finding).
- `scripts/smoke.mjs` waits 400ms before the drawer screenshot so the entrance settles.
- JetBrains Mono from the mockup was not added; Consolas stays for stable xterm metrics.

## Checks

- `npm run build` (typecheck + build): pass.
- `vitest run`: 32 passed, 0 failed.
- `node scripts/smoke.mjs --screenshot`: passed 5 of 6 runs; one run failed at "Unsend did not reach the team chat" after a CSS-only change and passed on both re-runs, so it reads as a timing flake.
- Impeccable detector: one remaining warning, Instrument Sans flagged as an overused font; kept because the user approved it in the mockup.
- Screenshots reviewed: workspace, settings, chat page, chat drawer. Glide and press motion were exercised by the smoke run without errors but not inspected frame by frame.

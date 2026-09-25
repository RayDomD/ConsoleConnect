# The Office: summary

ADR: `docs/adr/2026-09-25-office.md` (Q17, Q18). Roadmap Phase 3, items 3.1–3.4, one commit each.

## Shipped

- 3.1 Presence: each app sends a heartbeat every 20 seconds and on changes (here or away, the running console, whether it needs input, and a three-line glimpse only when shared). Heartbeats never touch the revisioned state: the local host keeps them in memory, the Supabase host in a server-only `console_presence` table. `/state` reports every member, offline after a minute of silence.
- 3.2 View-only console sharing on Supabase-hosted workspaces over Realtime broadcast on private `console-terminal:<workspace>:<task>` topics. Policies let members listen and only the task's assignee send.
- 3.3 The Office: Needs a hand, Building, Reviewing, Planning, and Around, derived from presence and task state (`src/office.ts`). Cards show the person, task, tool, and glimpse or "Console is private" with Ask to watch; Watch opens the viewer; huddles show who watches whom; cards ease into new places over 400ms, never under reduced motion.
- 3.4 The first console asks whether to show it in the Office and remembers the choice (Settings > Office). One `role="switch"` control, "Shown in Office" or "Private", in the console strip and the Office header, with Ctrl+Shift+S; Pause output; Undo for the owner and a polite "stopped sharing" message for viewers.

## Deviations and decisions

- Presence is a heartbeat over the same HTTP path as commands on both hosts, rather than Supabase Realtime Presence, so one model serves both hosts and stays testable.
- Reviewing means submitted work the person handed out; Around lists offline people too.
- Empty rooms other than Needs a hand and Around are hidden.
- Ask to watch posts a request in the task discussion.

## Bugs found and fixed along the way

- Heartbeats were skipped after switching project or identity, because the unchanged-payload check ignored who was sending.
- The Office sharing prompt could outlive a project switch.

## Checks

- `vitest run`: 73 passed, including presence on the local and hosted cores and room derivation.
- `npm run check:hosted-schema`: passes with both new migrations, including Realtime policy checks (assignee sends, member listens, nonmember gets nothing) against a stubbed `realtime.messages`.
- `node scripts/smoke.mjs --screenshot`: presence reaches the host, the Office shows rooms and a shared card with its glimpse, and the sharing prompt is answered and remembered.
- Against real Claude Code: the sharing prompt and the switch in the strip.

## Not done

- The two new Supabase migrations and the updated Edge Function are not deployed, so hosted presence and hosted sharing have not run against the live project. Deploying is an external step to confirm first.

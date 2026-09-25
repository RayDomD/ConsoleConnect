# Orchestrator and workers: summary

Spec: `docs/plans/2026-09-25-orchestrator-spec.md` (Done). ADR: `docs/adr/2026-09-25-orchestrator.md`. Roadmap Phase 2, items 2.0–2.13, one commit each unless noted.

## Shipped

- 2.1 `console-connect` CLI: a per-user pipe to the running app; main relays to the renderer, which runs commands as the person with its existing session (`src/cli`, `src/orchestrator`, `src/cli-server.ts`). Shims in `<userData>/bin` run it on Electron's runtime and lead PATH in every console.
- 2.2 `via` on commands (set only by the CLI), `assignedBy` and `via` on tasks, `via` on messages; "Assigned by Blair via Codex" and "via Codex" in the UI.
- 2.3 Accept, request changes, approve decision, and approve task refuse `via`; `review propose` queues a confirmation card that only a click sends. `package show`.
- 2.4 Owner-set assigning rule (anyone, Owners and Reviewers, Owner only), enforced in the shared `applyCommand` for both hosts; shown in the Team section.
- 2.5 `decline-task`, a Decline form, and an Assigned by me rail grouped by state.
- 2.6 Orchestrator console in the main folder with Assigned by me and CLI activity; Settings > Command line.
- 2.7 Per-tool readiness from real Claude Code and Codex idle screens; the task brief is typed into a new console without Enter; the needs-input bar follows the signal.
- 2.8 `package draft` plus Git facts from the worktree; a read-only package card with inline Edit and Submit; a drafted bar in the console.
- 2.9 Submissions, questions, stalls, and declines on handed-out work are typed into the orchestrator console as one line; `report-session` carries stalls across computers.
- 2.10 Settings > Orchestrator: master switch, Ask me or Auto per event, daily limit, Auto badge with Pause, a log, and held hand-outs.
- 2.11 Replies and change requests typed into the worker's task console; a decision-changed banner with Acknowledge and tell.
- 2.12 Full `brief` and `brief --task`; an opener typed into a new orchestrator console.
- 2.13 Project map (`docs/README.md`), drafting, protected tags, reviewer warning, and drift flags in the brief.

## Deviations and decisions

- Main only relays pipe requests; the renderer runs them, so no credential or session is duplicated.
- The macOS/Linux socket lives in `XDG_RUNTIME_DIR` or the temp folder, since the CLI cannot know the app's data folder.
- View-only sharing of the orchestrator console is not built: sharing is keyed to tasks on the host.
- Readiness markers exist for Claude Code and Codex; Antigravity waits for a longer quiet until its signed-in input screen is captured.
- Follow-up hand-outs during an automatic run are held in a Held for you rail with Send and Discard instead of being typed into the console that is still busy running.
- Workspace-level actions moved above the renderer's no-task guard after the orchestrator did nothing in an empty workspace.

## Bugs found and fixed along the way

- Request changes used `prompt()`, which Electron lacks, so it could never send; now an inline form.
- Terminal focus reports counted as the person typing, which kept the needs-input bar up.
- Resizing, writing to, or stopping a console whose tool had just exited crashed the main process with a blocking dialog.
- The orchestrator's event queue survived a project switch and counted a person's own tasks.

## Checks

- `vitest run`: 68 passed (domain, CLI pipe, commands, brief, readiness, events, automatic policy, worker events, project map, worktree facts).
- `node scripts/smoke.mjs --screenshot`: passes and drives the shim end to end (list, create, reply via a tool, brief with the map, package draft, review propose and confirm, decline, request changes, assigning rule, orchestrator console, automatic settings, badge and Pause).
- Against real Claude Code in scratch repositories: trust dialog counted as blocked, brief typed only once ready, the orchestrator received a real submission as a typed line and sent nothing, and the opener waited for Enter.
- Not exercised: auto-send against a real tool (it would spend a real prompt), the decision banner end to end (approving a decision requires GitHub verification), and Stop in the smoke (its test tools exit at once).

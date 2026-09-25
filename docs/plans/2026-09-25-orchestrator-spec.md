---
title: Orchestrator and workers spec
date: 2026-09-25
status: In Progress
summary: Contracts and tickets for roadmap Phase 2 (2.1–2.13), from the orchestrator ADR Q1–Q13.
---

# Orchestrator and workers spec

## Status & Progress Summary

Spec written 2026-09-25 from `docs/adr/2026-09-25-orchestrator.md`. Tickets below map one-to-one to roadmap items 2.1–2.13. Progress is tracked per ticket.

## Context

Any member can orchestrate, by hand or with their own AI tool. The tool acts as the person, through a `console-connect` command that reaches the person's running app. Approvals stay with people. Mockups are the decisions: `docs/mockups/2026-09-25-orchestrator-*.html`, `assigning-rule.html`, `package-autofill.html`, `worker-events.html`, `project-map.html`, `protected-doc-changes.html`.

## Contracts

### Domain (shared `applyCommand`, so both hosts enforce it)

- Every command may carry `via?: Tool`. The app sets it for commands that arrive through the CLI; people's clicks never set it.
- `Task` gains `assignedBy?: memberId` and `via?: Tool` (the tool that created or last assigned it). `Message` gains `via?: Tool`.
- Workspace state gains `settings.assigningRule: 'anyone' | 'leads' | 'owner'` (default `anyone`). `leads` means owners and reviewers assign; contributors claim, or create unassigned tasks and suggest an assignee in a message. `owner` means only the owner assigns. The rule covers `assign-task` and `create-task` with an assignee other than the actor. Self-assignment through claim is always allowed.
- New commands:
  - `set-assigning-rule { rule }`: owner only.
  - `decline-task { taskId, revision, note? }`: the assignee, while `awaiting_approval` or `ready`. The task returns to `unassigned`, clears the assignee, and posts the note to the task discussion when given.
- Click-only commands reject `via`: `accept-package`, `request-changes`, `approve-decision`, `approve-task`. Error 403 "This needs a click in Console Connect."
- Snapshots of older states default `settings` and tolerate missing fields.

### Local pipe (2.1)

- The app listens on a per-user endpoint: `\\.\pipe\console-connect-<username>` on Windows, `<userData>/console-connect.sock` elsewhere. Windows' default pipe ACL gives write access only to the creating user, SYSTEM, and administrators.
- Protocol: one JSON request per connection, `{ version: 1, command: string[], cwd: string, tool?: Tool }`, and one JSON reply `{ ok: true, data } | { ok: false, error }`.
- The app runs the request with its current workspace connection (local host or Supabase) and its existing session. No credential is stored for the CLI. With no open workspace, the reply says so. With the app closed, the CLI prints "Open Console Connect to use console-connect." and exits 2.
- The task context comes from `cwd`: inside a task worktree (`<userData>/worktrees/<taskId>`), commands default to that task.

### CLI (2.1)

- `console-connect <group> <verb> [args] [--json]`. Text for people by default; `--json` prints the raw reply for tools. Exit 0 on success, 1 on a rejected command, 2 when the app is unreachable.
- Bundled as `dist/cli.cjs` with a `console-connect.cmd` (Windows) and `console-connect` (POSIX) shim in `dist/bin`. The built-in consoles prepend `dist/bin` to `PATH`. Settings shows the folder to add for outside terminals.
- Commands: `brief [--task <id>]`, `task list`, `task show <id>`, `task create --title --description [--assignee <name>]`, `task assign <id> <name>`, `task claim <id>`, `task decline <id> [--note]`, `task reply <id> <text>`, `ask <text>` (posts to the current task), `package draft --summary [--checks] [--questions]`, `package show <id>`, `review propose <id> --accept|--changes --note <text>`, `events`.
- Task ids accept the full id or an unambiguous prefix. Names match members case-insensitively.

### Proposals (2.3)

`review propose` never sends a review. The app shows a confirmation card ("Needs your confirmation · via Codex") with Edit, the opposite action, and the proposed action. Only the click sends the command, without `via`.

### Consoles (2.6, 2.7)

- Orchestrator entry above Team chat. It opens a workspace-level console in the linked main folder (no worktree), with the tool picker and `console-connect` on `PATH`. The strip reads "Main folder · no worktree". The rail shows "Assigned by me" and "CLI activity".
- Opener (2.12): when a console starts and the tool is ready, the app types, without Enter, "Run console-connect brief to see the team, the rules, and open tasks, then wait for instructions." Workers get `brief --task`.
- Brief typed in (2.7): a worker's task console types the task brief (title, description, decision notes, and the package-draft instruction) once the tool is ready, without Enter.
- Readiness signal (2.7): per tool, a console is ready when its output shows the tool's input prompt and then goes quiet. It falls back to quiet output alone. It replaces the needs-input stopgap in `src/console-state.ts`.

### Package draft (2.8)

`package draft` saves a draft package: summary, verification from `--checks`, questions, `sourceRef` = the task branch, deliverables = changed files since the branch began, and the pull request URL when one is recorded. The package tab shows a read-only card: summary and questions are editable inline, Git facts are not, plus Submit. Draft work package does the same from the app when the tool skips it.

### Events (2.9–2.11)

- Orchestrator side: submissions, questions (`ask`), stalls (needs-input or exit without a package), and declines on tasks the person assigned. Each is queued and typed into the orchestrator console as one line, not sent. Several pending events combine into one line.
- Worker side: answers and comments on the worker's task are typed into that task console. Change requests and decision changes never auto-send, and decision changes need acknowledgement in the app first.
- Automatic setting, per person, stored locally (Settings › Orchestrator): a master switch (off by default), Ask me or Auto for questions, stalls, and submissions, and a daily limit on automatic runs (default 20). Auto presses Enter for that event. Follow-up assignments from an automatic run are typed in, never sent. The orchestrator strip shows an Auto badge, the count, Pause, and a log. Auto stops when the app closes, the limit is reached, or on Pause.

### Knowledge (2.12, 2.13)

- `brief` prints: workspace and repository, the team and roles, the assigning rule as it applies to the caller, open tasks by state, the caller's automatic settings, which actions need a click, the command guide, and the project map entries. `brief --task` adds the task, its decisions, and the package instruction.
- Project map: `docs/README.md`, a Markdown list of `- path — what it is; when to read it` with an optional `(protected)` tag. The app can draft it from the repository's docs. The team commits it. The brief reads it from the main folder for the orchestrator and from the worktree for workers.
- Protected documents: a package whose deliverables touch a protected path shows a warning to the reviewer. The brief flags decision files whose text differs from the approved decision, and protected documents changed on main by commits that are not any package's source.

## Tickets

| # | Ticket | Acceptance |
|---|---|---|
| 2.1 | Pipe server in main, CLI client, shims, PATH in consoles; `task list/show/create/claim/reply`, `brief` stub | CLI round trip against a running app in a test; clear exit 2 with the app closed |
| 2.2 | `via` on commands, `assignedBy`, "via Codex" marker in the task meta and messages | Domain tests; marker visible in the app |
| 2.3 | Click-only enforcement and `review propose` confirmation card | Host rejects click-only with `via`; card confirms and sends |
| 2.4 | Assigning rule command, Settings control (owner), host enforcement | Domain tests for all three rules on both hosts |
| 2.5 | `decline-task` and the "Assigned by me" rail grouped by state | Domain tests; rail renders grouped |
| 2.6 | Orchestrator console in the main folder | Launch from the entry; `console-connect` resolves inside it |
| 2.7 | Readiness signal and typed-in task brief | Unit tests for readiness; brief typed without Enter |
| 2.8 | `package draft` and the auto-filled package card | Draft saved with Git facts; card read-only for Git facts |
| 2.9 | Orchestrator event queue typed into the console | Events combine into one typed line |
| 2.10 | Automatic setting, limit, badge, Pause, log | Unit tests for the policy; strip shows the state |
| 2.11 | Worker-side events | Answers typed into the task console; change requests never auto-send |
| 2.12 | Full `brief` and the opener | Brief content test; opener typed on ready |
| 2.13 | Project map, protected tags, drift flags | Parser tests; reviewer warning; brief flags |

## Verification

Typecheck, vitest (domain, CLI parsing, brief, readiness, event policy), `node scripts/smoke.mjs` extended with a CLI round trip, and screenshots of each new surface.

## Changelog

- 2026-09-25: Spec written from the orchestrator ADR; tickets 2.1–2.13 defined. Next: 2.1.

---
title: Guided path spec
date: 2026-09-25
status: Done
summary: Contracts and tickets for roadmap 4.1, from the guided path ADR Q14–Q16 and the stage grilling Q19–Q24.
---

# Guided path spec

## Status & Progress Summary

Spec written 2026-09-25 after the stage grilling (ADR Q19–Q24). All tickets 4.1a–4.1g done on 2026-09-25, one commit each (summary: `docs/session-summaries/2026-09-25-guided-path-summary.md`).

## Context

`docs/adr/2026-09-25-guided-path.md` and the mockups `docs/mockups/2026-09-25-guided-path.html` and `-sizes.html`. Plain tasks keep working without ideas.

## Contracts

### Idea record (Q19, Q20)

- `Idea { id, title, note, size: 'quick' | 'feature' | 'big', stage, createdBy, createdAt, revision, readyBy?, skipped: {stage, reason, by}[], documents: {stage, path}[], taskIds: string[], specDecisionId?, sample? }`, in workspace state beside tasks, so both hosts get it through `applyCommand`.
- Stages in order: `talk` (Talk it through), `write` (Write it up), `split` (Split into tasks), `build` (Build), `review` (Review), then `done`. Paths by size: quick = build, review; feature = talk, split, build, review; big = all five.
- Commands: `create-idea`, `update-idea` (title, note, size; the stage moves to the first stage of the new path it has not passed), `mark-idea-ready` (Owner or Reviewer, on `talk`), `advance-idea` (checks the gate), `skip-idea-stage` (anyone, reason 1–200 characters), `link-idea` (a document path for a stage, or task ids), `delete-idea`.
- Gates on `advance-idea`: `talk` needs `readyBy`; `write` needs `specDecisionId` pointing at an official decision; `split` needs at least one linked task; `build` needs every linked task accepted or completed; `review` needs every linked task completed. A skipped stage passes.

### Blockers (Q21)

- `Task.after?: string[]`, set by `create-task` (`--after` in the CLI). `start-task` refuses with 409 "Waiting on <title>" while any blocker is not accepted or completed. Cards and the console launch show "Waiting on <task>".

### Playbooks (Q22)

- `console-connect playbook <talk|write|split|build|review> [idea]` prints the stage instructions: the repo's `docs/playbooks/<stage>.md` when present, otherwise the built-in text. Each opens with one line on what the stage is for and what it produces. `idea list/show/create` and `idea link` join the CLI.

### Recommendations (Q23)

- Next step = the next stage on the size path with a fixed reason; a size change is suggested when a Quick fix links more than one task or a Feature's talk document mentions several sessions (heading "Sessions" or more than three tasks linked). Shown on the card, and typed into the orchestrator console as an update when an idea reaches a new stage.

### Sample idea (Q24) and docs scaffold

- A workspace created in the app gets the sample idea once. `sample: true` marks it; Delete removes it.
- Setup offers "Set up the project docs?": missing folders and a drafted project map are committed on a `console-connect/docs-scaffold` branch in the main folder and pushed, and a pull request is opened with the GitHub CLI when available. Existing files are never overwritten. "Use my own structure" and Skip are offered.

## Tickets

| # | Ticket | Acceptance |
|---|---|---|
| 4.1a | Idea record, commands, gates, paths | Domain tests for sizes, gates, skips, and size changes |
| 4.1b | Task blockers | Domain test; CLI `--after`; "Waiting on" in the UI |
| 4.1c | Playbooks and idea CLI | Tests for built-in and repo override; CLI round trip |
| 4.1d | Ideas view: cards, New idea with sizes, skip, gate buttons | Smoke creates, advances, skips, and deletes |
| 4.1e | Recommendations and orchestrator updates | Unit tests for the rules |
| 4.1f | Sample idea | Smoke sees it in a new workspace |
| 4.1g | Docs scaffold branch and pull request | Test against a local bare remote |

## Changelog

- 2026-09-25: Spec written from the ADR and the stage grilling.
- 2026-09-25: 4.1a–4.1g built. Playbooks take stage names and accept the ADR's grill, spec, and tickets as aliases. The sample idea is sent by the app after it creates a workspace, so hosted workspaces need no migration. The card's size suggestion uses the task count; the "Sessions" heading rule is implemented but the card does not read the talk document yet.

# Guided path: summary

ADR: `docs/adr/2026-09-25-guided-path.md` (Q14–Q16, Q19–Q24). Spec: `docs/plans/2026-09-25-guided-path-spec.md`, tickets 4.1a–4.1g, one commit each. Roadmap Phase 4.

## Shipped

- 4.1a Ideas are host records beside tasks, on both hosts through `applyCommand`. The size sets the path (Quick fix: build, review; Feature: talk, split, build, review; Big idea: all five). `advance-idea` enforces each stage's gate, `skip-idea-stage` records a reason, and a size change lands on the first stage of the new path not yet passed. Marking an idea ready is Owner or Reviewer only and click-only. States saved before this read `ideas` as empty, so neither host needs a migration.
- 4.1b `create-task` takes `after` blockers (CLI `--after <id,id>`). `start-task` refuses with 409 "Waiting on <title>" until each blocker is accepted or completed, and the task list and console strip show "Waiting on" in place of the launch button.
- 4.1c `console-connect playbook <stage> [idea]` prints built-in stage instructions, each opening with what the stage is for and what it produces, or the repo's `docs/playbooks/<stage>.md` when present. Naming an idea adds its file path. `idea list/show/create/link` join the CLI. The project map knows `docs/playbooks/`.
- 4.1d The Ideas view, built to the two guided path mockups: cards with stage chips (ticked, struck through when skipped, filled for the current stage), the host's gate text, Mark ready, Next step, Skip stage with a one-line reason, size change, and Delete. New idea picks a size from three tiles and previews its stages; the draft survives live renders.
- 4.1e `recommendNext` gives the next stage on the size path with a fixed reason; `suggestSize` proposes Feature for a Quick fix with several tasks and Big idea for a Feature with more than three tasks or a "Sessions" heading. Cards show both, with one click to resize. The orchestrator hears when an idea reaches a new stage.
- 4.1f A workspace created in the app gets "Add a welcome note to the README", a Feature at Talk it through, marked Sample.
- 4.1g The Owner is offered "Set up the project docs?" atop Ideas once the project folder is known. Create docs PR commits only the missing folders and a drafted project map on `console-connect/docs-scaffold`, built in a temporary worktree so the checkout and uncommitted work stay untouched, pushes it, and opens a pull request with the GitHub CLI when it can. "Use my own structure" and Skip dismiss it.

## Deviations and decisions

- Playbooks use stage names (`talk`, `write`, `split`, `build`, `review`) as the spec says; the ADR's `grill`, `spec`, and `tickets` still work as aliases.
- The build and review gates also need at least one linked task, so a gate never passes on an empty list.
- The sample idea is sent by the app right after it creates a workspace (revision 1, no ideas), not seeded by the host, so hosted workspaces need no migration.
- The docs offer sits atop the Ideas view for the Owner rather than as a third setup step, since the app has no multi-step setup; it needs the project folder.
- The card's size suggestion uses the task count only. The "Sessions" heading rule is implemented and tested, but the card does not read the talk document yet.
- Gate rules moved into the protocol module so the host and cards share one copy; `waitingOn` lives in `src/blockers.ts` for the same reason.

## Checks

- `npm run build` (typecheck and bundle): passes.
- `vitest run`: 87 passed (73 before this phase), including ideas on the host, blockers, playbooks and the idea CLI, recommendations, and the docs scaffold against a local bare remote.
- `node scripts/smoke.mjs --screenshot`: the new workspace shows the sample idea; an idea is created with a size, marked ready, advanced, held at its gate, linked through the CLI, skipped with a reason, and deleted, all by clicks; a blocked task shows "Waiting on". Screenshots `dist/ideas.png` and `dist/sample-idea.png`.

## Critique and audit (Ideas view)

- Critique (two Sonnet 5 sub-agents, design review and detector): 22/40 before fixes; detector 0 findings; CRAFT check 9/10, the miss being 12–13px card text, an app-wide convention. Snapshot in `.impeccable/critique/`. A reported P0 (skip reason only in a tooltip) was a false alarm: the card lists each reason as text.
- Fixed from the critique (P1, P2s): stage work in plain words with the playbook command behind Copy command, a plain Then line, a muted resize nudge instead of warning color, section labels for files, tasks, and skips, and a Delete confirmation (the sample idea keeps one-click delete per Q24; a true undo needs a host command that does not exist).
- Audit: detector clean; text contrast passes AA (muted 5.05–5.46, warning 5.80, chips 5.52–6.84). Fixed: skipped chips' 0.7 opacity (about 3:1), and the card's size select, which resized on every arrow key and now sends only the settled choice.

## Not done

- The docs setup card is not covered by the smoke run; the scaffold itself is tested against a bare remote, and `gh pr create` was not run against GitHub.
- The Supabase migrations and Edge Function from Phase 3 are still not deployed. Phase 4 adds no migration, but the deployed Edge Function needs this build for hosted ideas.

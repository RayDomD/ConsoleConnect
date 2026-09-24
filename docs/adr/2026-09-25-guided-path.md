# Guided path from idea to shipped work

Status: accepted direction. Stage details need their own grilling before a spec.

Every workspace gets the same systematic path, built on existing mechanisms. See [the guided path mockup](../mockups/2026-09-25-guided-path.html).

## Stages

| Stage (UI name) | Playbook | Writes | Gate |
| --- | --- | --- | --- |
| Idea | none | Idea card | None |
| Talk it through | `console-connect playbook grill` | `docs/ideas/<idea>.md` | Owner or Reviewer marks ready |
| Write it up | `playbook spec` | `docs/specs/<idea>.md` | Approved as a decision |
| Split into tasks | `playbook tickets` | Tasks, `docs/plans/<date>-<idea>.md` | Assigning rule |
| Build | existing task flow | Branch, worktree, package | Recipient approval |
| Review | `playbook review` | `docs/session-summaries/<idea>.md` | Acceptance and GitHub merge |

Playbooks print stage instructions for any orchestrating tool, as described in [the orchestrator ADR](2026-09-25-orchestrator.md). Each opens by saying in one line what the stage is for and what it produces.

## Decisions

- **Q14. Guided, not strict.** Each idea has a card showing its stage, files, and next step. A stage can be skipped with a one-line reason, which is recorded. Plain tasks still work without an idea.
- **Q15. Size sets the path.** A new idea picks Quick fix (build, review), Feature (talk it through, split into tasks, build, review), or Big idea (all stages). The size can change later. The UI uses plain stage names. Playbook names stay in commands. New workspaces include one sample idea that can be deleted. See [the sizes mockup](../mockups/2026-09-25-guided-path-sizes.html).
- **Q16. Stages recommend the next step.** When an idea reaches a stage, its card and the orchestrator console suggest what fits next, with one line of why. For example, after "Talk it through" it suggests "Write it up next: run `console-connect playbook spec`, because this spans several sessions." Suggestions name Console Connect's tool-neutral playbooks, not commands specific to one AI tool.
- **Docs scaffold.** Workspace setup offers to add missing folders (`docs/README.md`, `ideas/`, `specs/`, `plans/`, `decisions/`, `adr/`, `mockups/`, `session-summaries/`) on a branch with a pull request. Existing files are never overwritten. "Use my own structure" and Skip are offered.

## Open

Idea records and cards, blocked-by ordering between tasks (`--after`), stage gates, playbook content, recommendation rules, and the sample idea are new work. They need their own grilling before a spec.

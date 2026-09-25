---
target: Ideas view
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
timestamp: 2026-09-25T11-10-37Z
slug: src-renderer-ts-ideas
---
Method: dual-agent (A: design review, Sonnet 5 · B: detector evidence, Sonnet 5)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Chips and gate text show state |
| 2 | Match system / real world | 2 | Raw playbook command beside plain stage names |
| 3 | User control and freedom | 3 | Skip cancels; delete has no undo |
| 4 | Consistency and standards | 3 | Reuses app patterns |
| 5 | Error prevention | 2 | Delete is one click, no undo |
| 6 | Recognition vs recall | 2 | Id must be carried to the orchestrator by hand |
| 7 | Flexibility and efficiency | 1 | No copy or run-in-orchestrator action |
| 8 | Aesthetic and minimalist | 2 | Busy card: up to 9 unlabeled regions |
| 9 | Error recovery | 2 | Host errors surface as a notice, not at the card |
| 10 | Help and documentation | 2 | "Orchestrator" unexplained on the card |
| Total | | 22/40 | Acceptable |

Priority issues:
- [P1] Every card prints `console-connect playbook <stage> <id>` to everyone. Replace with a "Copy command" / "Open in orchestrator" action and plain words.
- [P2] Warning color means both "blocked" (.idea-gate) and "suggestion" (.idea-resize). Make the resize nudge neutral.
- [P2] Card stacks files, tasks, skips as unlabeled lists; no collapsed state for many ideas.
- [P2] Delete-idea has no undo.
- [P3] Skipped chip carries the reason only in title; the visible .idea-skips list covers it, but aria-describedby would tie them. Sample badge borrows .office-pill.
Detector: 0 findings in src/renderer.ts. CRAFT manual check 9/10; card text at 12-13px, app-wide convention.

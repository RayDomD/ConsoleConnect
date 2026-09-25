---
target: Console Connect workspace after Phase 1
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
timestamp: 2026-09-25T00-05-01Z
slug: src-renderer-ts
---
Method: dual-agent (A: design review, Sonnet 5 · B: detector, Sonnet 5). Detector ran in degraded regex mode (HTML parser modules unavailable); browser overlay skipped (Electron renderer, no localhost page).

## Design Health Score
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Task pill "Running" beside session "Ended" with no copy tying the two lifecycles together |
| 2 | Match system / real world | 3 | Clear task/package/decision vocabulary; "Prepare Markdown" + commit SHA flow is jargon-heavy |
| 3 | User control and freedom | 3 | Unsend, Stop confirm, Escape on menu/palette, focus toggles |
| 4 | Consistency and standards | 2 | Sidebar status Title Case (text-transform:capitalize) vs sentence-case pill; roles "Owner" vs "owner"; pre-existing side stripe on .decision-alert |
| 5 | Error prevention | 3 | Stop and Unsend confirm; commit SHA has no format hint |
| 6 | Recognition rather than recall | 2 | J/K, 1-4, C only discoverable in the Ctrl+K footer |
| 7 | Flexibility and efficiency | 3 | Palette, J/K, R, F, Ctrl+` serve all-day use |
| 8 | Aesthetic and minimalist | 3 | Restrained; overview right rail stacks five concerns |
| 9 | Error recovery | 2 | Error states not exercised in screenshots; notices are generic |
| 10 | Help and documentation | 2 | Help popovers on Projects only; nothing in the console workspace |
| Total | | 25/40 | Acceptable-to-good |

## Design specificity
Authored, not interchangeable: serif task titles, shape-coded status dots, sliding selection card, the console well with session strip and needs-input bar. Detector: 33 findings (22 CSS + 11 palettes.ts false positives); new this phase are off-ramp sizes (11px badges/avatars, 14px/10px palette, 26px project and console titles, kbd 5px radius) and JetBrains Mono, which DESIGN.md still lists as Consolas (DESIGN.md is stale; the console-workspace ADR chose JetBrains Mono).

## Priority issues
- [P1] Status casing: `.task-link small{text-transform:capitalize}` and `.sidebar-bottom small` render Title Case next to the sentence-case pill. Fix: drop capitalize, sentence-case in markup. /impeccable polish
- [P2] Task vs session status reads as a contradiction on the console tab ("Running" pill, "Ended" strip and rail). Fix: label the strip/rail as the session ("Session ended") or subordinate one. /impeccable clarify
- [P2] Shortcut discoverability: J/K/1-4/C appear only in the palette footer. Fix: kbd hints in tab and row titles, or a "?" shortcut sheet. /impeccable onboard
- [P2] Stop is visually equal to Share view only despite ending the tool. Fix: separate it (divider or danger text colour on hover) while keeping the confirm. /impeccable clarify
- [P3] Pre-existing side stripe on `.decision-alert` (decisions.css:2) and dead hex shadows in discussion.css:7. Fix: tint instead of stripe; delete overridden shadows. /impeccable polish

## Persona red flags
- Power user: shortcuts undiscoverable outside Ctrl+K; Stop sits among quiet toggles.
- Keyboard/screen-reader user: menus and palette are well built (roles, aria-selected, Escape); muted palette hint on the selected row is 4.3:1.
- First-time teammate: "Running" vs "Ended" on the same screen reads as a bug.

## Minor
- Right rail on the overview stacks host status, team, invite, decisions, and a note.
- Soft-click setting has no description.
- DESIGN.md still says 76px top bar and Consolas mono.

## Questions
- Should session state and task state share one status line in the console?
- Is a "?" shortcut sheet worth one more key?

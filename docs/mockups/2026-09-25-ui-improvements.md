# UI improvements backlog

Found in the review after the tactile pass (`docs/plans/2026-09-25-tactile-ui.md`). Each problem has a current vs proposed view in `2026-09-25-ui-improvements.html`. Status: approved by the user on 2026-09-25 as shown in the HTML. Not built yet. P7 still needs its data source settled for hosted projects.

| ID | Problem | Proposed fix | Needs a design decision |
| --- | --- | --- | --- |
| P1 | Uppercase eyebrow labels on nearly every section; "TASK / running" repeats sidebar status | Status dot and label beside the title; sentence-case section headings; keep only the wordmark uppercase | No |
| P2 | Top bar spends 76px on "REVIEW DESK" and two large links | 48px bar with workspace / task breadcrumb, Chat with unread count, Projects | Yes |
| P3 | Right rail is a cramped form: raw host IP, commit SHA field, three equal outline buttons | Host status line with copy; one primary next step per decision; commit field only after Prepare; Propose as header action | Yes |
| P4 | "+ New task" full-width green button and boxed "Team chat" outweigh the desk's action | + icon on the Tasks heading (N shortcut); Team chat as a nav row with unread count | No |
| P5 | Action panel has dead space above buttons; "Assigned to No one" | Remove leftover margin; "Unassigned" pill; one heading; merge Assign select and button into a menu button | No |
| P6 | Chat repeats own avatar, shows actions under every message, no grouping | Group consecutive messages within 5 minutes; drop own avatar and "You"; actions on hover or focus | No |
| P7 | Project rows don't show whether anything needs you | Running, awaiting review, and unread counts; host type in meta line; folder prompt as inline link | Yes (data source for hosted projects) |
| P8 | No keyboard navigation on an all-day operate surface | Ctrl+K palette; J/K tasks, 1–4 tabs, N new task, C chat; inactive in text fields and terminal | No |
| P9 | Page-level vertical scrollbar on every screen | Trace the overflowing element; lock the shell to window height so only inner regions scroll | No (cause not yet traced) |

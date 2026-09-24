# Console workspace: docked, session rail, focus mode

Status: accepted

Refines [Console in a dedicated task tab](2026-09-23-console-tab.md), which still holds. The console stays in the task's Console tab and now behaves as one workspace with three states:

- **Docked (default).** The console fills the desk to the window edge as one framed well. A session strip shows the tool, branch, elapsed time, and state, with Share view only, Stop, Session, and Focus actions. A needs-input bar appears when the tool pauses for its owner, following the spec's pause-and-notify rule.
- **Session rail (R).** A right rail shows session status, the assignment note, changed files from the task worktree, and Draft work package. Open by default on wide windows, closed below 1280px, remembered per computer. "Last check" (test results) waits for per-tool result parsing.
- **Focus mode (F).** The sidebar collapses to status dots and the title block folds into the top bar; the well goes edge to edge. The rail still toggles.

Single-key shortcuts are inactive while the terminal or a text field has focus. Ctrl+` focuses the terminal. Layout switches are instant because they are keyboard driven. The terminal uses self-hosted JetBrains Mono, loaded before xterm measures glyphs.

The selected design is [the console workspace mockup](../mockups/2026-09-25-console-workspace.html).

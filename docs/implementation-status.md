# Implementation status

Updated: 2026-09-23

## Verified

- Electron and TypeScript selected by the user, with Windows first and cross-platform structure intended.
- The user confirmed the three verification boundaries in specification.md.
- The first coordination test was observed failing before implementation: `Computer hosting is not implemented`.
- A file-backed HTTP host now supports single-use invitations, authenticated task creation, recipient approval, and start authorization. Only the assigned member can approve or mark work started. Atomic snapshots preserve members, credentials, and task state across a host restart. A process lock prevents opening the same workspace twice.
- The restart test was observed failing with HTTP 401 before storage was implemented.
- `npm test -- tests/coordination.test.ts`: 2 tests passed.
- `npm run typecheck`: passed with no diagnostics.
- The host now supports package drafts, submission, independent acceptance or change requests, task messages, persistent command retry IDs, and an authenticated SSE revision stream.
- `npm test`: 22 tests passed across coordination, hosted commands, decision files, disposable Git worktree creation, VPN address selection, and local outgoing queue behavior.
- `npm run build`: passed. `npm run smoke` launched Electron, hosted a workspace, and created a task through the desktop window. `npm run shoot` captured that Review Desk window for visual inspection.
- The desktop shell provides host/join, task creation, approval, packages, discussion, invitations, and the three themes. It listens for workspace updates and checks periodically after a dropped connection.
- A disposable Git repository test verifies creation and reuse of a task-specific worktree. A short Codex CLI session ran through `node-pty` from a disposable repository and returned `OK` (the CLI reported 8,080 tokens used). The Electron smoke check launched all three installed providers with controlled version requests; Claude Code and Antigravity have not completed paid prompts.
- Outgoing task commands are saved locally on network failure and retried with the same operation ID. Conflicts stay queued for the user to inspect or discard. Tests cover a host restart and a conflicting claim; reconnect behavior has not yet been tested across two devices.
- The host now verifies linked pull-request state through its own GitHub CLI login. The app can check and poll status; an accepted task completes only after a verified merge. A controlled test covers open-to-merged reconciliation. A read-only `gh pr view` call against a public PR confirmed the expected JSON fields.
- Members can propose decisions. The host owner can prepare a Markdown file in a matching local repository; after a user commits and pushes it, the host compares the exact GitHub file at that commit before marking the decision official. Superseding a decision flags affected tasks for owner acknowledgement before submission. The desktop smoke check prepared a decision file through Electron. No push was made by the app.
- The owner can opt in to a live, view-only terminal stream for a running task and turn it off at any time. The host allows only the assignee to publish output; viewers have no input route. Output stays in memory and is not part of the durable workspace state. A server permission test and an Electron smoke check with a joined reviewer and controlled output passed. This has not yet been tested across two computers or with a real provider session.
- A Windows x64 installer and an unpacked build now package successfully using node-pty's supplied native module. The unpacked app passed the same desktop smoke check, and the packaged Electron runtime loaded the native terminal module. The installer has not been installed on a second computer.
- The desktop now subscribes to the host's live revision stream and refreshes immediately after a teammate's update, with a periodic check for dropped connections. The desktop smoke check verified that a joined reviewer saw a new task within three seconds, before the periodic check. Before creating a task worktree, local execution now verifies the selected Git folder's origin matches the workspace repository; a disposable-repository test covers a mismatch.
- Workspace-wide chat now lives alongside task discussion. A desktop smoke check posted a message through the joined reviewer and confirmed it reached the host. Hosting now binds to a recognized private VPN interface when one is available; otherwise it binds to loopback and disables invitations in the desktop UI. A test rejects public and ordinary LAN addresses for automatic VPN selection.
- Dependencies installed successfully. npm reported 0 vulnerabilities at installation time.
- The hosted Supabase schema passed a disposable PostgreSQL permission check and was applied to the live project. Its local and remote migration history match. Anonymous sign-in and a member-denied Edge Function request passed against the deployed project. Hosted commands reuse the coordination rules; live workspace creation, GitHub verification, Realtime delivery, and cross-computer behavior still need testing.

## Not implemented yet

Real Claude Code and Antigravity prompts, PR creation and approval through GitHub, decision file publication by a user, hosted GitHub token configuration, hosted terminal sharing, and two-computer acceptance remain outstanding. Storage needs broader crash-recovery and concurrency testing before production use.

## Current design checkpoint

The user selected the Paper & ink Review Desk layout and asked to make its three color alternatives selectable themes. The desktop shell now applies Forest & linen, Blue & porcelain, and Ochre & parchment with a local picker. Terminal palettes are prepared for the future embedded terminal.

## Local provider evidence

All three installed provider executables returned their versions through `node-pty` and the Electron terminal smoke check. One short Codex CLI session completed through `node-pty` after user approval. Claude Code and Antigravity still need a real prompt check.

## Skill workflow adaptation

This is a new project with no Git baseline or code commits. The implementation skill's commit-diff review is deferred until there is a complete implementation to review. Git writes were confined to disposable test repositories; no project commit, push, or external publishing was performed.

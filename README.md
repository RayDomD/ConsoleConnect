# Console Connect

A standalone Windows app for people building software together with their own AI tools and subscriptions.

Each person works locally. A shared workspace carries assignments, discussion, approved decisions, and reviewable work packages. Incoming assignments require the recipient's approval before execution.

## Project status

The computer-hosted coordination API supports invitations, assignments, approval, task discussion, work-package review, persistent state, and live revision events. The Electron app provides host/join, task and review screens, an embedded local terminal, and three themes. Approved recipients can launch Codex CLI, Claude Code, or Antigravity in a task-specific Git worktree after the repository is checked against the workspace. View-only terminal sharing is available in computer-hosted workspaces. The host checks linked pull-request status and verifies a published Markdown decision file before marking a decision official. One short Codex CLI session has been verified; controlled Electron launches of all three installed providers pass. Offline updates survive a host restart and retry on reconnection. Supabase hosting is deployed and has passed a live sign-in and access check, while GitHub integration and cross-computer validation remain. See [implementation status](docs/implementation-status.md) for evidence and remaining work.

Run `npm run dev` to build and open the desktop shell. The host listens on port 24680. When a recognized private VPN interface is available, teammates use its address and a single-use invitation code. Otherwise, hosting stays on this computer and the app asks you to connect a VPN before inviting teammates.

Run `npm run package:win` to build the Windows installer in `release/`. This build uses the native Windows module bundled with node-pty. The installer is an early test build; the two-computer acceptance check has not been completed.

See [the product specification](docs/specification.md) for agreed behavior, delivery order, acceptance criteria, and remaining technical validation.

## First working slice

Two clients connect to a computer-hosted workspace, exchange a coding assignment, approve it, and submit a work package for another member to accept. The coordination boundary is validated before adding terminal execution and Git integration.

## Intended first-version integrations

Claude Code, Codex CLI, and Google Antigravity CLI. Users authenticate locally with their own accounts. Provider support and subscription eligibility must be verified per tool. Console Connect does not share credentials or pool accounts.

## Hosting

Both hosted Supabase and a bundled computer-hosted server are in first-version scope. Computer hosting does not require Docker. Remote teammates connect through a private VPN. Local work continues while disconnected, with shared updates synchronized on reconnection.

## Open source

The project is intended for a public GitHub release. No license has been selected yet. Publishing and hosting for other teams are separate from developing this local project.

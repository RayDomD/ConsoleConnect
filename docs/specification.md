# Console Connect specification

Date: 2026-09-22
Status: User approved specification and implementation. This document captures the interview. Technical recommendations not explicitly settled are identified below.

## Product

Console Connect is a standalone Windows application for people collaborating on software using their own AI tools and subscriptions. Building software is the primary use case. Planning and discussion support execution.

It is a collaborative environment rather than a one-way delegation console. People exchange assignments, ask questions, share decisions, carry out work, and return results for review. An orchestrator is a role a person can take, not the only person allowed to initiate work.

The application is separate from Cockpit and lives at C:\Files\ConsoleConnect. It is intended to become open source on GitHub.

## Agreed first-version scope

### Workspace and membership

Each workspace is associated with a Git repository. Members use separate local project copies. Workspace permissions govern assignments, official decisions, work-package acceptance, and administration. Authorized teammates can review work, without requiring a single permanent lead to review everything.

The sender cannot approve their own work by default. Exact roles and invitation mechanics remain implementation design decisions to document.

### Tasks and approvals

Members can create tasks and claim unassigned tasks. Who can assign tasks to other members is a workspace rule set by the Owner: anyone, Owners and Reviewers (Contributors claim or suggest an assignee), or the Owner only. The default is anyone. The host enforces the rule for the app and the command line alike. Incoming assignments require explicit approval by the recipient before local AI execution starts. Recipients may decline an assignment. (Amended 2026-09-25, see [the orchestrator ADR](adr/2026-09-25-orchestrator.md).)

Assignments go to people. A sender can suggest an AI tool, but the recipient chooses the tool they use.

Each coding task gets its own branch and worktree. Planning or discussion alone does not require a worktree.

If a tool needs input, encounters an error, or exhausts its available usage, the session pauses and notifies its owner. Switching to another tool requires owner approval and uses a prepared handoff of progress and outstanding work.

### Orchestration

Added 2026-09-25. Any member can orchestrate: plan, hand out, and follow work, by hand or with their own AI tool. The tool acts as that person and is recorded as such ("via Codex"). AI tools are never workspace members. A `console-connect` command, available to any tool through the person's running app, is the tool-neutral interface. Accepting work, requesting changes, and approving decisions always require a person's click. Updates between orchestrator and workers are typed into the receiving console without being sent, unless that person turns on automatic handling. Details are in [the orchestrator ADR](adr/2026-09-25-orchestrator.md). A guided path from idea to shipped work is recorded as a direction in [the guided path ADR](adr/2026-09-25-guided-path.md).

### Local AI execution

Terminal panels are built into the app. First-version supported integrations are Claude Code, Codex CLI, and Google Antigravity CLI.

Each person authenticates to supported tools locally using their own account. Credentials are not transferred to other teammates or the coordination server. Integration with separately running desktop app sessions is deferred.

Launching a tool, recognizing its result, and preserving its own permission prompts require tool-specific integration. A generic terminal panel alone does not guarantee reliable automated handoffs.

### Work packages

A completed AI session prepares a draft work package. The owner reviews and edits that draft before explicitly submitting it.

A work package contains a summary, deliverables or references to actual changes, verification results, and unresolved questions. Coding packages reference a branch or commit and a linked pull request where available.

Recipients can ask questions, request changes, or accept the package. Work-package acceptance is separate from GitHub pull-request approval. An accepted coding package waits for its changes to merge before the task completes.

### Conversation and decisions

Workspaces have shared chat, and tasks have their own discussion threads. Connected members receive updates in real time.

Decisions start as proposals. Authorized approval makes a decision official. Ordinary chat messages are not automatically official instructions.

When an approved decision changes, affected task owners are notified and must acknowledge the update before submitting their work. The owner decides whether and how to stop or adjust their local AI session.

Shared plans and official decisions are actual Markdown files under the repository's docs/ folder. Git owns their version history. Supabase or the bundled server owns collaboration records and references to repository documents.

The exact transaction between decision approval and committing its Markdown record must be designed explicitly so the two cannot silently diverge.

### Visibility and live updates

Final responses and deliverables are shared when their owner submits them. Sharing a live terminal session is optional and controlled by the session owner.

Other members may watch and comment on a shared session. They cannot type into or control it. Comments belong to task discussion.

Persistent client connections carry live workspace events. GitHub webhooks are a separate inbound integration, not the transport for chat.

### GitHub

Linked pull-request status updates are in first-version scope, including opening, review, and merge status.

Users open GitHub for pull-request approval and merging. Console Connect does not treat work-package acceptance as a GitHub approval or bypass repository permissions and branch rules.

Private-network computer hosts may not be reachable by GitHub webhooks. A polling fallback or explicitly configured relay is required. Do not promise inbound webhook delivery to an unreachable host.

### Hosting and offline work

The first version includes both hosted Supabase and a bundled lightweight computer-hosted server.

Computer hosting starts from a Host workspace action. It does not require Docker or running the full Supabase stack. Remote connections use a private VPN. The host must be online for shared coordination to be available.

People can work locally while disconnected. Outgoing updates are durably queued and synchronize when connectivity returns. Incoming assignments do not execute while the recipient is offline and still require approval after delivery.

Synchronization must prevent duplicate mutations on retries and surface conflicts. Reconnection must not silently overwrite newer assignments or approvals. Notifications and live updates should reconcile against durable state.

Teams can configure their own backend rather than relying on one developer-funded deployment. Keep service calls centralized and collaboration rules independent of the hosting adapter. Do not implement hypothetical additional backends.

### Open-source distribution

Publishable setup must include database migrations, permission policies, and setup instructions, without secrets. An open-source license is still to be selected.

A free hosted tier is a prototype constraint, not a promise of unlimited free operation. Keep code and docs in Git. Limit and batch optional live streams. Hosting costs, AI subscription charges, and Git hosting are separate concerns.

### Appearance

The user selected the light Paper & ink Review Desk layout and editorial typography. Forest & linen, Blue & porcelain, and Ochre & parchment are selectable themes rather than mutually exclusive design directions. The palette changes across app controls and the terminal without changing layout. Each person's selection is saved locally and does not change teammates' appearance. Forest & linen is the initial implementation default, following the earlier recommendation. All three themes remain available.

## First end-to-end demo acceptance target

The user confirmed this target:

1. Two people on separate Windows computers join one workspace.
2. They discuss a coding task and one assigns it to the other.
3. The recipient approves it and selects a supported AI tool.
4. Work executes in a task-specific branch and worktree.
5. The owner reviews and submits a work package.
6. Another authorized person reviews and accepts it or requests changes.
7. The linked GitHub pull request is approved and merged through GitHub.
8. Console Connect reflects the pull request's status and completes the accepted coding task after merge.

The demo should exercise different AI tools across participants. Hosting parity, offline recovery, and the third tool must be validated before calling the whole first version complete.

## Delivery order

These are incremental implementation milestones, not reductions in agreed first-version scope.

1. Computer-hosted coordination: persistent membership, tasks, recipient approval, draft/submitted packages, independent acceptance, and live updates through the public client interface.
2. Windows desktop shell: connect/host flow, task UI, discussion, terminal panels, local provider authentication, and the first real task execution.
3. Git workflow: per-task worktrees, reviewable changes, GitHub links and status reconciliation, and explicit separation of acceptance from merging.
4. Remaining provider adapters, decision workflow, optional view-only streaming, and durable offline synchronization.
5. Supabase adapter and equivalent permission/behavior checks, followed by installable Windows packaging and the two-computer acceptance exercise.

No simulated provider execution or local two-client test should be presented as evidence of successful real AI execution or a two-computer demo.

## Confirmed verification boundaries

The user confirmed these boundaries before tests were written under the TDD skill.

- Public coordination API and live event connection: two independent clients assign, approve, submit, and review work. Unauthorized execution and self-acceptance are rejected. State survives restart and reconnect does not duplicate operations.
- Local execution and Git boundary: approved tasks create isolated worktrees and run supported tools only on their owner's device. Test with disposable repositories and controlled processes before real provider smoke tests.
- User-visible desktop workflow: inspect the running Windows app, then exercise the real two-device flow when a second device and provider accounts are available.

## Unsettled details and evidence needed

- Exact member roles, invitations, and permission changes.
- Whether assignments must pin a specific document revision. This was recommended but not explicitly accepted in the interview.
- Completion rules for tasks with no repository changes. Planning-only tasks were discussed but the user redirected to confirm coding is central.
- Provider installation, supported Windows versions, authentication, result extraction, interruption, and subscription eligibility must be verified against official documentation and actual installed tools.
- Private VPN product, setup steps, and available second-device test environment.
- Consistency between approved decisions and committed Markdown records.
- Concrete offline conflict rules and treatment of revoked permissions on queued actions.
- License selection and public release setup.

## Verification status

See implementation-status.md for current test evidence, implemented behavior, and remaining work.

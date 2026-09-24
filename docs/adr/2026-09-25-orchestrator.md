# Orchestrator and workers

Status: accepted

Console Connect stays a collaborative environment, not a one-way delegation console. Orchestrating is something any member does, by hand or with their own AI tool. The goal is a seamless loop between the person orchestrating and the people doing the work, with any supported tool. The decision summary is [the orchestrator decisions mockup](../mockups/2026-09-25-orchestrator-decisions.html).

## Identity and interface

- **Q1. The tool acts as the person.** Work created or assigned by an orchestrating tool is recorded under the person, with a "via Codex" (or other tool) marker. AI tools are never workspace members.
- **Q2. A command-line tool is the contract.** `console-connect` works in Codex, Antigravity, Claude Code, and later tools. It prints JSON for tools and text for people. An MCP server may later wrap the same commands.
- **Q3. The command goes through the running app.** The CLI reaches the person's open Console Connect app over a local named pipe. The app performs the command with its existing session for either hosting mode. No separate credential is stored. If the app is closed, the CLI fails with a clear message.
- **Q4. Approvals stay with people.** The CLI may create, assign, post, and read tasks, messages, and packages. Accepting a package, requesting changes, approving a decision, and approving one's own incoming task require a click in the app. The CLI can propose a review that the app shows for confirmation.
- **Q11. Anyone can orchestrate. The team decides who can assign.** The Owner sets one workspace rule: anyone assigns (default), Owners and Reviewers assign while Contributors claim or suggest an assignee, or only the Owner assigns. The host enforces it for the app and the CLI. Acceptance keeps its existing role rule. This amends the specification. See [the assigning rule mockup](../mockups/2026-09-25-assigning-rule.html).

## Consoles

- **Q5. A built-in orchestrator console.** A workspace-level Orchestrator entry sits above Team chat. It runs the chosen tool in the main project folder without a worktree, with `console-connect` on its path. Outside terminals also work while the app is open. See [the orchestrator console mockup](../mockups/2026-09-25-orchestrator-console.html).
- **Q6. The brief is typed in, not sent.** When a worker launches a task console, the app types the task brief into the tool's input without pressing Enter. The worker reads it, edits it, and starts it. This needs a per-tool readiness signal. See [the round trip mockup](../mockups/2026-09-25-orchestrator-round-trip.html).

## Returning work

- **Q7. The package fills itself.** Every brief ends with an instruction to run `console-connect package draft` with a summary, checks, and open questions. The app adds changed files, commit, and pull request from Git. The worker sees one read-only card with Submit. Summary and question can be edited inline. Git facts cannot. If the tool skips drafting, Draft work package fills the Git facts. See [the package mockup](../mockups/2026-09-25-package-autofill.html).
- **Decline and "Assigned by me."** Recipients can decline an assignment, which needs a new command. Senders get an "Assigned by me" rail grouped by state. Tasks currently record `authorId` but not who assigned them, so an assigner field is needed.

## Updates between consoles

- **Q8. Orchestrator side.** Submissions, questions, and stalls are typed into the orchestrator console without being sent. Several updates combine into one line. Automatic handling is opt-in. See [the events mockup](../mockups/2026-09-25-orchestrator-events.html).
- **Q9. The automatic setting.** Settings › Orchestrator has a master switch, Ask me or Auto for questions, stalls, and submissions, and a daily limit on automatic runs. Follow-up assignments from an automatic run are always typed in for the person to send. The orchestrator strip shows an Auto badge, the count, Pause, and a log. Automatic handling stops when the app closes or the limit is reached. See [the setting mockup](../mockups/2026-09-25-orchestrator-auto-setting.html).
- **Q10. Worker side mirrors it.** Answers and comments are typed into the worker's console, and the worker may set them to automatic. Change requests always wait for the worker. Decision changes require acknowledgement in the app first, as the specification requires. Workers ask with `console-connect ask`. See [the worker events mockup](../mockups/2026-09-25-worker-events.html).

## Knowledge

- **Q12. One brief for every tool.** Consoles open with a typed-in opener that tells the tool to run `console-connect brief`. The brief reads live workspace state: team, roles, assigning rule, open tasks, automatic settings, and which actions need a click. Workers use `brief --task`. No per-tool instruction files are written. See [the brief mockup](../mockups/2026-09-25-orchestrator-brief.html).
- **Q13. A project map in the repository.** `docs/README.md` states what each document is and when to read it, including brand files such as `PRODUCT.md` and `DESIGN.md`. The app drafts it, and the team edits and commits it. The brief reads it from main for the orchestrator and from the branch for workers. Entries can be tagged protected. A package touching a protected document shows a warning to the reviewer. The brief flags decision files that differ from the approved text and protected documents changed on main outside a package. GitHub branch protection and CODEOWNERS remain the enforcement for merges. See [the project map mockup](../mockups/2026-09-25-project-map.html) and [the protected changes mockup](../mockups/2026-09-25-protected-doc-changes.html).

## Consequences

The CLI, the local pipe, event delivery into consoles, the readiness signal, the automatic setting, decline, the assigner field, the assigning rule on both hosts, the brief, and the project map are new work. The spec's "Orchestration" section and amended assignment rule point here. The guided path from idea to shipped work is recorded separately in [the guided path ADR](2026-09-25-guided-path.md).

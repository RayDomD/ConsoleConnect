# orchestrator

The app side of `console-connect` (orchestrator ADR). It turns the words a person or their AI tool typed into workspace commands, run as that person through the app's existing session, and returns text for people plus data for tools.

## Public interface (`index.ts`)

- `runCliCommand(argv, context, api)`: runs one command. `context.taskId` is the task whose worktree the command ran in, if any.
- `WorkspaceApi`: what the app lends it, the current snapshot and `send(taskId, fields)`.
- `CliError`: a refusal whose message is shown to the caller as is.

## Not handled here

The pipe and the command-line client (`src/cli`), the host's permission checks (`src/coordination`, which stays the authority), and any UI.

## Dependencies

`src/coordination` types only.

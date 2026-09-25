# orchestrator

The app side of `console-connect` (orchestrator ADR). It turns the words a person or their AI tool typed into workspace commands, run as that person through the app's existing session, and returns text for people plus data for tools.

## Public interface (`index.ts`)

- `runCliCommand(argv, context, api)`: runs one command. `context.taskId` is the task whose worktree the command ran in, if any.
- `WorkspaceApi`: what the app lends it, the current snapshot and `send(taskId, fields)`.
- `CliError`: a refusal whose message is shown to the caller as is.
- Playbooks (guided path ADR Q22): `playbookText(stage, override, idea?)` gives a stage's instructions, the repo's `docs/playbooks/<stage>.md` (`playbookPath`) when the app passes one in, otherwise the built-in text. `playbookStage` accepts stage names and the ADR's earlier names; `stageNames`, `sizeNames`, and `stageDocument` give the UI names and each stage's file.
- Recommendations (ADR Q16, Q23): `recommendNext(idea)` is the next stage on the size path with its fixed reason; `suggestSize(idea, talkDocument?)` proposes another size when the task count or a "Sessions" heading disagrees. `detectEvents` reports an idea reaching a new stage as `idea-stage`.

## Not handled here

The pipe and the command-line client (`src/cli`), the host's permission checks (`src/coordination`, which stays the authority), and any UI.

## Dependencies

`src/coordination` types, plus the idea paths from its browser-safe protocol module.

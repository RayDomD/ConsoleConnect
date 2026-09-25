# cli

The `console-connect` command-line client (orchestrator ADR Q2, Q3). It forwards the words it was given to the person's running Console Connect app over a local per-user pipe and prints the reply: text for people, `--json` for tools.

## Public interface (`index.ts`)

- `pipePath(env?, platform?)`: the per-user pipe or socket path. `CONSOLE_CONNECT_PIPE` overrides it for tests.
- `sendCliRequest(path, request, timeoutMs?)`: one request, one reply; resolves `null` when no app is listening.
- `CliRequest`, `CliReply`, `cliProtocolVersion`: the wire contract.

`_internal/main.ts` is the bundled entry (`dist/cli.cjs`). The app writes `console-connect` shims into `<userData>/bin` that run it with Electron's Node runtime.

## Not handled here

Parsing and running the commands happens in the app (`src/orchestrator`), which holds the session. This module stores no credentials and knows nothing about workspaces.

## Dependencies

Node's `net`, `os`, and `path` only.

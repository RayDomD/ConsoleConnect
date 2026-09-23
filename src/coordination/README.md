# Coordination

Owns durable workspace state, membership, task approvals, review packages, discussion, and live updates.

Public interface: `startHost` and shared protocol types exported from `index.ts`. Clients use authenticated HTTP commands, snapshots, and an SSE revision stream at `/events`. Commands with the same ID and payload are safe to retry. No endpoint executes local commands.

Does not own terminal processes, local Git checkouts, or provider credentials. Dependencies: Node built-ins and Zod. Local storage belongs to the configured data directory, outside the repository.

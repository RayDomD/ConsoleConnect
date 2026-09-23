# Hosted workspace setup

Console Connect can use a team-owned Supabase project instead of a computer host. The desktop needs only the project URL and its publishable key. Keep the service or secret key and GitHub token on the Supabase function, never in the desktop app or this repository.

1. Create a Supabase project and enable anonymous sign-ins under Authentication. Each teammate signs in anonymously on their own computer. Preserve the app's local data: clearing it loses that anonymous identity and requires a new invitation.
2. Apply `migrations/20260923120000_console_connect.sql` with the Supabase CLI migration workflow. It creates the workspace tables, member-only revision feed, server-only write functions, and their row-level security rules.
3. Configure `GITHUB_TOKEN` as an Edge Function secret with access to the workspace's repositories. The function reads a proposed decision file at its exact commit and checks pull-request review and merge status through GitHub. The Supabase URL and server-side secret key are supplied by the Edge Function environment.
4. Run `npm run build:hosted`, then deploy the `console-connect` Edge Function. Leave JWT verification enabled. The desktop's “Host with Supabase” and “Join with Supabase” forms use the project URL and publishable key.

`npm run check:hosted-schema` applies the migration to a disposable local PostgreSQL database and checks invitation consumption, revision compare-and-swap, and member visibility. The domain tests check assignment approval, retry IDs, private drafts, review separation, and merge completion. On 2026-09-23, the migration and Edge Function were deployed to the Console Connect Supabase project; anonymous sign-in and a rejected nonmember request passed live. Realtime delivery, GitHub verification, and a two-computer run still need validation. Hosted terminal sharing is not enabled yet; local tool execution remains on each member's computer.

References: [Supabase migrations](https://supabase.com/docs/guides/local-development/database-migrations), [anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous), [Edge Function authentication](https://supabase.com/docs/guides/functions/auth), [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization).

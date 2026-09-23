# Console Connect hosted function

Serves the authenticated hosted workspace API. `index.ts` is the entry point; `_internal/handler.ts` connects Supabase Auth, Postgres, and GitHub to the shared coordination rules bundled as `_internal/core.js` by `npm run build:hosted`.

The public interface is HTTP through Supabase Edge Functions. Clients need a project URL and publishable key. The function requires server-side `SUPABASE_SERVICE_ROLE_KEY` and `GITHUB_TOKEN`; neither key belongs in the desktop app. It does not run local AI tools or store their credentials.

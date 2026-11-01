# ReadLite Android Library and Reader Implementation Plan

> **Goal:** Complete the authenticated Android reading loop: sign in and return to Explore, navigate back from detail/reader screens, favorite stories into a server-backed bookshelf, and keep theme and chapter reading progress synchronized.

**Architecture:** PostgreSQL remains the source of truth. Extend the existing Express API over the existing `favorites`, `reading_progress`, and `user_settings` tables. Android uses the existing Java/XML project and a shared CookieManager initialized at application startup; mutating API calls attach the CSRF cookie in the request header.

**Scope:** Authentication return flow; visible back navigation; four-item Explore/Rankings/Bookshelf/Account navigation; server-backed favorites and bookshelf; application-wide light/dark theme; reader A−/A+, progress, resume position, and chapter table of contents.

**Constraints:** Keep the current Postgres schema unless inspection proves a migration is necessary. Preserve existing user edits. Do not copy the legacy SQLite database into the API client. Do not expose passwords, access cookies, refresh tokens, or CSRF values in logs.

## Tasks

1. **API library and progress routes** — reuse access-cookie and CSRF validation, add authenticated bookshelf/favorite/progress handlers, validate story/chapter IDs and permille values, return stable JSON contracts. Add focused API integration coverage against a dedicated `readlite_test` database only.
2. **Android session and API client** — install one CookieManager before any Activity sends requests; add GET/PUT/DELETE operations and CSRF headers; handle unauthorized states without crashing.
3. **Navigation, account, and bookshelf** — finish the auth Activity on successful login; add visible back controls on auth/detail/reader sub-screens; expose Explore, Rankings, Bookshelf, Account; load favorites from the server and allow heart toggles; add logout and a persistent global theme control.
4. **Chapter reader** — add A−/A+ controls, a chapter TOC, a visible progress indicator, and save/restore chapter plus permille progress through the API; retain local font-size preference.
5. **Verification and handoff** — run API typecheck/lint and focused/full API tests only with a guarded test database; run Android unit tests, assemble debug, and inspect Git diff without staging or committing the user's existing changes.

## Review Focus

- Missing, expired, or unverified sessions must show a safe signed-out state and never crash.
- Every favorite or progress mutation must require both a valid access cookie and matching CSRF cookie/header.
- Invalid story/chapter IDs and progress outside 0–1000 must return a stable client error without partial writes.
- Reader restoration must clamp progress safely when chapter text or viewport dimensions change.
- Theme changes must survive Activity recreation and apply to all Android screens, including system bars.

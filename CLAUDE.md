# Momentra

Persistent project context for all Claude Code sessions. Read this before making any changes.

---

## What This Application Is

**Carbon Consulting — Offer Ecosystem Diagnostic** is Momentra, a diagnostic chatbot for Carbon Consulting, a business consulting firm that serves info product coaches.

The product is a free, AI-powered diagnostic tool that:
1. Conducts a structured ~5-minute interview with a coaching business owner
2. Assesses their business across five systems: Traffic, Conversion, Fulfillment, Positioning, and Operations
3. Delivers a personalized "Dynamic Model" at the end
4. Logs the full conversation to Supabase so the Carbon Consulting team can review leads and send personalized follow-up outreach (Loom pitches, Miro boards, sales calls)

**Target prospect:** Info product coaches earning $10K–$100K/month who want to scale. Below $10K and above $100K are handled as edge cases by the AI.

**Business purpose:** Lead generation. The dynamic model is deliberately strategic (not tactical) — it shows the prospect *what* needs to change and *why*, but not *how*, which creates the opening for Carbon Consulting to offer done-for-you implementation services.

---

## File Map

| File | Role |
|------|------|
| `index.html` | Complete frontend application — single self-contained file with all HTML, CSS, and JavaScript. No build step, no framework. |
| `server.js` | Node.js/Express backend. Proxies requests to Claude API, manages sessions in memory, logs completed sessions to Supabase. Lives in project root. |
| `system-prompt.md` | The full AI system prompt (v1.0) — Claude's behavioral instructions, conversation flow, diagnostic logic, and dynamic model generation rules. **Currently a Markdown file but needs to become a JS module** (see Known Issues). |
| `supabase-schema.sql` | Complete database schema. Run once in Supabase SQL Editor to create all tables, indexes, RLS policies, and views. |
| `package.json` | Node.js dependencies. **Known issue: `"main"` points to `src/server.js` which is wrong — actual file is `server.js` in root.** |
| `env.example` | Template for environment variables. Copy to `.env` for local dev; set in Railway Variables tab for production. |
| `API-DOCUMENTATION.md` | Reference for the backend REST API — endpoints, request/response shapes, error codes, frontend integration example. |
| `gitignore` | Git ignore rules. **Known issue: file is named `gitignore` not `.gitignore`.** |

---

## Tech Stack

### Frontend (`index.html`)
- **Vanilla HTML/CSS/JavaScript** — no framework, no build tool, no dependencies
- Single file; served as a static asset from any static host or CDN
- CSS custom properties for Carbon branding (dark theme, accent green `#8FBF6B`)
- Fonts: Roboto Slab (headings), Roboto (body) — loaded from Google Fonts
- Mobile-first responsive; handles iOS safe areas and keyboard quirks
- Chat UI with: welcome state, message bubbles, typing indicator, dynamic model card, session-complete state, error toast
- `overflow: hidden` on body — the conversation area scrolls internally, not the page

### Backend (`server.js`)
- **Runtime:** Node.js ≥18
- **Framework:** Express 4
- **Security:** Helmet (HTTP headers), CORS restricted to `ALLOWED_ORIGIN` env var
- **AI:** Anthropic Claude via `@anthropic-ai/sdk` (`claude-sonnet-4-20250514` by default)
- **Database:** Supabase (PostgreSQL) via `@supabase/supabase-js`
- **Session management:** In-memory `Map` — sessions are ephemeral until finalized to Supabase
- **Rate limiting:** In-memory per-session sliding window (default: 10 requests/minute)
- **Session limits:** Max 40 messages/session, 30-minute timeout (all configurable via env vars)

### npm Dependencies
```
@anthropic-ai/sdk   ^0.39.0
@supabase/supabase-js ^2.49.1
cors                ^2.8.5
express             ^4.21.2
helmet              ^8.0.0
uuid                ^11.1.0
```

### Database (Supabase / PostgreSQL)
Three tables:
- **`sessions`** — one row per chatbot conversation (metadata, status, review workflow fields)
- **`messages`** — every message in every conversation with role and timestamp
- **`prospect_profiles`** — combined prospect + assistant text for quick team review; has nullable fields for manual/post-hoc structured data entry (revenue range, niche, five-system scores)

Two views for team review:
- **`session_overview`** — joined sessions + profile snapshot
- **`conversation_view`** — all messages in order with session metadata

Row Level Security is enabled; service role key bypasses RLS (backend uses service key).

### Planned Hosting
- **Backend:** Railway (health check endpoint at `GET /health` is Railway-compatible)
- **Frontend:** Static host (e.g., Netlify, Vercel, Webflow, or direct file share)

---

## Backend API

The backend exposes three endpoints (plus health check):

```
GET  /health                 — Health check (Railway monitoring)
POST /api/session/start      — Create session, returns { sessionId }
POST /api/chat               — Send message; requires X-Session-ID header
POST /api/session/end        — Finalize session, flush to Supabase
```

**Session flow:**
1. Frontend calls `POST /api/session/start` → receives `sessionId`
2. Frontend sends `X-Session-ID: {sessionId}` header on every `POST /api/chat`
3. Backend maintains conversation history server-side (not sent by frontend)
4. When Claude's response looks like a dynamic model (contains phase structure + length > 2000 chars), `isComplete: true` is returned and session is finalized after 2 minutes
5. Frontend can also call `POST /api/session/end` to finalize explicitly

**Chat response shape:**
```json
{
  "response": "...",
  "sessionId": "...",
  "messageCount": 4,
  "isComplete": false
}
```

---

## Environment Variables

```
ANTHROPIC_API_KEY          Required. Never expose to frontend.
CLAUDE_MODEL               Default: claude-sonnet-4-20250514
SUPABASE_URL               Required. Your Supabase project URL.
SUPABASE_SERVICE_KEY       Required. Service role key (bypasses RLS).
PORT                       Default: 3000
ALLOWED_ORIGIN             CORS allowed origin. Set to frontend domain in production.
RATE_LIMIT_PER_MINUTE      Default: 10
MAX_MESSAGES_PER_SESSION   Default: 40
SESSION_TIMEOUT_MINUTES    Default: 30
```

Three env vars are validated at startup (`ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`). Missing any causes `process.exit(1)`.

---

## Known Issues / Outstanding Work

These must be resolved before the application is functional:

### 1. Frontend-Backend API Mismatch (CRITICAL)
The frontend (`index.html`) was written with a simpler single-endpoint API design:
- It calls `POST /api/chat` with `{ sessionId, message, conversationHistory }` in the body
- It does NOT call `/api/session/start` first
- It sends conversation history from the client

The backend was built with a different design:
- Requires `POST /api/session/start` first to get a `sessionId`
- Accepts `X-Session-ID` as a header (not body)
- Maintains history server-side (ignores client-sent history)
- Returns `response` (not `message`) in the chat response

**The frontend JavaScript must be rewritten to match the actual backend API.** The CONFIG.apiEndpoint placeholder also needs updating.

### 2. system-prompt.md Cannot Be Required by Node.js
`server.js` does `const { SYSTEM_PROMPT } = require("./system-prompt")` but the file is `system-prompt.md`. Node.js cannot require `.md` files. This needs to be resolved by either:
- Creating `system-prompt.js` that exports `module.exports = { SYSTEM_PROMPT: '...' }` with the prompt content
- Or renaming/converting the file

### 3. package.json Main Entry Is Wrong
`"main": "src/server.js"` — actual file is `server.js` in root (no `src/` subdirectory).

### 4. gitignore Not Named .gitignore
The file `gitignore` should be `.gitignore` (prefixed with dot).

### 5. Dependencies Not Installed
No `node_modules/` exists. Run `npm install` before testing the backend.

### 6. API Endpoint Placeholder in Frontend
`CONFIG.apiEndpoint` in `index.html` is set to `'https://your-backend-api.example.com/api/chat'`. This is a placeholder and must be updated to the actual Railway deployment URL.

### 7. Contact Method Placeholder in System Prompt
`system-prompt.md` line 234 contains `[CONTACT METHOD — TO BE INSERTED]` — the actual Carbon Consulting contact URL/email needs to be filled in.

---

## Key Constraints — Never Violate These

1. **ANTHROPIC_API_KEY must never appear in the frontend.** All Claude API calls go through the backend proxy. The frontend only talks to the Express server.

2. **The `system-prompt.md` behavioral rules are business-critical.** Do not change the AI's instructions without understanding the full document. Key rules: never provide implementation-level detail (strategic direction only), complete in 8–10 exchanges, all five ecosystem components must be assessed every time, never hard-sell.

3. **The frontend is a single static file.** Do not introduce a build step, npm dependencies, or a framework unless explicitly instructed. The simplicity is intentional.

4. **Logging failures must never crash the server.** The `logSessionToSupabase` function catches all errors. This is by design — Supabase outages should not break the chatbot.

5. **Session history is authoritative on the server.** The backend is the source of truth for conversation history. Do not trust or use client-sent history for Claude API calls.

6. **CORS is locked to `ALLOWED_ORIGIN`.** Do not open CORS to `*` in production.

7. **The `SUPABASE_SERVICE_KEY` bypasses RLS.** It must only be used server-side. Never expose it to the frontend. Use the anon key for any client-side Supabase access (currently none).

8. **The dynamic model card in the frontend uses `innerHTML` with `renderMarkdown()`.** HTML output is escaped first via `escapeHtml()` before markdown-to-HTML conversion. Do not bypass this escaping.

---

## AI Conversation Design

The chatbot runs a 4-phase structured interview:

- **Phase 1 — Qualification:** Business overview + revenue level → routes to Early-stage (<$10K), Main ($10K–$100K), or Advanced (>$100K) flow
- **Phase 2 — Core Diagnostic:** Five probes in order: Traffic → Conversion → Fulfillment → Positioning → Operations. One adaptive follow-up if needed.
- **Phase 3 — Synthesis Check:** AI summarizes its read and asks the prospect to confirm before generating the dynamic model
- **Phase 4 — Dynamic Model Delivery:** Personalized dynamic model (Diagnostic Summary → Primary Bottleneck → 3–5 prioritized steps → Leverage Point) followed by a soft Carbon Consulting CTA

The AI maintains internal scores (Strong / Adequate / Weak / Critical) for each component but never shares them with the prospect. The dynamic model format is designed to feel diagnostic and specific — every point must reference something the prospect actually said.

---

## Current Project State (as of session start)

- All files created and structured
- Backend API design is complete and coherent
- Frontend UI design is complete and polished
- **The frontend JS and backend API are mismatched and must be reconciled before the app works end-to-end**
- Database schema is ready to deploy to Supabase
- System prompt is complete but stored as `.md` (needs JS module wrapper)
- No deployment exists yet; no `node_modules`
- Not initialized as a git repository

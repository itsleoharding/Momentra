# Momentra

Backend API proxy and frontend chat UI for Carbon Consulting's diagnostic chatbot.

## Setup
1. Copy .env.example to .env and fill in real values
2. Run npm install
3. Run npm run dev for local development

## Structure
- src/server.js — Express server, API proxy, session management, Supabase logging
- src/system-prompt.js — Chatbot system prompt (exported as SYSTEM_PROMPT)
- public/index.html — Single-file frontend chat UI (served as static file)

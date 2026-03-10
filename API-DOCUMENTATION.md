# Carbon Consulting Backend API v2 — Endpoint Documentation

**Base URL:** Your Railway deployment URL or custom domain.

All conversational endpoints require the `X-Session-ID` header (returned from session start).

---

## GET /health

Health check for Railway monitoring.

**Response:** `{ "status": "ok", "timestamp": "..." }`

---

## POST /api/session/start

**Trigger:** Slide 1 form submission (contact capture).

Creates a new session and stores contact data. This IS the session start — there is no separate initialization step.

**Request body:**
```json
{
  "contact": {
    "fullName": "Sarah Chen",
    "email": "sarah@example.com",
    "instagramHandle": "@sarahcoaches",
    "phone": "+27821234567",
    "city": "Cape Town",
    "country": "South Africa",
    "timezone": "Africa/Johannesburg"
  },
  "referralSource": "cold-outreach-march"
}
```

Required fields: `fullName`, `email`. All others optional.
`referralSource` is optional (populate from URL parameter).

**Success (200):**
```json
{ "sessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }
```

**Errors:**
- 400: Missing or invalid contact data.

---

## POST /api/intake

**Trigger:** Slide 2 form submission (multiple-choice intake).

Writes structured answers to the session. Must be called after session start.

**Headers:** `X-Session-ID: [session-id]`

**Request body:**
```json
{
  "answers": {
    "paidAdvertising": "Yes",
    "organicContent": "Both paid and organic",
    "youtubeAudience": "10K-50K",
    "instagramAudience": "50K-100K",
    "youtubeImpressions": "100K-500K",
    "instagramImpressions": "500K-1M",
    "revenueRange": "$30K-$60K",
    "niche": "Health and fitness"
  }
}
```

All eight fields are required. Values must match exactly:

| Field | Valid values |
|-------|-------------|
| paidAdvertising | Yes, No, Planning to |
| organicContent | Yes, No, Both paid and organic |
| youtubeAudience | Under 1K, 1K-10K, 10K-50K, 50K-100K, 100K+, Not on YouTube |
| instagramAudience | Under 1K, 1K-10K, 10K-50K, 50K-100K, 100K+, Not on Instagram |
| youtubeImpressions | Under 10K, 10K-100K, 100K-500K, 500K-1M, 1M+, Not on YouTube |
| instagramImpressions | Under 10K, 10K-100K, 100K-500K, 500K-1M, 1M+, Not on Instagram |
| revenueRange | Under $5K, $5K-$15K, $15K-$30K, $30K-$60K, $60K-$100K, $100K+ |
| niche | Health and fitness, Business and finance, Relationships, Personal development, Parenting, Other |

**Success (200):**
```json
{ "status": "ok", "sessionId": "..." }
```

**Errors:**
- 400: Missing answers or invalid values (error message lists which fields failed).
- 404 `SESSION_EXPIRED`: Session not found or timed out.

---

## POST /api/chat

**Trigger:** Every message on slides 3 (interview) and 4 (dynamic model).

Sends a user message to Claude and returns the response. The backend automatically injects all slide 1 + 2 data into the system prompt on every call.

**Headers:** `X-Session-ID: [session-id]`

**Request body — normal message (slide 3 interview):**
```json
{
  "message": "I run group coaching programs for fitness professionals..."
}
```

**Request body — dynamic model generation trigger (slide 4):**
```json
{
  "type": "generate_model"
}
```

When `type` is `generate_model`, the backend sends a dynamic model generation prompt to Claude. No `message` field needed.

**Request body — dynamic model refinement (slide 4 follow-up):**
```json
{
  "message": "Can you expand on the traffic section and add more detail about YouTube strategy?"
}
```

Refinement uses the same endpoint with a normal `message`. The full conversation history (including the original dynamic model) is maintained.

**Success (200):**
```json
{
  "response": "Based on what you've shared...",
  "sessionId": "...",
  "messageCount": 8,
  "isModel": false,
  "modelVersion": null
}
```

When a dynamic model is detected:
```json
{
  "response": "## Your Dynamic Model\n\n...",
  "sessionId": "...",
  "messageCount": 16,
  "isModel": true,
  "modelVersion": 1
}
```

`modelVersion` increments with each refinement (1 = first dynamic model, 2 = first refinement, etc.)

**Errors:**

| Status | Code | Meaning |
|--------|------|---------|
| 400 | — | Missing session ID or invalid message |
| 400 | INTAKE_REQUIRED | Intake not yet submitted for this session |
| 404 | SESSION_EXPIRED | Session not found or timed out |
| 429 | RATE_LIMITED | Too many requests per minute |
| 429 | MESSAGE_LIMIT | Hit 40-message session cap |
| 503 | API_BUSY | Claude API rate limited |
| 500 | API_ERROR | Unexpected error |

---

## POST /api/session/end

**Trigger:** User accepts final dynamic model on slide 4.

Writes the final dynamic model to the database, calculates session duration, and cleans up the session.

**Headers:** `X-Session-ID: [session-id]`

**Success (200):**
```json
{ "status": "ended" }
```

If already ended:
```json
{ "status": "already_ended" }
```

---

## Frontend Integration Flow

```javascript
const API = ''; // Same origin — no base URL needed

// ---- Slide 1: Contact capture ----
const { sessionId } = await fetch(API + '/api/session/start', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contact: {
      fullName: nameInput.value,
      email: emailInput.value,
      instagramHandle: igInput.value || undefined,
      phone: phoneInput.value || undefined,
    },
    referralSource: new URLSearchParams(location.search).get('ref'),
  }),
}).then(r => r.json());

// Store sessionId for all subsequent calls
const headers = {
  'Content-Type': 'application/json',
  'X-Session-ID': sessionId,
};

// ---- Slide 2: Intake answers ----
await fetch(API + '/api/intake', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    answers: {
      paidAdvertising: 'Yes',
      organicContent: 'Both paid and organic',
      youtubeAudience: '10K-50K',
      instagramAudience: '50K-100K',
      youtubeImpressions: '100K-500K',
      instagramImpressions: '500K-1M',
      revenueRange: '$30K-$60K',
      niche: 'Health and fitness',
    },
  }),
});

// ---- Slide 3: Interview messages ----
async function sendMessage(text) {
  const res = await fetch(API + '/api/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: text }),
  });
  return res.json();
}

// ---- Slide 4: Generate dynamic model ----
async function generateModel() {
  const res = await fetch(API + '/api/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify({ type: 'generate_model' }),
  });
  return res.json(); // { response, isModel: true, modelVersion: 1 }
}

// ---- Slide 4: Refine dynamic model ----
async function refineModel(feedback) {
  const res = await fetch(API + '/api/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: feedback }),
  });
  return res.json(); // { response, isModel: true, modelVersion: 2 }
}

// ---- End session ----
async function endSession() {
  await fetch(API + '/api/session/end', { method: 'POST', headers });
}
```

---

## Data Flow Summary

```
Slide 1  →  POST /api/session/start  →  sessions + prospect_identity tables
Slide 2  →  POST /api/intake         →  intake_answers table
Slide 3  →  POST /api/chat (repeat)  →  conversation_messages table
Slide 4  →  POST /api/chat (dynamic model) →  conversation_messages table
Accept   →  POST /api/session/end    →  dynamic models table + session finalized
```

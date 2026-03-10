require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

// =============================================================================
// === RUN THIS SQL IN SUPABASE BEFORE DEPLOYING THIS CODE ===
// =============================================================================
//
// -- Step 1: Drop old intake_answers table and recreate with new schema
// DROP TABLE IF EXISTS intake_answers CASCADE;
//
// CREATE TABLE intake_answers (
//   id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
//   session_id UUID NOT NULL UNIQUE REFERENCES sessions(session_id) ON DELETE CASCADE,
//   niche_category TEXT NOT NULL,
//   niche_subcategory TEXT NOT NULL,
//   fulfillment_model TEXT NOT NULL,
//   price_point TEXT NOT NULL,
//   funnel_type TEXT NOT NULL,
//   sales_team JSONB NOT NULL DEFAULT '[]'::jsonb,
//   paid_advertising TEXT NOT NULL,
//   ad_spend TEXT,
//   youtube_subscribers TEXT,
//   youtube_impressions TEXT,
//   instagram_followers TEXT,
//   instagram_impressions TEXT,
//   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
// );
//
// CREATE INDEX idx_intake_answers_session ON intake_answers(session_id);
// CREATE INDEX idx_intake_answers_niche ON intake_answers(niche_category);
// ALTER TABLE intake_answers ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "Service role full access" ON intake_answers
//   FOR ALL USING (auth.role() = 'service_role');
//
// -- Step 2: Add page_reached column to sessions
// ALTER TABLE sessions ADD COLUMN IF NOT EXISTS page_reached TEXT NOT NULL DEFAULT 'landing'
//   CHECK (page_reached IN ('landing', 'application', 'sales_vsl'));
//
// -- Step 3: Update completion_status CHECK constraint and add VSL columns
// ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_completion_status_check;
// ALTER TABLE sessions ADD CONSTRAINT sessions_completion_status_check
//   CHECK (completion_status IN (
//     'page_loaded',
//     'vsl_1_started',
//     'contact_captured',
//     'intake_completed',
//     'interview_started',
//     'interview_completed',
//     'review_reached',
//     'roadmap_delivered',
//     'roadmap_refined',
//     'sales_page_reached',
//     'vsl_2_started',
//     'cta_clicked'
//   ));
// ALTER TABLE sessions ALTER COLUMN completion_status SET DEFAULT 'page_loaded';
// ALTER TABLE sessions ADD COLUMN IF NOT EXISTS vsl_1_max_percent INTEGER DEFAULT 0;
// ALTER TABLE sessions ADD COLUMN IF NOT EXISTS vsl_2_max_percent INTEGER DEFAULT 0;
//
// -- Step 4: Update views
// DROP VIEW IF EXISTS prospect_overview;
// CREATE VIEW prospect_overview AS
// SELECT
//   s.session_id,
//   s.started_at,
//   s.completion_status,
//   s.review_status,
//   s.follow_up_status,
//   s.duration_seconds,
//   s.referral_source,
//   s.page_reached,
//   s.team_notes,
//   pi.full_name,
//   pi.email,
//   pi.instagram_handle,
//   pi.phone,
//   ia.niche_category,
//   ia.niche_subcategory,
//   ia.fulfillment_model,
//   ia.price_point,
//   ia.paid_advertising,
//   r.refinement_count
// FROM sessions s
// LEFT JOIN prospect_identity pi ON s.session_id = pi.session_id
// LEFT JOIN intake_answers ia ON s.session_id = ia.session_id
// LEFT JOIN dynamic_models r ON s.session_id = r.session_id
// ORDER BY s.started_at DESC;
//
// DROP VIEW IF EXISTS qualified_prospects;
// CREATE VIEW qualified_prospects AS
// SELECT
//   s.session_id,
//   pi.full_name,
//   pi.email,
//   pi.instagram_handle,
//   ia.niche_category,
//   ia.niche_subcategory,
//   ia.fulfillment_model,
//   ia.price_point,
//   ia.paid_advertising,
//   r.final_model,
//   s.team_notes
// FROM sessions s
// JOIN prospect_identity pi ON s.session_id = pi.session_id
// JOIN intake_answers ia ON s.session_id = ia.session_id
// LEFT JOIN dynamic_models r ON s.session_id = r.session_id
// WHERE s.review_status = 'qualified'
//   AND s.follow_up_status = 'none'
// ORDER BY s.started_at DESC;
//
// =============================================================================

// =============================================================================
// Momentra Backend — v2
// Node.js/Express API proxy with five-widget architecture
// =============================================================================

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const Anthropic = require("@anthropic-ai/sdk");
const { createClient } = require("@supabase/supabase-js");
const { SYSTEM_PROMPT } = require("./system-prompt");

// =============================================================================
// Configuration
// =============================================================================

const CONFIG = {
  port: parseInt(process.env.PORT || "3000", 10),
  claudeModel: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
  allowedOrigin: process.env.ALLOWED_ORIGIN || "http://localhost:5500",
  rateLimitPerMinute: parseInt(process.env.RATE_LIMIT_PER_MINUTE || "10", 10),
  maxMessagesPerSession: parseInt(
    process.env.MAX_MESSAGES_PER_SESSION || "40",
    10
  ),
  sessionTimeoutMs:
    parseInt(process.env.SESSION_TIMEOUT_MINUTES || "30", 10) * 60 * 1000,
  maxTokens: 4096,
};

// =============================================================================
// Service initialization
// =============================================================================

const requiredEnvVars = [
  "ANTHROPIC_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_KEY",
];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`FATAL: Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const app = express();

// =============================================================================
// Middleware
// =============================================================================

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "https:", "'unsafe-inline'"],
        fontSrc: ["'self'", "https:", "data:"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        frameSrc: ["https://www.loom.com"],
      },
    },
  })
);

app.use(
  cors({
    origin: CONFIG.allowedOrigin,
    methods: ["POST", "GET"],
    allowedHeaders: ["Content-Type", "X-Session-ID"],
  })
);

app.use(express.json({ limit: "50kb" }));

// Serve static frontend from /public
app.use(express.static(path.join(__dirname, "..", "public")));

// =============================================================================
// In-memory session store
// =============================================================================
// Holds conversation history and structured data for active sessions.
// Flushed to Supabase on session end/timeout.

const sessions = new Map();

function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;

  const elapsed = Date.now() - session.lastActiveAt.getTime();
  if (elapsed > CONFIG.sessionTimeoutMs) {
    cleanupSession(sessionId, "timeout");
    return null;
  }

  session.lastActiveAt = new Date();
  return session;
}

// =============================================================================
// Rate limiting (per session)
// =============================================================================

const rateLimitMap = new Map();

function checkRateLimit(sessionId) {
  const now = Date.now();
  const windowMs = 60_000;

  if (!rateLimitMap.has(sessionId)) {
    rateLimitMap.set(sessionId, []);
  }

  const timestamps = rateLimitMap.get(sessionId);
  while (timestamps.length > 0 && timestamps[0] < now - windowMs) {
    timestamps.shift();
  }

  if (timestamps.length >= CONFIG.rateLimitPerMinute) {
    return false;
  }

  timestamps.push(now);
  return true;
}

// =============================================================================
// Prospect context builder
// =============================================================================
// Formats slide 1 + slide 2 data into a block injected into the system prompt.

function buildProspectContext(session) {
  const { contact, intake } = session;

  let context = "<!-- PROSPECT CONTEXT -->\n";

  // Slide 1: Contact data
  if (contact) {
    context += `Name: ${contact.fullName}\n`;
    context += `Email: ${contact.email}\n`;
    if (contact.instagramHandle)
      context += `Instagram: ${contact.instagramHandle}\n`;
    if (contact.phone) context += `Phone: ${contact.phone}\n`;
    if (contact.city || contact.country) {
      const loc = [contact.city, contact.country].filter(Boolean).join(", ");
      context += `Location: ${loc}\n`;
    }
    if (contact.timezone) context += `Timezone: ${contact.timezone}\n`;
  }

  // Slide 2: Intake answers
  if (intake) {
    context += `\nNiche: ${intake.niche_category} \u2014 ${intake.niche_subcategory}\n`;
    context += `Fulfillment model: ${intake.fulfillment_model}\n`;
    context += `Main offer price point: ${intake.price_point}\n`;
    context += `Funnel type: ${Array.isArray(intake.funnel_type) ? intake.funnel_type.join(", ") : intake.funnel_type}\n`;
    context += `Sales team: ${Array.isArray(intake.sales_team) ? intake.sales_team.join(", ") : "None"}\n`;
    context += `Paid advertising: ${intake.paid_advertising}\n`;
    if (intake.paid_advertising === 'Yes' && intake.ad_spend) {
      context += `Monthly ad spend: ${intake.ad_spend}\n`;
    }
    if (intake.youtube_subscribers) {
      context += `YouTube: ${intake.youtube_subscribers} subscribers, ${intake.youtube_impressions || "unknown"} monthly impressions\n`;
    } else {
      context += `YouTube: Not on YouTube\n`;
    }
    if (intake.instagram_followers) {
      context += `Instagram: ${intake.instagram_followers} followers, ${intake.instagram_impressions || "unknown"} monthly impressions\n`;
    } else {
      context += `Instagram: Not on Instagram\n`;
    }
  }

  context += "<!-- END PROSPECT CONTEXT -->";
  return context;
}

function buildFullSystemPrompt(session) {
  const prospectContext = buildProspectContext(session);
  return `${SYSTEM_PROMPT}\n\n${prospectContext}`;
}

// =============================================================================
// Supabase write helpers
// =============================================================================

async function writeSessionToSupabase(session) {
  try {
    const { error } = await supabase.from("sessions").insert({
      session_id: session.id,
      started_at: session.createdAt.toISOString(),
      completion_status: "page_loaded",
      referral_source: session.referralSource,
    });
    if (error) {
      console.error("Failed to write session:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Session write error:", err.message);
    return false;
  }
}

async function writeContactToSupabase(sessionId, contact) {
  try {
    const { error } = await supabase.from("prospect_identity").insert({
      session_id: sessionId,
      full_name: contact.fullName,
      email: contact.email,
      instagram_handle: contact.instagramHandle || null,
      phone: contact.phone || null,
      city: contact.city || null,
      country: contact.country || null,
      timezone: contact.timezone || null,
    });
    if (error) {
      console.error("Failed to write contact:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Contact write error:", err.message);
    return false;
  }
}

async function writeIntakeToSupabase(sessionId, intake) {
  try {
    const { error } = await supabase.from("intake_answers").insert({
      session_id: sessionId,
      niche_category: intake.niche_category,
      niche_subcategory: intake.niche_subcategory,
      fulfillment_model: intake.fulfillment_model,
      price_point: intake.price_point,
      funnel_type: Array.isArray(intake.funnel_type) ? JSON.stringify(intake.funnel_type) : intake.funnel_type,
      sales_team: intake.sales_team,
      paid_advertising: intake.paid_advertising,
      ad_spend: intake.ad_spend || null,
      youtube_subscribers: intake.youtube_subscribers || null,
      youtube_impressions: intake.youtube_impressions || null,
      instagram_followers: intake.instagram_followers || null,
      instagram_impressions: intake.instagram_impressions || null,
    });
    if (error) {
      console.error("Failed to write intake:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Intake write error:", err.message);
    return false;
  }
}

async function writeMessageToSupabase(sessionId, messageIndex, role, content, isModel = false) {
  try {
    const { error } = await supabase.from("conversation_messages").insert({
      session_id: sessionId,
      message_index: messageIndex,
      role,
      content,
      is_model: isModel,
    });
    if (error) {
      console.error("Failed to write message:", error.message);
    }
  } catch (err) {
    console.error("Message write error:", err.message);
  }
}

async function writeModelToSupabase(sessionId, finalText, versionHistory, refinementCount) {
  try {
    const { error } = await supabase.from("dynamic_models").insert({
      session_id: sessionId,
      final_model: finalText,
      version_history: JSON.stringify(versionHistory),
      refinement_count: refinementCount,
    });
    if (error) {
      console.error("Failed to write model:", error.message);
    }
  } catch (err) {
    console.error("Model write error:", err.message);
  }
}

// Ordered completion statuses — only forward progression allowed
const STATUS_ORDER = {
  page_loaded: 1,
  vsl_1_started: 2,
  contact_captured: 3,
  intake_completed: 4,
  interview_started: 5,
  interview_completed: 6,
  review_reached: 7,
  roadmap_delivered: 8,
  roadmap_refined: 9,
  sales_page_reached: 10,
  vsl_2_started: 11,
  cta_clicked: 12,
};

async function updateSessionStatus(sessionId, newStatus, endedAt = null) {
  try {
    // Enforce forward-only progression
    const session = sessions.get(sessionId);
    if (session) {
      const currentOrder = STATUS_ORDER[session.completionStatus] || 0;
      const newOrder = STATUS_ORDER[newStatus] || 0;
      if (newOrder <= currentOrder) return;
      session.completionStatus = newStatus;
    }

    const update = { completion_status: newStatus };
    if (endedAt) {
      update.ended_at = endedAt;
    }
    const { error } = await supabase
      .from("sessions")
      .update(update)
      .eq("session_id", sessionId);
    if (error) {
      console.error("Failed to update session status:", error.message);
    }
  } catch (err) {
    console.error("Session update error:", err.message);
  }
}

async function finalizeSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  const endedAt = new Date().toISOString();
  const durationSeconds = Math.round(
    (Date.now() - session.createdAt.getTime()) / 1000
  );

  try {
    const { error } = await supabase
      .from("sessions")
      .update({
        ended_at: endedAt,
        duration_seconds: durationSeconds,
      })
      .eq("session_id", sessionId);
    if (error) {
      console.error("Failed to finalize session:", error.message);
    }
  } catch (err) {
    console.error("Session finalize error:", err.message);
  }

  // Write the model if one exists
  if (session.modelVersions.length > 0) {
    const finalVersion =
      session.modelVersions[session.modelVersions.length - 1];
    await writeModelToSupabase(
      sessionId,
      finalVersion.content,
      session.modelVersions,
      session.modelVersions.length - 1
    );
  }

  // Clean up memory
  sessions.delete(sessionId);
  rateLimitMap.delete(sessionId);
}

async function cleanupSession(sessionId, reason) {
  const session = sessions.get(sessionId);
  if (!session) return;

  console.log(`Cleaning up session ${sessionId} (${reason})`);
  await finalizeSession(sessionId);
}

// =============================================================================
// Periodic cleanup of stale sessions
// =============================================================================

setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    const elapsed = now - session.lastActiveAt.getTime();
    if (elapsed > CONFIG.sessionTimeoutMs) {
      cleanupSession(sessionId, "timeout");
    }
  }
}, 60_000);

// =============================================================================
// Validation helpers
// =============================================================================

const VALID_INTAKE_VALUES = {
  niche_category: ["Health", "Wealth", "Wellness"],
  niche_subcategory: {
    Health: ["Bodybuilding", "Weight Loss", "Powerlifting", "Athleticism", "Nutrition", "Sports", "Optimization", "Recovery", "Mobility", "Hormones", "Longevity", "Rehab"],
    Wealth: ["Ecommerce", "Trading", "Investing", "Real Estate", "Agency", "Sales", "Affiliate", "Personal Branding", "Freelancing", "Reselling", "Arbitrage", "Scaling", "Coaching", "Team"],
    Wellness: ["Mindset", "Relationships", "Spirituality", "Religion", "Personal Development", "Communication", "Leadership", "Travel", "Parenting", "Productivity", "Confidence", "Sobriety"],
  },
  fulfillment_model: ["Done-for-you", "Done-with-you", "Do-it-yourself"],
  price_point: ["$0\u2013$100", "$100\u2013$1,000", "$1,000\u2013$5,000", "$5,000\u2013$10,000"],
  funnel_type: ["VSL Funnel", "Webinar Funnel", "Profile Funnel", "Challenge Funnel", "Free Community Funnel", "Momentra Funnel", "None"],
  sales_team: ["Setter", "Closer", "Dialer", "Manager", "Agency", "Full Cycle Rep", "None"],
  paid_advertising: ["Yes", "No"],
  ad_spend: ["$0\u2013$1,000", "$1,000\u2013$5,000", "$5,000\u2013$10,000", "$10,000\u2013$100,000"],
  youtube_subscribers: ["0\u20131,000", "1,000\u201310,000", "10,000\u2013100,000", "100,000\u20131,000,000"],
  youtube_impressions: ["0\u201310,000", "10,000\u2013100,000", "100,000\u20131,000,000", "1,000,000\u201310,000,000"],
  instagram_followers: ["0\u20131,000", "1,000\u201310,000", "10,000\u2013100,000", "100,000\u20131,000,000"],
  instagram_impressions: ["0\u201310,000", "10,000\u2013100,000", "100,000\u20131,000,000", "1,000,000\u201310,000,000"],
};

function validateIntakeAnswers(answers) {
  const errors = [];

  // niche_category: required, strict enum
  if (!answers.niche_category || !VALID_INTAKE_VALUES.niche_category.includes(answers.niche_category)) {
    errors.push("Invalid or missing niche_category");
  }

  // niche_subcategory: required, must be valid for category OR any non-empty string (Other)
  if (!answers.niche_subcategory || typeof answers.niche_subcategory !== "string" || answers.niche_subcategory.trim().length === 0) {
    errors.push("Missing niche_subcategory");
  }

  // fulfillment_model: required, strict enum
  if (!answers.fulfillment_model || !VALID_INTAKE_VALUES.fulfillment_model.includes(answers.fulfillment_model)) {
    errors.push("Invalid or missing fulfillment_model");
  }

  // price_point: required, enum or non-empty string (Other)
  if (!answers.price_point || typeof answers.price_point !== "string" || answers.price_point.trim().length === 0) {
    errors.push("Missing price_point");
  }

  // funnel_type: required, array of strings (multi-select)
  if (!Array.isArray(answers.funnel_type) || answers.funnel_type.length === 0) {
    errors.push("funnel_type must be a non-empty array");
  } else {
    const invalidFunnels = answers.funnel_type.filter(v => typeof v !== "string" || v.trim().length === 0);
    if (invalidFunnels.length > 0) {
      errors.push("Invalid funnel_type values");
    }
  }

  // sales_team: required, array, at least one item, valid values, "None" must be sole
  if (!Array.isArray(answers.sales_team) || answers.sales_team.length === 0) {
    errors.push("sales_team must be a non-empty array");
  } else {
    const invalidItems = answers.sales_team.filter(v => !VALID_INTAKE_VALUES.sales_team.includes(v));
    if (invalidItems.length > 0) {
      errors.push(`Invalid sales_team values: ${invalidItems.join(", ")}`);
    }
    if (answers.sales_team.includes("None") && answers.sales_team.length > 1) {
      errors.push("sales_team: 'None' must be the only item if selected");
    }
  }

  // paid_advertising: required, strict enum
  if (!answers.paid_advertising || !VALID_INTAKE_VALUES.paid_advertising.includes(answers.paid_advertising)) {
    errors.push("Invalid or missing paid_advertising");
  }

  // ad_spend: required if paid_advertising is "Yes", must be valid or non-empty string (Other)
  if (answers.paid_advertising === "Yes") {
    if (!answers.ad_spend || (typeof answers.ad_spend !== "string") || answers.ad_spend.trim().length === 0) {
      errors.push("Invalid or missing ad_spend (required when paid_advertising is Yes)");
    }
  }

  // youtube fields: optional, but if provided must be valid or non-empty string (Other)
  if (answers.youtube_subscribers !== undefined && answers.youtube_subscribers !== null) {
    if (typeof answers.youtube_subscribers !== "string" || answers.youtube_subscribers.trim().length === 0) {
      errors.push("Invalid youtube_subscribers");
    }
  }
  if (answers.youtube_impressions !== undefined && answers.youtube_impressions !== null) {
    if (typeof answers.youtube_impressions !== "string" || answers.youtube_impressions.trim().length === 0) {
      errors.push("Invalid youtube_impressions");
    }
  }

  // instagram fields: optional, but if provided must be valid or non-empty string (Other)
  if (answers.instagram_followers !== undefined && answers.instagram_followers !== null) {
    if (typeof answers.instagram_followers !== "string" || answers.instagram_followers.trim().length === 0) {
      errors.push("Invalid instagram_followers");
    }
  }
  if (answers.instagram_impressions !== undefined && answers.instagram_impressions !== null) {
    if (typeof answers.instagram_impressions !== "string" || answers.instagram_impressions.trim().length === 0) {
      errors.push("Invalid instagram_impressions");
    }
  }

  return errors;
}

function validateContact(contact) {
  const errors = [];
  if (!contact.fullName || typeof contact.fullName !== "string" || contact.fullName.trim().length === 0) {
    errors.push("fullName is required");
  }
  if (!contact.email || typeof contact.email !== "string" || !contact.email.includes("@")) {
    errors.push("Valid email is required");
  }
  return errors;
}

// =============================================================================
// Routes
// =============================================================================

// --- Health check ---
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// --- Slide 1: Start session with contact data ---
app.post("/api/session/start", async (req, res) => {
  const { contact, referralSource } = req.body;

  if (!contact) {
    return res.status(400).json({ error: "Contact data is required" });
  }

  const contactErrors = validateContact(contact);
  if (contactErrors.length > 0) {
    return res.status(400).json({ error: contactErrors.join("; ") });
  }

  const sessionId = uuidv4();
  const now = new Date();

  // Create in-memory session
  const session = {
    id: sessionId,
    contact: {
      fullName: contact.fullName.trim(),
      email: contact.email.trim().toLowerCase(),
      instagramHandle: contact.instagramHandle?.trim() || null,
      phone: contact.phone?.trim() || null,
      city: contact.city?.trim() || null,
      country: contact.country?.trim() || null,
      timezone: contact.timezone?.trim() || null,
    },
    intake: null,
    messages: [],
    messageCount: 0,
    modelVersions: [],
    createdAt: now,
    lastActiveAt: now,
    referralSource: referralSource
      ? String(referralSource).slice(0, 200)
      : null,
    completionStatus: "page_loaded",
  };

  sessions.set(sessionId, session);

  // Write to Supabase immediately (contact data is high-value)
  const sessionWritten = await writeSessionToSupabase(session);
  const contactWritten = await writeContactToSupabase(sessionId, session.contact);

  if (!sessionWritten || !contactWritten) {
    console.error(
      `Supabase write partially failed for session ${sessionId}. Data preserved in memory.`
    );
  }

  // Contact was captured — advance status
  updateSessionStatus(sessionId, "contact_captured");

  res.json({ sessionId });
});

// --- Slide 2: Submit intake answers ---
app.post("/api/intake", async (req, res) => {
  const sessionId = req.headers["x-session-id"];
  if (!sessionId) {
    return res.status(400).json({ error: "Missing X-Session-ID header" });
  }

  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({
      error: "Session not found or expired.",
      code: "SESSION_EXPIRED",
    });
  }

  const { answers } = req.body;
  if (!answers) {
    return res.status(400).json({ error: "Intake answers are required" });
  }

  // Flatten nested structure into flat fields
  const flat = {
    niche_category: answers.niche?.category,
    niche_subcategory: answers.niche?.subcategory,
    fulfillment_model: answers.fulfillment_model,
    price_point: answers.price_point,
    funnel_type: answers.funnel_type,
    sales_team: answers.sales_team,
    paid_advertising: answers.paid_advertising,
    ad_spend: answers.ad_spend || null,
    youtube_subscribers: answers.youtube?.subscribers || null,
    youtube_impressions: answers.youtube?.monthly_impressions || null,
    instagram_followers: answers.instagram?.followers || null,
    instagram_impressions: answers.instagram?.monthly_impressions || null,
  };

  const intakeErrors = validateIntakeAnswers(flat);
  if (intakeErrors.length > 0) {
    return res.status(400).json({ error: intakeErrors.join("; ") });
  }

  // Store in memory
  session.intake = flat;

  // Write to Supabase immediately
  const written = await writeIntakeToSupabase(sessionId, session.intake);
  updateSessionStatus(sessionId, "intake_completed");

  if (!written) {
    console.error(
      `Intake write failed for session ${sessionId}. Data preserved in memory.`
    );
  }

  res.json({ status: "ok", sessionId });
});

// --- Page and event tracking ---
app.post("/api/page-track", async (req, res) => {
  const sessionId = req.headers["x-session-id"];
  if (!sessionId) {
    return res.status(400).json({ error: "Missing X-Session-ID header" });
  }

  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({
      error: "Session not found or expired.",
      code: "SESSION_EXPIRED",
    });
  }

  const { page, status } = req.body;

  // Page tracking (existing)
  if (page) {
    const validPages = ["application", "sales_vsl"];
    if (!validPages.includes(page)) {
      return res.status(400).json({ error: "Invalid page value." });
    }
    try {
      const { error } = await supabase
        .from("sessions")
        .update({ page_reached: page })
        .eq("session_id", sessionId);
      if (error) console.error("Failed to update page_reached:", error.message);
    } catch (err) {
      console.error("Page track error:", err.message);
    }
  }

  // Completion status tracking (forward-only)
  if (status && STATUS_ORDER[status]) {
    updateSessionStatus(sessionId, status);
  }

  res.json({ status: "ok" });
});

// --- VSL watch tracking ---
app.post("/api/track-vsl", async (req, res) => {
  const sessionId = req.headers["x-session-id"];
  if (!sessionId) {
    return res.status(400).json({ error: "Missing X-Session-ID header" });
  }

  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({
      error: "Session not found or expired.",
      code: "SESSION_EXPIRED",
    });
  }

  const { video, percent } = req.body;
  const validVideos = ["vsl_1", "vsl_2"];
  const validPercents = [25, 50, 75, 100];

  if (!video || !validVideos.includes(video)) {
    return res.status(400).json({ error: "Invalid video value." });
  }
  if (!percent || !validPercents.includes(percent)) {
    return res.status(400).json({ error: "Invalid percent value." });
  }

  const column = video === "vsl_1" ? "vsl_1_max_percent" : "vsl_2_max_percent";

  try {
    // Only update if new percent is higher than stored value
    const { error } = await supabase.rpc("update_vsl_percent", {
      p_session_id: sessionId,
      p_column: column,
      p_percent: percent,
    });

    // Fallback if RPC doesn't exist: direct update with conditional
    if (error && error.message.includes("function")) {
      await supabase
        .from("sessions")
        .update({ [column]: percent })
        .eq("session_id", sessionId)
        .lt(column, percent);
    } else if (error) {
      console.error("VSL track error:", error.message);
    }
  } catch (err) {
    console.error("VSL track error:", err.message);
  }

  // Also update completion status
  const statusKey = video === "vsl_1" ? "vsl_1_started" : "vsl_2_started";
  updateSessionStatus(sessionId, statusKey);

  res.json({ status: "ok" });
});

// --- Widgets 3-5: Conversational chat ---
app.post("/api/chat", async (req, res) => {
  const sessionId = req.headers["x-session-id"];
  if (!sessionId) {
    return res.status(400).json({ error: "Missing X-Session-ID header" });
  }

  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({
      error: "Session not found or expired.",
      code: "SESSION_EXPIRED",
    });
  }

  // Require intake to be completed before chat starts
  if (!session.intake) {
    return res.status(400).json({
      error: "Intake must be completed before starting the interview.",
      code: "INTAKE_REQUIRED",
    });
  }

  const { message, type } = req.body;

  // Determine the user message content
  let userContent;
  if (type === "review_start") {
    // No actual message to send — just a status signal
    return res.json({ status: "ok", sessionId: session.id });
  } else if (type === "generate_model") {
    userContent =
      "The review phase is complete. Generate my Dynamic Model now. Output only the Dynamic Model following the exact structure in Section 8 (opening paragraph, five system sections with bullets, closing paragraph). No preamble, no confirmation questions, no introductory text. Begin directly with the opening paragraph.";
  } else {
    if (
      !message ||
      typeof message !== "string" ||
      message.trim().length === 0
    ) {
      return res.status(400).json({ error: "Message is required" });
    }
    if (message.length > 5000) {
      return res
        .status(400)
        .json({ error: "Message too long. Maximum 5000 characters." });
    }
    userContent = message.trim();
  }

  // Check limits
  if (session.messageCount >= CONFIG.maxMessagesPerSession) {
    return res.status(429).json({
      error: "Session message limit reached.",
      code: "MESSAGE_LIMIT",
    });
  }

  if (!checkRateLimit(sessionId)) {
    return res.status(429).json({
      error: "Too many requests. Please wait a moment.",
      code: "RATE_LIMITED",
    });
  }

  // Record the user message
  const userIndex = session.messages.length;
  session.messages.push({
    role: "user",
    content: userContent,
    timestamp: new Date().toISOString(),
  });
  session.messageCount++;

  // Update completion status on first chat message
  if (session.messages.filter((m) => m.role === "user").length === 1) {
    updateSessionStatus(sessionId, "interview_started");
  }

  // Handle review phase signals
  if (type === "review_start") {
    updateSessionStatus(sessionId, "review_reached");
  }

  try {
    // Build system prompt with prospect context
    const fullSystemPrompt = buildFullSystemPrompt(session);

    // Build messages array for Claude (without timestamps)
    const claudeMessages = session.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Set up SSE streaming response
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Use lower max_tokens during interview for faster responses
    const isGenerating = type === "generate_model";
    const tokenLimit = isGenerating ? CONFIG.maxTokens : 512;

    // Stream Claude API response
    let assistantContent = "";
    const stream = anthropic.messages.stream({
      model: CONFIG.claudeModel,
      max_tokens: tokenLimit,
      system: fullSystemPrompt,
      messages: claudeMessages,
    });

    stream.on("text", (text) => {
      // Strip em dashes and en dashes from all AI output
      const cleaned = text.replace(/[\u2013\u2014]/g, ",");
      assistantContent += cleaned;
      res.write(`data: ${JSON.stringify({ type: "delta", text: cleaned })}\n\n`);
    });

    await stream.finalMessage();

    // Detect model in response
    const isModel = (
      type === "generate_model" ||
      (
        assistantContent.length > 800 &&
        assistantContent.includes('Conversion:') &&
        assistantContent.includes('Traffic:') &&
        assistantContent.includes('Fulfillment:')
      )
    );

    // Record assistant message
    const assistantIndex = session.messages.length;
    session.messages.push({
      role: "assistant",
      content: assistantContent,
      timestamp: new Date().toISOString(),
    });
    session.messageCount++;

    // Track model versions
    if (isModel) {
      session.modelVersions.push({
        version: session.modelVersions.length + 1,
        content: assistantContent,
        timestamp: new Date().toISOString(),
      });

      if (session.modelVersions.length === 1) {
        updateSessionStatus(sessionId, "roadmap_delivered");
      } else {
        updateSessionStatus(sessionId, "roadmap_refined");
      }
    } else if (session.messages.filter((m) => m.role === "user").length >= 12) {
      updateSessionStatus(sessionId, "interview_completed");
    }

    // Write messages to Supabase (fire and forget — don't block response)
    writeMessageToSupabase(sessionId, userIndex, "user", userContent, false);
    writeMessageToSupabase(
      sessionId,
      assistantIndex,
      "assistant",
      assistantContent,
      isModel
    );

    // Send final message with metadata
    res.write(`data: ${JSON.stringify({
      type: "done",
      response: assistantContent,
      sessionId: session.id,
      messageCount: session.messageCount,
      isModel,
      modelVersion: isModel ? session.modelVersions.length : null,
    })}\n\n`);
    res.end();
  } catch (err) {
    console.error("Claude API error:", err.message);

    // Roll back the user message
    session.messages.pop();
    session.messageCount--;

    const errorData = err.status === 429
      ? { type: "error", error: "The service is temporarily busy. Please try again in a moment.", code: "API_BUSY" }
      : { type: "error", error: "Something went wrong. Please try again.", code: "API_ERROR" };

    // If headers already sent (streaming started), send error via SSE
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify(errorData)}\n\n`);
      res.end();
    } else {
      res.status(err.status === 429 ? 503 : 500).json(errorData);
    }
  }
});

// --- End session ---
app.post("/api/session/end", async (req, res) => {
  const sessionId = req.headers["x-session-id"];
  if (!sessionId) {
    return res.status(400).json({ error: "Missing X-Session-ID header" });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return res.json({ status: "already_ended" });
  }

  await finalizeSession(sessionId);
  res.json({ status: "ended" });
});

// =============================================================================
// Fallback: serve frontend for any non-API route (SPA support)
// =============================================================================

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found" });
  }
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

// =============================================================================
// Start server
// =============================================================================

app.listen(CONFIG.port, () => {
  console.log(`Carbon Consulting backend running on port ${CONFIG.port}`);
  console.log(`CORS origin: ${CONFIG.allowedOrigin}`);
  console.log(`Claude model: ${CONFIG.claudeModel}`);
  console.log(
    `Rate limit: ${CONFIG.rateLimitPerMinute}/min, max ${CONFIG.maxMessagesPerSession} messages/session`
  );
});

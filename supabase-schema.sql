-- =============================================================================
-- Momentra - Complete Schema (fresh install)
-- =============================================================================
-- Run in Supabase Dashboard > SQL Editor > New Query
--
-- WARNING: This drops ALL existing tables and views. Any existing data will be
-- permanently deleted. Export first if you need to keep anything.
-- =============================================================================

-- Drop views first (they depend on tables)
DROP VIEW IF EXISTS qualified_prospects;
DROP VIEW IF EXISTS prospect_overview;
DROP VIEW IF EXISTS full_conversation;

-- Drop tables (CASCADE handles any leftover foreign keys from old schemas)
DROP TABLE IF EXISTS dynamic_models CASCADE;
DROP TABLE IF EXISTS roadmaps CASCADE;
DROP TABLE IF EXISTS conversation_messages CASCADE;
DROP TABLE IF EXISTS intake_answers CASCADE;
DROP TABLE IF EXISTS prospect_identity CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;

-- Also drop any leftover v1 tables
DROP VIEW IF EXISTS conversation_view;
DROP VIEW IF EXISTS session_overview;
DROP TABLE IF EXISTS prospect_profiles CASCADE;
DROP TABLE IF EXISTS messages CASCADE;

-- =============================================================================
-- Sessions (parent record, one row per chatbot interaction)
-- =============================================================================

CREATE TABLE sessions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id UUID NOT NULL UNIQUE,

  -- Timestamps
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,

  -- Completion tracking: which stage did the prospect reach?
  completion_status TEXT NOT NULL DEFAULT 'page_loaded'
    CHECK (completion_status IN (
      'page_loaded',
      'vsl_1_started',
      'contact_captured',
      'intake_completed',
      'interview_started',
      'interview_completed',
      'review_reached',
      'roadmap_delivered',
      'roadmap_refined',
      'sales_page_reached',
      'vsl_2_started',
      'cta_clicked'
    )),

  -- VSL watch tracking
  vsl_1_max_percent INTEGER DEFAULT 0,
  vsl_2_max_percent INTEGER DEFAULT 0,

  -- Page tracking: which page did the prospect reach?
  page_reached TEXT NOT NULL DEFAULT 'landing'
    CHECK (page_reached IN ('landing', 'application', 'sales_vsl')),

  -- Acquisition tracking
  referral_source TEXT,

  -- Team review fields (updated manually by Leo/Michael)
  review_status TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK (review_status IN ('unreviewed', 'qualified', 'disqualified', 'pending')),
  follow_up_status TEXT NOT NULL DEFAULT 'none'
    CHECK (follow_up_status IN (
      'none', 'loom_sent', 'miro_sent', 'call_booked', 'closed'
    )),
  team_notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Prospect Identity (slide 1, contact capture)
-- =============================================================================

CREATE TABLE prospect_identity (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id UUID NOT NULL UNIQUE REFERENCES sessions(session_id) ON DELETE CASCADE,

  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  instagram_handle TEXT,
  phone TEXT,

  -- Optional location fields
  city TEXT,
  country TEXT,
  timezone TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Intake Answers (slide 2, structured multiple-choice)
-- =============================================================================
-- Matches the 8-question widget architecture (Q1-Q8) with cascading and
-- multi-select support. No CHECK constraints on values since the frontend
-- handles validation.

CREATE TABLE intake_answers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id UUID NOT NULL UNIQUE REFERENCES sessions(session_id) ON DELETE CASCADE,

  -- Q1: Niche (cascading, two layers)
  niche_category TEXT NOT NULL,
  niche_subcategory TEXT NOT NULL,

  -- Q2: Fulfillment Model (single select)
  fulfillment_model TEXT NOT NULL,

  -- Q3: Main Offer Price Point (single select with other)
  price_point TEXT NOT NULL,

  -- Q4: Funnel Type (single select with other)
  funnel_type TEXT NOT NULL,

  -- Q5: Sales Team Structure (multi-select, stored as JSON array)
  sales_team JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Q6: Paid Advertising (single select)
  paid_advertising TEXT NOT NULL,

  -- Q7: YouTube Presence (cascading, nullable if not on YouTube)
  youtube_subscribers TEXT,
  youtube_impressions TEXT,

  -- Q8: Instagram Presence (cascading, nullable if not on Instagram)
  instagram_followers TEXT,
  instagram_impressions TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Conversation Transcript (slides 3 + 4, interview and dynamic model)
-- =============================================================================
-- Individual message rows for queryability and readability in Supabase UI.

CREATE TABLE conversation_messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  message_index INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  is_model BOOLEAN NOT NULL DEFAULT FALSE,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (session_id, message_index)
);

-- =============================================================================
-- Dynamic Model (slide 4, final deliverable)
-- =============================================================================
-- Stores the final accepted dynamic model plus version history.

CREATE TABLE dynamic_models (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id UUID NOT NULL UNIQUE REFERENCES sessions(session_id) ON DELETE CASCADE,

  -- The final accepted dynamic model text
  final_model TEXT NOT NULL,

  -- Version history: array of { version, content, timestamp }
  -- Stored as JSONB so refinement cycles are preserved
  version_history JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- How many refinement cycles occurred
  refinement_count INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Indexes
-- =============================================================================

-- Session lookup and filtering
CREATE INDEX idx_sessions_review_status ON sessions(review_status);
CREATE INDEX idx_sessions_completion_status ON sessions(completion_status);
CREATE INDEX idx_sessions_started_at ON sessions(started_at DESC);
CREATE INDEX idx_sessions_page_reached ON sessions(page_reached);

-- Prospect lookup
CREATE INDEX idx_prospect_identity_session ON prospect_identity(session_id);
CREATE INDEX idx_prospect_identity_email ON prospect_identity(email);

-- Intake lookup
CREATE INDEX idx_intake_answers_session ON intake_answers(session_id);
CREATE INDEX idx_intake_answers_niche ON intake_answers(niche_category);

-- Message lookup and ordering
CREATE INDEX idx_conversation_messages_session ON conversation_messages(session_id);
CREATE INDEX idx_conversation_messages_order ON conversation_messages(session_id, message_index);

-- Dynamic model lookup
CREATE INDEX idx_dynamic_models_session ON dynamic_models(session_id);

-- =============================================================================
-- Row Level Security
-- =============================================================================

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE dynamic_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON sessions
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON prospect_identity
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON intake_answers
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON conversation_messages
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON dynamic_models
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================================================
-- Views for team review
-- =============================================================================

-- Quick scan of all prospects for review queue
CREATE VIEW prospect_overview AS
SELECT
  s.session_id,
  s.started_at,
  s.completion_status,
  s.page_reached,
  s.review_status,
  s.follow_up_status,
  s.duration_seconds,
  s.referral_source,
  s.team_notes,
  pi.full_name,
  pi.email,
  pi.instagram_handle,
  pi.phone,
  ia.niche_category,
  ia.niche_subcategory,
  ia.fulfillment_model,
  ia.price_point,
  ia.paid_advertising,
  r.refinement_count
FROM sessions s
LEFT JOIN prospect_identity pi ON s.session_id = pi.session_id
LEFT JOIN intake_answers ia ON s.session_id = ia.session_id
LEFT JOIN dynamic_models r ON s.session_id = r.session_id
ORDER BY s.started_at DESC;

-- Full conversation view for reading a specific session
CREATE VIEW full_conversation AS
SELECT
  cm.session_id,
  cm.message_index,
  cm.role,
  cm.content,
  cm.is_model,
  cm.timestamp,
  s.completion_status
FROM conversation_messages cm
JOIN sessions s ON cm.session_id = s.session_id
ORDER BY cm.session_id, cm.message_index;

-- Qualified prospects ready for Loom follow-up
CREATE VIEW qualified_prospects AS
SELECT
  s.session_id,
  pi.full_name,
  pi.email,
  pi.instagram_handle,
  ia.niche_category,
  ia.niche_subcategory,
  ia.fulfillment_model,
  ia.price_point,
  ia.paid_advertising,
  r.final_model,
  s.team_notes
FROM sessions s
JOIN prospect_identity pi ON s.session_id = pi.session_id
JOIN intake_answers ia ON s.session_id = ia.session_id
LEFT JOIN dynamic_models r ON s.session_id = r.session_id
WHERE s.review_status = 'qualified'
  AND s.follow_up_status = 'none'
ORDER BY s.started_at DESC;

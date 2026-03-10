-- =============================================================================
-- Momentra — Master Schema (single-query full rebuild)
-- =============================================================================
-- Run in Supabase Dashboard > SQL Editor > New Query
--
-- WARNING: Drops all existing tables and data. Export first if needed.
-- =============================================================================

-- ── Drop views ───────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS completion_funnel;
DROP VIEW IF EXISTS vsl_engagement;
DROP VIEW IF EXISTS qualified_prospects;
DROP VIEW IF EXISTS prospect_overview;
DROP VIEW IF EXISTS full_conversation;

-- Legacy v1 views
DROP VIEW IF EXISTS session_overview;

-- ── Drop functions ───────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS update_vsl_percent(UUID, TEXT, INTEGER);

-- ── Drop tables ──────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS dynamic_models CASCADE;
DROP TABLE IF EXISTS conversation_messages CASCADE;
DROP TABLE IF EXISTS intake_answers CASCADE;
DROP TABLE IF EXISTS prospect_identity CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;

-- Legacy v1 tables
DROP TABLE IF EXISTS prospect_profiles CASCADE;
DROP TABLE IF EXISTS messages CASCADE;

-- =============================================================================
-- Sessions
-- =============================================================================

CREATE TABLE sessions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id UUID NOT NULL UNIQUE,

  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,

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

  vsl_1_max_percent INTEGER DEFAULT 0,
  vsl_2_max_percent INTEGER DEFAULT 0,

  page_reached TEXT NOT NULL DEFAULT 'landing'
    CHECK (page_reached IN ('landing', 'application', 'sales_vsl')),

  referral_source TEXT,

  review_status TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK (review_status IN ('unreviewed', 'qualified', 'disqualified', 'pending')),
  follow_up_status TEXT NOT NULL DEFAULT 'none'
    CHECK (follow_up_status IN ('none', 'loom_sent', 'miro_sent', 'call_booked', 'closed')),
  team_notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Prospect Identity
-- =============================================================================

CREATE TABLE prospect_identity (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id UUID NOT NULL UNIQUE REFERENCES sessions(session_id) ON DELETE CASCADE,

  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  instagram_handle TEXT,
  phone TEXT,

  city TEXT,
  country TEXT,
  timezone TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Intake Answers
-- =============================================================================

CREATE TABLE intake_answers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id UUID NOT NULL UNIQUE REFERENCES sessions(session_id) ON DELETE CASCADE,

  niche_category TEXT NOT NULL,
  niche_subcategory TEXT NOT NULL,
  fulfillment_model TEXT NOT NULL,
  price_point TEXT NOT NULL,
  funnel_type TEXT NOT NULL,
  sales_team JSONB NOT NULL DEFAULT '[]'::jsonb,
  paid_advertising TEXT NOT NULL,
  youtube_subscribers TEXT,
  youtube_impressions TEXT,
  instagram_followers TEXT,
  instagram_impressions TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Conversation Messages
-- =============================================================================

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
-- Dynamic Models
-- =============================================================================

CREATE TABLE dynamic_models (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id UUID NOT NULL UNIQUE REFERENCES sessions(session_id) ON DELETE CASCADE,

  final_model TEXT NOT NULL,
  version_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  refinement_count INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Indexes
-- =============================================================================

CREATE INDEX idx_sessions_review_status ON sessions(review_status);
CREATE INDEX idx_sessions_completion_status ON sessions(completion_status);
CREATE INDEX idx_sessions_started_at ON sessions(started_at DESC);
CREATE INDEX idx_sessions_page_reached ON sessions(page_reached);
CREATE INDEX idx_prospect_identity_session ON prospect_identity(session_id);
CREATE INDEX idx_prospect_identity_email ON prospect_identity(email);
CREATE INDEX idx_intake_answers_session ON intake_answers(session_id);
CREATE INDEX idx_intake_answers_niche ON intake_answers(niche_category);
CREATE INDEX idx_conversation_messages_session ON conversation_messages(session_id);
CREATE INDEX idx_conversation_messages_order ON conversation_messages(session_id, message_index);
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
-- Views
-- =============================================================================

-- All prospects for team review queue
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

-- Full conversation transcript for a session
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

-- Completion funnel (last 30 days)
CREATE VIEW completion_funnel AS
SELECT
  completion_status,
  COUNT(*) AS session_count
FROM sessions
WHERE started_at > NOW() - INTERVAL '30 days'
GROUP BY completion_status
ORDER BY
  CASE completion_status
    WHEN 'page_loaded'        THEN 1
    WHEN 'vsl_1_started'      THEN 2
    WHEN 'contact_captured'   THEN 3
    WHEN 'intake_completed'   THEN 4
    WHEN 'interview_started'  THEN 5
    WHEN 'interview_completed' THEN 6
    WHEN 'review_reached'     THEN 7
    WHEN 'roadmap_delivered'  THEN 8
    WHEN 'roadmap_refined'    THEN 9
    WHEN 'sales_page_reached' THEN 10
    WHEN 'vsl_2_started'      THEN 11
    WHEN 'cta_clicked'        THEN 12
  END;

-- VSL engagement (last 30 days)
CREATE VIEW vsl_engagement AS
SELECT
  'Pre-diagnostic VSL' AS video,
  COUNT(*) FILTER (WHERE vsl_1_max_percent >= 25)  AS reached_25,
  COUNT(*) FILTER (WHERE vsl_1_max_percent >= 50)  AS reached_50,
  COUNT(*) FILTER (WHERE vsl_1_max_percent >= 75)  AS reached_75,
  COUNT(*) FILTER (WHERE vsl_1_max_percent >= 100) AS reached_100,
  COUNT(*) AS total_sessions
FROM sessions
WHERE vsl_1_max_percent > 0 AND started_at > NOW() - INTERVAL '30 days'
UNION ALL
SELECT
  'Post-diagnostic VSL' AS video,
  COUNT(*) FILTER (WHERE vsl_2_max_percent >= 25)  AS reached_25,
  COUNT(*) FILTER (WHERE vsl_2_max_percent >= 50)  AS reached_50,
  COUNT(*) FILTER (WHERE vsl_2_max_percent >= 75)  AS reached_75,
  COUNT(*) FILTER (WHERE vsl_2_max_percent >= 100) AS reached_100,
  COUNT(*) AS total_sessions
FROM sessions
WHERE vsl_2_max_percent > 0 AND started_at > NOW() - INTERVAL '30 days';

-- =============================================================================
-- Functions
-- =============================================================================

-- Forward-only VSL percent update (never decrements)
CREATE OR REPLACE FUNCTION update_vsl_percent(
  p_session_id UUID,
  p_column TEXT,
  p_percent INTEGER
) RETURNS VOID AS $$
BEGIN
  IF p_column = 'vsl_1_max_percent' THEN
    UPDATE sessions SET vsl_1_max_percent = p_percent
    WHERE session_id = p_session_id AND vsl_1_max_percent < p_percent;
  ELSIF p_column = 'vsl_2_max_percent' THEN
    UPDATE sessions SET vsl_2_max_percent = p_percent
    WHERE session_id = p_session_id AND vsl_2_max_percent < p_percent;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

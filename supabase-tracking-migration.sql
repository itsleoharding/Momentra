-- ============================================================================
-- TRACKING MIGRATION: Completion Funnel + VSL Watch Tracking
-- Run this in Supabase SQL Editor
-- ============================================================================

-- Step 1: Update completion_status CHECK constraint with new values
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_completion_status_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_completion_status_check
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
  ));

-- Step 2: Update default to page_loaded
ALTER TABLE sessions ALTER COLUMN completion_status SET DEFAULT 'page_loaded';

-- Step 3: Migrate existing status values to new names
UPDATE sessions SET completion_status = 'review_reached' WHERE completion_status = 'review_started';
UPDATE sessions SET completion_status = 'review_reached' WHERE completion_status = 'review_completed';
UPDATE sessions SET completion_status = 'roadmap_delivered' WHERE completion_status = 'model_delivered';
UPDATE sessions SET completion_status = 'roadmap_refined' WHERE completion_status = 'model_refined';

-- Step 4: Add VSL watch percentage columns
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS vsl_1_max_percent INTEGER DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS vsl_2_max_percent INTEGER DEFAULT 0;

-- Step 5: Create completion funnel view
CREATE OR REPLACE VIEW completion_funnel AS
SELECT
  completion_status,
  COUNT(*) as session_count
FROM sessions
WHERE started_at > NOW() - INTERVAL '30 days'
GROUP BY completion_status
ORDER BY
  CASE completion_status
    WHEN 'page_loaded' THEN 1
    WHEN 'vsl_1_started' THEN 2
    WHEN 'contact_captured' THEN 3
    WHEN 'intake_completed' THEN 4
    WHEN 'interview_started' THEN 5
    WHEN 'interview_completed' THEN 6
    WHEN 'review_reached' THEN 7
    WHEN 'roadmap_delivered' THEN 8
    WHEN 'roadmap_refined' THEN 9
    WHEN 'sales_page_reached' THEN 10
    WHEN 'vsl_2_started' THEN 11
    WHEN 'cta_clicked' THEN 12
  END;

-- Step 6: Create VSL engagement view
CREATE OR REPLACE VIEW vsl_engagement AS
SELECT
  'Pre-diagnostic VSL' as video,
  COUNT(*) FILTER (WHERE vsl_1_max_percent >= 25) as reached_25,
  COUNT(*) FILTER (WHERE vsl_1_max_percent >= 50) as reached_50,
  COUNT(*) FILTER (WHERE vsl_1_max_percent >= 75) as reached_75,
  COUNT(*) FILTER (WHERE vsl_1_max_percent >= 100) as reached_100,
  COUNT(*) as total_sessions
FROM sessions
WHERE vsl_1_max_percent > 0 AND started_at > NOW() - INTERVAL '30 days'
UNION ALL
SELECT
  'Post-diagnostic VSL' as video,
  COUNT(*) FILTER (WHERE vsl_2_max_percent >= 25) as reached_25,
  COUNT(*) FILTER (WHERE vsl_2_max_percent >= 50) as reached_50,
  COUNT(*) FILTER (WHERE vsl_2_max_percent >= 75) as reached_75,
  COUNT(*) FILTER (WHERE vsl_2_max_percent >= 100) as reached_100,
  COUNT(*) as total_sessions
FROM sessions
WHERE vsl_2_max_percent > 0 AND started_at > NOW() - INTERVAL '30 days';

-- Step 7: Helper function for forward-only VSL percent updates
-- The backend calls this via supabase.rpc('update_vsl_percent', ...)
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

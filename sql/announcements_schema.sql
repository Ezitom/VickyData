-- ============================================================
-- VICKYDATA Announcements & Announcement Views Schema
-- ============================================================

-- 1. ANNOUNCEMENTS TABLE
CREATE TABLE IF NOT EXISTS announcements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  message TEXT NOT NULL,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. ANNOUNCEMENT VIEWS TABLE
CREATE TABLE IF NOT EXISTS announcement_views (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  announcement_id UUID REFERENCES announcements(id) ON DELETE CASCADE,
  seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT unique_user_announcement UNIQUE (user_id, announcement_id)
);

-- 3. ROW LEVEL SECURITY & POLICIES
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for anon" ON announcements FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON announcement_views FOR ALL USING (true) WITH CHECK (true);

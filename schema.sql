-- Ulysses App — D1 Database Schema

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  parentId TEXT,
  name TEXT NOT NULL,
  sortOrder INTEGER DEFAULT 0,
  createdAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sheets (
  id TEXT PRIMARY KEY,
  groupId TEXT NOT NULL,
  title TEXT DEFAULT 'Untitled',
  content TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  images TEXT DEFAULT '[]',
  sortOrder INTEGER DEFAULT 0,
  favorite INTEGER DEFAULT 0,
  isTrashed INTEGER DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#888'
);

CREATE TABLE IF NOT EXISTS sheet_tags (
  id TEXT PRIMARY KEY,
  sheetId TEXT NOT NULL,
  tagId TEXT NOT NULL,
  UNIQUE(sheetId, tagId)
);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  sheetId TEXT NOT NULL UNIQUE,
  targetType TEXT NOT NULL,
  targetValue INTEGER NOT NULL,
  mode TEXT DEFAULT 'about',
  deadline TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_sheets_groupId ON sheets(groupId);
CREATE INDEX IF NOT EXISTS idx_sheets_isTrashed ON sheets(isTrashed);
CREATE INDEX IF NOT EXISTS idx_sheets_favorite ON sheets(favorite);
CREATE INDEX IF NOT EXISTS idx_sheets_updatedAt ON sheets(updatedAt);
CREATE INDEX IF NOT EXISTS idx_sheet_tags_sheetId ON sheet_tags(sheetId);
CREATE INDEX IF NOT EXISTS idx_sheet_tags_tagId ON sheet_tags(tagId);
CREATE INDEX IF NOT EXISTS idx_groups_parentId ON groups(parentId);
CREATE INDEX IF NOT EXISTS idx_goals_sheetId ON goals(sheetId);

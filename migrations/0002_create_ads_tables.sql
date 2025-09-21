DROP TABLE IF EXISTS ad_insights;
DROP TABLE IF EXISTS ads;
DROP TABLE IF EXISTS comments;

CREATE TABLE ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  advertiser_name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'google_ads_transparency',
  ad_identifier TEXT NOT NULL,
  image_url TEXT NOT NULL,
  metadata TEXT,
  first_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_ads_unique_identifier
  ON ads(advertiser_name, platform, ad_identifier);

CREATE TABLE ad_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_id INTEGER NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  insight_type TEXT NOT NULL DEFAULT 'summary',
  insight TEXT NOT NULL,
  raw_response TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_ad_insights_unique
  ON ad_insights(ad_id, model, insight_type);

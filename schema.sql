DROP TABLE IF EXISTS articles;
CREATE TABLE articles (
  id INTEGER PRIMARY KEY,
  title TEXT, 
  url TEXT, 
  summary_zh TEXT,
  why_it_matters TEXT,
  tags TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'jimeng-relay.db');

let db;

function getDb() {
  if (!db) {
    const isNew = !fs.existsSync(DB_PATH);
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    if (isNew) initSchema();
    else migrateSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT DEFAULT 'image' CHECK(type IN ('image','video')),
      prompt TEXT NOT NULL,
      negative_prompt TEXT DEFAULT '',
      model TEXT DEFAULT 'jimeng-4.5',
      ratio TEXT DEFAULT '1:1',
      resolution TEXT DEFAULT '2k',
      duration INTEGER DEFAULT 5,
      video_mode TEXT DEFAULT 'text_to_video',
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')),
      output_url TEXT DEFAULT '',
      error_message TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function migrateSchema() {
  const cols = db.prepare("PRAGMA table_info(tasks)").all().map(c => c.name);
  if (!cols.includes('type')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN type TEXT DEFAULT 'image'`);
  }
  if (!cols.includes('duration')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN duration INTEGER DEFAULT 5`);
  }
  if (!cols.includes('video_mode')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN video_mode TEXT DEFAULT 'text_to_video'`);
  }
  if (cols.includes('image_url') && !cols.includes('output_url')) {
    db.exec(`ALTER TABLE tasks RENAME COLUMN image_url TO output_url`);
  }
  if (!cols.includes('output_url') && cols.includes('image_url')) {
    db.exec(`ALTER TABLE tasks RENAME COLUMN image_url TO output_url`);
  }
}

function createTask({ prompt, negative_prompt, model, ratio, resolution, type, duration, video_mode }) {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT INTO tasks (prompt, negative_prompt, model, ratio, resolution, type, duration, video_mode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    prompt,
    negative_prompt || '',
    model || 'jimeng-4.5',
    ratio || '1:1',
    resolution || '2k',
    type || 'image',
    duration || 5,
    video_mode || 'text_to_video'
  );
  return { id: result.lastInsertRowid };
}

function getTask(id) {
  return getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id);
}

function listTasks(limit = 50) {
  return getDb().prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT ?').all(limit);
}

function getPendingTask() {
  return getDb().prepare("SELECT * FROM tasks WHERE status = 'pending' ORDER BY id ASC LIMIT 1").get();
}

function setTaskStatus(id, status, extra = {}) {
  const d = getDb();
  const fields = ['status = ?'];
  const values = [status];

  if (extra.output_url !== undefined) {
    fields.push('output_url = ?');
    values.push(extra.output_url);
  }
  if (extra.error_message !== undefined) {
    fields.push('error_message = ?');
    values.push(extra.error_message);
  }

  fields.push("updated_at = datetime('now')");
  values.push(id);
  d.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

module.exports = { getDb, createTask, getTask, listTasks, getPendingTask, setTaskStatus };

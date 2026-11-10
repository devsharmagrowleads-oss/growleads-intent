// ─── LOCAL DATABASE (SQLite, node:sqlite) ────────────────────────────────────
//
// The whole tool runs on a single local file — no server, no cloud, no external
// DB. Uses Node's built-in SQLite (node:sqlite), so there is ZERO extra
// dependency. The DB file lives inside the project at pipeline/data/growleads.db
// (override with SQLITE_PATH).
//
// This module keeps the exact same API the rest of the code already uses:
//   pool.query(sql, params) -> { rows }        (Postgres-style, async)
//   createModel(table, cols) -> Mongoose-style model
//   initDb()
// so nothing else in the codebase had to change.

process.env.NODE_NO_WARNINGS = '1';           // silence the experimental-sqlite notice
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DB_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'growleads.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = OFF');

// Postgres string functions the queries use, provided as SQLite UDFs so no SQL
// had to be rewritten.
db.function('left', (s, n) => (s == null ? null : String(s).substring(0, Number(n))));
db.function('right', (s, n) => (s == null ? null : String(s).slice(-Number(n))));
db.function('split_part', (s, delim, idx) => {
  if (s == null) return null;
  const parts = String(s).split(delim);
  return parts[Number(idx) - 1] ?? '';
});

// Columns that hold JSON — parsed on read so callers get objects/arrays exactly
// like Postgres jsonb did (pg auto-parsed these; SQLite stores them as TEXT).
const JSON_COLS = new Set(['raw_data', 'signals', 'icp_match', 'engager_urls']);

function coerceParam(v) {
  if (v === undefined) return null;
  if (v === true) return 1;
  if (v === false) return 0;
  if (v instanceof Date) return v.toISOString();
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

function parseRow(row) {
  if (!row) return row;
  for (const k of Object.keys(row)) {
    if (JSON_COLS.has(k) && typeof row[k] === 'string' && row[k]) {
      try { row[k] = JSON.parse(row[k]); } catch (_) { /* leave as text */ }
    }
  }
  return row;
}

// Translate the small set of Postgres-isms the codebase uses into SQLite.
function translate(sql) {
  return sql
    .replace(/\$(\d+)/g, '?')                 // $1,$2 -> ?
    .replace(/\bnow\(\)/gi, 'CURRENT_TIMESTAMP')
    .replace(/::jsonb\b/gi, '')
    .replace(/::text(\[\])?/gi, '')
    .replace(/::uuid(\[\])?/gi, '');
}

// The Postgres-style async query surface the rest of the app expects.
async function query(sql, params = []) {
  const translated = translate(sql);
  const bound = params.map(coerceParam);
  const isRead = /^\s*(select|with)\b/i.test(translated) || /\breturning\b/i.test(translated);
  const stmt = db.prepare(translated);
  if (isRead) {
    const rows = stmt.all(...bound).map(parseRow);
    return { rows, rowCount: rows.length };
  }
  const info = stmt.run(...bound);
  return { rows: [], rowCount: info.changes };
}

// Minimal pool shim (single local connection). Supports the query/end/connect
// surface used across the app.
const pool = {
  query,
  async end() { try { db.close(); } catch (_) {} },
  async connect() {
    return {
      query,
      release() {},
    };
  },
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function camelToSnake(str) {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase();
}

// ─── MODEL FACTORY ────────────────────────────────────────────────────────────
// Identical Mongoose-style API to the previous Postgres shim.

function createModel(table, jsColumns, orderBy = 'created_at DESC') {
  const toSql = {};
  const toJs = {};
  for (const col of jsColumns) {
    const sql = camelToSnake(col);
    toSql[col] = sql;
    toJs[sql] = col;
  }

  function rowToObj(row) {
    if (!row) return null;
    const obj = { _id: row.id };
    for (const [sql, val] of Object.entries(row)) {
      const js = toJs[sql] || sql;
      obj[js] = val;
    }
    return obj;
  }

  function objToRow(data) {
    const row = {};
    for (const [js, sql] of Object.entries(toSql)) {
      if (js in data && data[js] !== undefined) {
        const val = data[js];
        if (val !== null && typeof val === 'object' && !(val instanceof Date)) {
          try {
            row[sql] = JSON.stringify(val, (_, v) =>
              typeof v === 'bigint' ? v.toString() : typeof v === 'function' ? undefined : v
            );
          } catch (_) { row[sql] = null; }
        } else {
          row[sql] = val;
        }
      }
    }
    return row;
  }

  function colFor(js) { return toSql[js] || camelToSnake(js); }

  function buildFilter(filter) {
    const vals = [];
    if (!filter || Object.keys(filter).length === 0) return { clause: '', vals };

    if (filter.$or) {
      const orParts = (filter.$or || [])
        .filter(c => c && Object.entries(c).some(([, v]) => v !== undefined))
        .map(cond =>
          Object.entries(cond)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => { vals.push(v); return `"${colFor(k)}" = $${vals.length}`; })
            .join(' AND ')
        )
        .filter(p => p);
      return orParts.length ? { clause: `WHERE (${orParts.join(' OR ')})`, vals } : { clause: '', vals };
    }

    const conds = Object.entries(filter)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => {
        // { $regex: RegExp } -> case-insensitive LIKE %pattern%
        if (v && typeof v === 'object' && v.$regex) {
          const src = (v.$regex.source || String(v.$regex)).replace(/[%_]/g, '');
          vals.push(`%${src}%`);
          return `"${colFor(k)}" LIKE $${vals.length}`;
        }
        vals.push(v);
        return `"${colFor(k)}" = $${vals.length}`;
      });
    return { clause: conds.length ? `WHERE ${conds.join(' AND ')}` : '', vals };
  }

  function makeQuery(baseSql, queryVals, multi) {
    let sortClause = `ORDER BY ${orderBy}`;
    const q = {
      sort(spec) {
        const parts = Object.entries(spec).map(([js, dir]) =>
          `"${toSql[js] || camelToSnake(js)}" ${dir === -1 ? 'DESC' : 'ASC'}`);
        sortClause = `ORDER BY ${parts.join(', ')}`;
        return q;
      },
      then(resolve, reject) {
        const finalSql = multi ? `${baseSql} ${sortClause}` : baseSql;
        query(finalSql, queryVals)
          .then(res => resolve(multi ? res.rows.map(rowToObj) : (res.rows[0] ? rowToObj(res.rows[0]) : null)))
          .catch(reject);
      },
    };
    return q;
  }

  return {
    async create(data) {
      const row = objToRow(data);
      if (!('id' in row)) row.id = crypto.randomUUID();
      const keys = Object.keys(row);
      if (keys.length === 0) throw new Error(`No insertable fields for ${table}`);
      const cols = keys.map(k => `"${k}"`).join(', ');
      const phs = keys.map((_, i) => `$${i + 1}`).join(', ');
      const res = await query(`INSERT INTO ${table} (${cols}) VALUES (${phs}) RETURNING *`, Object.values(row));
      return rowToObj(res.rows[0]);
    },

    find(filter) {
      const { clause, vals } = buildFilter(filter);
      return makeQuery(`SELECT * FROM ${table} ${clause}`, vals, true);
    },

    findOne(filter) {
      const { clause, vals } = buildFilter(filter);
      return makeQuery(`SELECT * FROM ${table} ${clause} LIMIT 1`, vals, false);
    },

    async findById(id) {
      const res = await query(`SELECT * FROM ${table} WHERE id = $1 LIMIT 1`, [id]);
      return res.rows[0] ? rowToObj(res.rows[0]) : null;
    },

    async findByIdAndUpdate(id, data) {
      const row = objToRow(data);
      const keys = Object.keys(row);
      if (keys.length === 0) return null;
      const sets = keys.map((k, i) => `"${k}" = $${i + 2}`).join(', ');
      const res = await query(`UPDATE ${table} SET ${sets} WHERE id = $1 RETURNING *`, [id, ...Object.values(row)]);
      return res.rows[0] ? rowToObj(res.rows[0]) : null;
    },

    async findByIdAndDelete(id) {
      await query(`DELETE FROM ${table} WHERE id = $1`, [id]);
      return true;
    },

    async findOneAndUpdate(filter, data, opts = {}) {
      if (opts.upsert) {
        const filterRow = filter.$or ? {} : objToRow(filter);
        const dataRow = objToRow(data);
        const fullRow = { ...filterRow, ...dataRow };
        if (!('id' in fullRow)) fullRow.id = crypto.randomUUID();
        const keys = Object.keys(fullRow);
        if (keys.length === 0) return null;
        const conflictKeys = Object.keys(filterRow);
        const cols = keys.map(k => `"${k}"`).join(', ');
        const phs = keys.map((_, i) => `$${i + 1}`).join(', ');
        const updateKeys = Object.keys(dataRow);
        const updateSets = updateKeys.map(k => `"${k}" = excluded."${k}"`).join(', ');
        const conflictClause = conflictKeys.length
          ? `ON CONFLICT (${conflictKeys.map(k => `"${k}"`).join(', ')}) DO ${updateSets ? `UPDATE SET ${updateSets}` : 'NOTHING'}`
          : 'ON CONFLICT DO NOTHING';
        const res = await query(
          `INSERT INTO ${table} (${cols}) VALUES (${phs}) ${conflictClause} RETURNING *`,
          Object.values(fullRow)
        );
        return res.rows[0] ? rowToObj(res.rows[0]) : null;
      }

      const { clause, vals } = buildFilter(filter);
      const row = objToRow(data);
      const keys = Object.keys(row);
      if (keys.length === 0) return null;
      const sets = keys.map((k, i) => `"${k}" = $${vals.length + i + 1}`).join(', ');
      const res = await query(`UPDATE ${table} SET ${sets} ${clause} RETURNING *`, [...vals, ...Object.values(row)]);
      return res.rows[0] ? rowToObj(res.rows[0]) : null;
    },
  };
}

// ─── TABLE INITIALIZATION ─────────────────────────────────────────────────────
// Full schema up front (SQLite has no ADD COLUMN IF NOT EXISTS, so every column
// the app ever added is declared here). id auto-generates; booleans are 0/1;
// timestamps are ISO text; JSON columns are TEXT.

const UUID = "DEFAULT (lower(hex(randomblob(16))))";
const NOW = 'DEFAULT CURRENT_TIMESTAMP';

async function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS seeds (
      id TEXT PRIMARY KEY ${UUID},
      linkedin_url TEXT UNIQUE NOT NULL,
      public_identifier TEXT, first_name TEXT, last_name TEXT, full_name TEXT,
      headline TEXT, summary TEXT, location TEXT, profile_picture TEXT,
      connection_count INTEGER DEFAULT 0, follower_count INTEGER DEFAULT 0,
      current_company TEXT, current_title TEXT, company_description TEXT,
      campaign_id TEXT, added_from TEXT,
      relevance_score INTEGER DEFAULT 0, relevance_tier TEXT DEFAULT 'unscored', relevance_details TEXT,
      enriched INTEGER DEFAULT 0, enriched_at TEXT,
      pipeline_count INTEGER DEFAULT 0, similar_page INTEGER DEFAULT 0,
      activity_scraped INTEGER DEFAULT 0, last_scraped_at TEXT ${NOW},
      raw_data TEXT, created_at TEXT ${NOW},
      is_creator INTEGER DEFAULT 0, is_influencer INTEGER DEFAULT 0,
      avg_likes INTEGER DEFAULT 0, avg_comments INTEGER DEFAULT 0,
      total_posts_scraped INTEGER DEFAULT 0, recent_posts_count INTEGER DEFAULT 0,
      recent_posts_checked_at TEXT, enrichment_progress INTEGER DEFAULT 0,
      enrichment_total INTEGER DEFAULT 0, enrichment_progress_at TEXT
    );

    CREATE TABLE IF NOT EXISTS pipeline_leads (
      id TEXT PRIMARY KEY ${UUID},
      seed_source TEXT NOT NULL, campaign_id TEXT, source TEXT DEFAULT 'similar',
      linkedin_url TEXT UNIQUE NOT NULL, public_identifier TEXT,
      first_name TEXT, last_name TEXT, full_name TEXT, headline TEXT, summary TEXT,
      location TEXT, profile_picture TEXT, connection_count INTEGER DEFAULT 0,
      current_company TEXT, current_title TEXT, company_description TEXT,
      signals TEXT DEFAULT '[]', composite_score REAL DEFAULT 0, intent_tier TEXT DEFAULT 'low',
      icp_match TEXT, personalization_notes TEXT, recommended_angle TEXT,
      engagement_type TEXT DEFAULT '', engagement_context TEXT DEFAULT '',
      intent_source TEXT DEFAULT '', seed_source_name TEXT DEFAULT '',
      last_scraped_at TEXT ${NOW}, raw_data TEXT, created_at TEXT ${NOW},
      company_url TEXT, company_employee_count INTEGER, size_tier TEXT, persona_bracket TEXT,
      hiring_top_priority INTEGER DEFAULT 0, direct_intent INTEGER DEFAULT 0,
      direct_intent_source TEXT, direct_intent_match TEXT, priority TEXT,
      total_experience_years INTEGER, geography_tier TEXT,
      last_posts_scraped_at TEXT, posts_relevant_count INTEGER DEFAULT 0,
      disqualified INTEGER DEFAULT 0, disqualified_reason TEXT, disqualified_at TEXT,
      qualification_status TEXT DEFAULT 'pending', qualified_by TEXT, qualified_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pipeline_leads_disqualified ON pipeline_leads (disqualified);

    CREATE TABLE IF NOT EXISTS posts_scraped (
      id TEXT PRIMARY KEY ${UUID},
      post_urn TEXT UNIQUE NOT NULL, post_link TEXT, post_text TEXT, seed_source TEXT,
      reactions_urn TEXT, comments_urn TEXT, engagers_scraped INTEGER DEFAULT 0,
      scraped_at TEXT ${NOW}, engager_count INTEGER DEFAULT 0,
      reaction_count INTEGER DEFAULT 0, comment_count INTEGER DEFAULT 0,
      engager_urls TEXT DEFAULT '[]', relevance_decision TEXT, relevance_reason TEXT, relevance_judged_at TEXT
    );

    CREATE TABLE IF NOT EXISTS scraped_profiles (
      id TEXT PRIMARY KEY ${UUID},
      linkedin_url TEXT UNIQUE NOT NULL, public_identifier TEXT,
      first_name TEXT, last_name TEXT, full_name TEXT, headline TEXT, summary TEXT,
      location TEXT, profile_picture TEXT, connection_count INTEGER DEFAULT 0,
      follower_count INTEGER DEFAULT 0, current_company TEXT, current_title TEXT,
      company_description TEXT, company_url TEXT, total_experience_years INTEGER,
      is_creator INTEGER DEFAULT 0, is_influencer INTEGER DEFAULT 0,
      raw_data TEXT, scraped_at TEXT ${NOW},
      ai_input TEXT, ai_raw_answer TEXT, ai_decision TEXT, ai_judged_at TEXT
    );
  `);
  console.log(`Local SQLite ready at ${path.relative(process.cwd(), DB_PATH)} (seeds, pipeline_leads, posts_scraped, scraped_profiles)`);
}

module.exports = { pool, initDb, createModel, DB_PATH, db };

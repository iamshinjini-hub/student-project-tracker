import { neon } from '@neondatabase/serverless';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function createNeonDb(databaseUrl) {
  const sql = neon(databaseUrl);
  let initPromise = null;

  function ensureTable() {
    if (!initPromise) {
      initPromise = sql`CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        name VARCHAR(80) NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
        status VARCHAR(20) NOT NULL CHECK(status IN ('Planned', 'In Progress', 'Completed'))
      )`.catch(err => {
        initPromise = null;
        throw err;
      });
    }
    return initPromise;
  }

  return {
    async list() {
      await ensureTable();
      return await sql`SELECT id, name, status FROM projects ORDER BY id DESC`;
    },
    async create({ name, status }) {
      await ensureTable();
      const rows = await sql`INSERT INTO projects (name, status) VALUES (${name}, ${status}) RETURNING id, name, status`;
      return rows[0];
    },
    async update(id, { name, status }) {
      await ensureTable();
      const rows = await sql`UPDATE projects SET name = ${name}, status = ${status} WHERE id = ${id} RETURNING id, name, status`;
      return rows[0] || null;
    },
    async remove(id) {
      await ensureTable();
      const rows = await sql`DELETE FROM projects WHERE id = ${id} RETURNING id`;
      return rows.length > 0;
    }
  };
}

function createSqliteDb() {
  const dbFile = process.env.DB_FILE || 'data/projects.db';
  const dir = dirname(dbFile);
  if (dir && dir !== '.') {
    mkdirSync(dir, { recursive: true });
  }
  const connection = new DatabaseSync(dbFile);
  connection.exec(`CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
    status TEXT NOT NULL CHECK(status IN ('Planned', 'In Progress', 'Completed'))
  )`);
  return {
    async list() {
      return connection.prepare('SELECT id, name, status FROM projects ORDER BY id DESC').all();
    },
    async create({ name, status }) {
      const result = connection.prepare('INSERT INTO projects (name, status) VALUES (?, ?)').run(name, status);
      return connection.prepare('SELECT id, name, status FROM projects WHERE id = ?').get(Number(result.lastInsertRowid));
    },
    async update(id, { name, status }) {
      const result = connection.prepare('UPDATE projects SET name = ?, status = ? WHERE id = ?').run(name, status, id);
      if (!result.changes) return null;
      return connection.prepare('SELECT id, name, status FROM projects WHERE id = ?').get(id);
    },
    async remove(id) {
      return connection.prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0;
    }
  };
}

let backend = null;
function getBackend() {
  if (!backend) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    backend = url ? createNeonDb(url) : createSqliteDb();
  }
  return backend;
}

export const db = {
  async list() {
    return getBackend().list();
  },
  async create(project) {
    return getBackend().create(project);
  },
  async update(id, project) {
    return getBackend().update(id, project);
  },
  async remove(id) {
    return getBackend().remove(id);
  }
};

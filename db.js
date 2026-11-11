import pg from "pg";

let pool = null;
export function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!pool) {
    const local = /localhost|127\.0\.0\.1|@dpg-[^.]+(\/|:)/.test(process.env.DATABASE_URL); // Render internal URL has no TLS
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3, ssl: local ? false : { rejectUnauthorized: false } });
  }
  return pool;
}

// Kept in its own schema so it never touches any other app's tables in a shared database.
export async function migrate() {
  await db().query(`
    CREATE SCHEMA IF NOT EXISTS tree_leads;
    CREATE TABLE IF NOT EXISTS tree_leads.leads (
      id uuid PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      source text NOT NULL,
      source_detail text,
      external_id text UNIQUE,
      test boolean NOT NULL DEFAULT false,
      name text, phone text, email text,
      address text, town text, lat double precision, lon double precision, map_url text,
      job_types text, tree_count text, stump_count text,
      urgent boolean NOT NULL DEFAULT false, hazards text, access text,
      how_soon text, best_day text, best_time text,
      description text, breakdown text,
      ballpark_low integer, ballpark_high integer,
      call_summary text,
      photo_count integer NOT NULL DEFAULT 0,
      photo_key text NOT NULL,
      raw jsonb,
      team_email_id text, customer_email_id text, email_error text,
      status text NOT NULL DEFAULT 'new'
    );
    CREATE TABLE IF NOT EXISTS tree_leads.lead_photos (
      lead_id uuid NOT NULL REFERENCES tree_leads.leads(id) ON DELETE CASCADE,
      idx integer NOT NULL,
      filename text, content_type text NOT NULL, bytes bytea NOT NULL,
      PRIMARY KEY (lead_id, idx)
    );
    CREATE TABLE IF NOT EXISTS tree_leads.rate (ip text, at timestamptz NOT NULL DEFAULT now());
  `);
}

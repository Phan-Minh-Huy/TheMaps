import { readFile } from "node:fs/promises";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "Hãy cấu hình DATABASE_URL trong file .env trước khi tạo database.",
  );
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000,
});

try {
  await client.connect();

  const schema = await readFile(
    new URL("../db/schema.sql", import.meta.url),
    "utf8",
  );

  await client.query(schema);

  console.log("Atlas PostgreSQL/PostGIS schema ready.");
} finally {
  await client.end();
}

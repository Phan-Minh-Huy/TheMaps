import pg from "pg";
import { createClient } from "redis";
import { createRepository } from "./repository.mjs";

export async function nodeAdapters(environment = process.env) {
  let pool = null;
  let redis = null;

  if (environment.DATABASE_URL) {
    pool = new pg.Pool({
      connectionString: environment.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 5000,
      query_timeout: 8000,
    });
  }

  if (environment.REDIS_URL) {
    redis = createClient({
      url: environment.REDIS_URL,
      socket: {
        connectTimeout: 3000,
        reconnectStrategy: false,
      },
    });

    redis.on("error", () => {
      console.warn("Redis unavailable; search will continue without cache.");
    });

    try {
      await redis.connect();
    } catch {
      // Tìm kiếm vẫn hoạt động khi Redis chưa kết nối được.
    }
  }

  return {
    repository: pool
      ? createRepository(async (text, params = []) => {
          const result = await pool.query(text, params);
          return result.rows;
        })
      : null,

    cache: redis
      ? {
          async get(key) {
            const value = await redis.get(key);
            return value === null ? null : JSON.parse(value);
          },

          async set(key, value, seconds) {
            return redis.set(key, JSON.stringify(value), { EX: seconds });
          },

          async ping() {
            return redis.ping();
          },
        }
      : null,

    async close() {
      if (redis?.isOpen) {
        await redis.quit();
      }

      if (pool) {
        await pool.end();
      }
    },
  };
}

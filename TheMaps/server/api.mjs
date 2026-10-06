import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";

const point = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);

const placeSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    address: z.string().trim().max(500).default(""),
    note: z.string().trim().max(1000).default(""),
    coordinates: point,
  })
  .strict();

const uuid = z.string().uuid();

const queryNumber = (min, max) =>
  z.preprocess(
    (value) => (value === null || value === "" ? undefined : Number(value)),
    z.number().finite().min(min).max(max),
  );

const nearbySchema = z.object({
  lon: queryNumber(-180, 180),
  lat: queryNumber(-90, 90),
  radius: queryNumber(100, 50000),
});

function placeFromPhoton(feature) {
  const p = feature.properties || {};

  const name =
    p.name ||
    [p.housenumber, p.street].filter(Boolean).join(" ") ||
    p.city ||
    p.country ||
    "Địa điểm";

  const address = [
    p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street,
    p.district,
    p.city,
    p.state,
    p.country,
  ]
    .filter(
      (value, index, array) =>
        value && value !== name && array.indexOf(value) === index,
    )
    .join(", ");

  const coordinates = point.safeParse(
    feature.geometry?.coordinates?.slice(0, 2),
  );

  if (!coordinates.success) {
    return null;
  }

  return {
    name: String(name).slice(0, 160),
    address: address.slice(0, 500),
    coordinates: coordinates.data,
    zoom: ["city", "town", "village", "state", "country"].includes(p.osm_value)
      ? 12.5
      : 16,
  };
}

async function digest(text) {
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );

  return [...new Uint8Array(buffer)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export function createApi({
  repository = null,
  cache = null,
  resolveUser,
  fetcher = fetch,
  allowedOrigins = [],
  logger = console,
} = {}) {
  const app = new Hono();

  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 16384,
      onError: (c) => c.json({ error: "Nội dung gửi lên quá lớn." }, 413),
    }),
  );

  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");

    if (["POST", "PATCH", "DELETE"].includes(c.req.method)) {
      const origin = c.req.header("origin");
      const ownOrigin = new URL(c.req.url).origin;

      if (origin && origin !== ownOrigin && !allowedOrigins.includes(origin)) {
        return c.json({ error: "Nguồn yêu cầu không được phép." }, 403);
      }

      if (
        c.req.method !== "DELETE" &&
        !c.req.header("content-type")?.startsWith("application/json")
      ) {
        return c.json({ error: "Yêu cầu JSON." }, 415);
      }
    }

    await next();
  });

  app.onError((error, c) => {
    logger.error("Atlas API error:", error.name);

    return c.json({ error: "Dịch vụ chưa sẵn sàng. Hãy thử lại sau." }, 503);
  });

  app.get("/api/health", async (c) => {
    let database = repository ? "unreachable" : "not_configured";

    let redis = cache ? "unreachable" : "not_configured";

    if (repository) {
      try {
        await repository.check();
        database = "ready";
      } catch {}
    }

    if (cache) {
      try {
        await cache.ping();
        redis = "ready";
      } catch {}
    }

    return c.json({
      status: "ok",
      database,
      redis,
    });
  });

  app.get("/api/session", async (c) => {
    const user = await resolveUser?.(c);

    return c.json({
      user: user
        ? {
            name: user.name || "Bạn",
            scope: user.scope || "account",
          }
        : null,
      storage: repository ? "account" : "browser",
      searchCache: cache ? "redis" : "none",
    });
  });

  async function geocode(c, reverse = false) {
    const params = new URLSearchParams({
      limit: reverse ? "1" : "6",
      lang: "en",
    });

    if (reverse) {
      const parsed = point.safeParse([
        Number(c.req.query("lon")),
        Number(c.req.query("lat")),
      ]);

      if (!c.req.query("lon") || !c.req.query("lat") || !parsed.success) {
        return c.json({ error: "Tọa độ không hợp lệ." }, 400);
      }

      params.set("lon", String(parsed.data[0]));
      params.set("lat", String(parsed.data[1]));
    } else {
      const parsed = z
        .string()
        .trim()
        .min(2)
        .max(150)
        .safeParse(c.req.query("q"));

      if (!parsed.success) {
        return c.json({ error: "Từ khóa cần từ 2 đến 150 ký tự." }, 400);
      }

      params.set("q", parsed.data.normalize("NFC"));
    }

    const key =
      "atlas:geocode:v1:" +
      (await digest(
        (reverse ? "reverse:" : "search:") + params.toString().toLowerCase(),
      ));

    let cacheState = cache ? "miss" : "disabled";

    if (cache) {
      try {
        const hit = await cache.get(key);

        if (Array.isArray(hit)) {
          return c.json({
            places: hit,
            cache: "hit",
          });
        }
      } catch {
        cacheState = "unavailable";
      }
    }

    let response;

    try {
      response = await fetcher(
        `https://photon.komoot.io/${reverse ? "reverse" : "api"}/?${params}`,
        {
          signal: AbortSignal.timeout(9000),
          headers: {
            Accept: "application/json",
          },
        },
      );
    } catch {
      return c.json(
        {
          error: "Không thể kết nối dịch vụ tìm kiếm. Hãy thử lại.",
        },
        502,
      );
    }

    if (!response.ok) {
      return c.json(
        {
          error: "Dịch vụ tìm kiếm đang bận. Hãy thử lại.",
        },
        502,
      );
    }

    let data;

    try {
      data = await response.json();
    } catch {
      return c.json(
        {
          error: "Dịch vụ tìm kiếm trả về dữ liệu không hợp lệ.",
        },
        502,
      );
    }

    if (!Array.isArray(data.features)) {
      return c.json({ error: "Dữ liệu địa điểm không hợp lệ." }, 502);
    }

    const places = data.features.map(placeFromPhoton).filter(Boolean);

    if (cache) {
      try {
        await cache.set(key, places, places.length ? 600 : 30);
      } catch {
        cacheState = "unavailable";
      }
    }

    return c.json({
      places,
      cache: cacheState,
    });
  }

  app.get("/api/search", (c) => geocode(c));
  app.get("/api/reverse", (c) => geocode(c, true));

  app.use("/api/places*", async (c, next) => {
    const user = await resolveUser?.(c);

    if (!user?.id) {
      return c.json({ error: "Vui lòng đăng nhập để lưu địa điểm." }, 401);
    }

    if (!repository) {
      return c.json({ error: "Kho lưu địa điểm chưa được kết nối." }, 503);
    }

    c.set("userId", user.id);
    await next();
  });

  app.get("/api/places", async (c) => {
    return c.json({
      places: await repository.list(c.get("userId")),
    });
  });

  app.get("/api/places/nearby", async (c) => {
    const parsed = nearbySchema.safeParse({
      lon: c.req.query("lon") ?? null,
      lat: c.req.query("lat") ?? null,
      radius: c.req.query("radius") ?? null,
    });

    if (!parsed.success) {
      return c.json(
        {
          error: "Tọa độ hoặc bán kính không hợp lệ (100–50.000 m).",
        },
        400,
      );
    }

    const { lon, lat, radius } = parsed.data;

    return c.json({
      places: await repository.nearby(c.get("userId"), lon, lat, radius),
    });
  });

  app.post("/api/places", async (c) => {
    let body;

    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "JSON không hợp lệ." }, 400);
    }

    const parsed = placeSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        {
          error: "Tên, tọa độ hoặc ghi chú không hợp lệ.",
        },
        400,
      );
    }

    return c.json(
      {
        place: await repository.save(c.get("userId"), parsed.data),
      },
      201,
    );
  });

  app.patch("/api/places/:id", async (c) => {
    const id = uuid.safeParse(c.req.param("id"));
    let body;

    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "JSON không hợp lệ." }, 400);
    }

    const parsed = z
      .object({
        note: z.string().trim().max(1000),
      })
      .strict()
      .safeParse(body);

    if (!id.success || !parsed.success) {
      return c.json(
        {
          error: "Ghi chú hoặc mã địa điểm không hợp lệ.",
        },
        400,
      );
    }

    const place = await repository.update(
      c.get("userId"),
      id.data,
      parsed.data.note,
    );

    return place
      ? c.json({ place })
      : c.json({ error: "Không tìm thấy địa điểm." }, 404);
  });

  app.delete("/api/places/:id", async (c) => {
    const id = uuid.safeParse(c.req.param("id"));

    if (!id.success) {
      return c.json({ error: "Mã địa điểm không hợp lệ." }, 400);
    }

    const removed = await repository.remove(c.get("userId"), id.data);

    return removed
      ? c.json({ ok: true })
      : c.json({ error: "Không tìm thấy địa điểm." }, 404);
  });

  app.notFound((c) => c.json({ error: "Không tìm thấy API." }, 404));

  return app;
}

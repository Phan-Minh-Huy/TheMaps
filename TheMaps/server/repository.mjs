const fields =
  "id, name, address, note, longitude, latitude, created_at, updated_at";

function asPlace(row) {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    note: row.note,
    coordinates: [Number(row.longitude), Number(row.latitude)],
    zoom: 16,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.distance_m !== undefined
      ? { distanceMeters: Number(row.distance_m) }
      : {}),
  };
}

export function createRepository(query) {
  return {
    async check() {
      await query(`
        SELECT
          PostGIS_Version(),
          (SELECT count(*) FROM atlas_users) AS users
      `);

      return true;
    },

    async list(userId) {
      const rows = await query(
        `
          SELECT ${fields}
          FROM atlas_places
          WHERE user_id = $1
          ORDER BY updated_at DESC
          LIMIT 500
        `,
        [userId],
      );

      return rows.map(asPlace);
    },

    async save(userId, place) {
      await query(
        `
          INSERT INTO atlas_users(user_id)
          VALUES ($1)
          ON CONFLICT DO NOTHING
        `,
        [userId],
      );

      const rows = await query(
        `
          INSERT INTO atlas_places(
            id,
            user_id,
            name,
            address,
            note,
            longitude,
            latitude
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)

          ON CONFLICT(user_id, longitude, latitude)
          DO UPDATE SET
            name = EXCLUDED.name,
            address = EXCLUDED.address,
            note = EXCLUDED.note,
            updated_at = NOW()

          RETURNING ${fields}
        `,
        [
          crypto.randomUUID(),
          userId,
          place.name,
          place.address,
          place.note,
          ...place.coordinates,
        ],
      );

      return asPlace(rows[0]);
    },

    async update(userId, id, note) {
      const rows = await query(
        `
          UPDATE atlas_places
          SET note = $3, updated_at = NOW()
          WHERE user_id = $1 AND id = $2
          RETURNING ${fields}
        `,
        [userId, id, note],
      );

      return rows.length ? asPlace(rows[0]) : null;
    },

    async remove(userId, id) {
      const rows = await query(
        `
          DELETE FROM atlas_places
          WHERE user_id = $1 AND id = $2
          RETURNING id
        `,
        [userId, id],
      );

      return rows.length > 0;
    },

    async nearby(userId, longitude, latitude, radius) {
      const rows = await query(
        `
          SELECT
            ${fields},
            ST_Distance(
              location,
              ST_SetSRID(
                ST_MakePoint($2, $3),
                4326
              )::GEOGRAPHY
            ) AS distance_m

          FROM atlas_places

          WHERE user_id = $1
            AND ST_DWithin(
              location,
              ST_SetSRID(
                ST_MakePoint($2, $3),
                4326
              )::GEOGRAPHY,
              $4
            )

          ORDER BY distance_m ASC
          LIMIT 100
        `,
        [userId, longitude, latitude, radius],
      );

      return rows.map(asPlace);
    },
  };
}

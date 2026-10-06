CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS atlas_users (
  user_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS atlas_places (
  id UUID PRIMARY KEY,

  user_id TEXT NOT NULL
    REFERENCES atlas_users(user_id)
    ON DELETE CASCADE,

  name TEXT NOT NULL
    CHECK (char_length(name) BETWEEN 1 AND 160),

  address TEXT NOT NULL DEFAULT ''
    CHECK (char_length(address) <= 500),

  note TEXT NOT NULL DEFAULT ''
    CHECK (char_length(note) <= 1000),

  longitude DOUBLE PRECISION NOT NULL
    CHECK (longitude BETWEEN -180 AND 180),

  latitude DOUBLE PRECISION NOT NULL
    CHECK (latitude BETWEEN -90 AND 90),

  location GEOGRAPHY(POINT, 4326)
    GENERATED ALWAYS AS (
      ST_SetSRID(
        ST_MakePoint(longitude, latitude),
        4326
      )::GEOGRAPHY
    ) STORED,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, longitude, latitude)
);

CREATE INDEX IF NOT EXISTS atlas_places_owner_idx
  ON atlas_places(user_id);

CREATE INDEX IF NOT EXISTS atlas_places_location_idx
  ON atlas_places USING GIST(location);
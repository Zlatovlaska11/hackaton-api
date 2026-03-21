ALTER TABLE "Users"
ADD COLUMN "last_known_lat" DOUBLE PRECISION,
ADD COLUMN "last_known_lng" DOUBLE PRECISION,
ADD COLUMN "last_seen_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "pokemon_user_id_key" ON "pokemon"("user_id");

CREATE TABLE "pokemon_stats" (
    "id" SERIAL NOT NULL,
    "pokemon_id" INTEGER NOT NULL,
    "agility" INTEGER NOT NULL DEFAULT 0,
    "intelligence" INTEGER NOT NULL DEFAULT 0,
    "strength" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pokemon_stats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pokemon_stats_pokemon_id_key" ON "pokemon_stats"("pokemon_id");

ALTER TABLE "pokemon_stats"
ADD CONSTRAINT "pokemon_stats_pokemon_id_fkey"
FOREIGN KEY ("pokemon_id") REFERENCES "pokemon"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

INSERT INTO "pokemon_stats" ("pokemon_id")
SELECT "id"
FROM "pokemon"
ON CONFLICT ("pokemon_id") DO NOTHING;

CREATE TABLE "pokemon_friendships" (
    "id" SERIAL NOT NULL,
    "pokemon_a_id" INTEGER NOT NULL,
    "pokemon_b_id" INTEGER NOT NULL,
    "friendship" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pokemon_friendships_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pokemon_friendships_distinct_pokemon_check" CHECK ("pokemon_a_id" <> "pokemon_b_id"),
    CONSTRAINT "pokemon_friendships_pair_order_check" CHECK ("pokemon_a_id" < "pokemon_b_id")
);

CREATE UNIQUE INDEX "pokemon_friendships_pokemon_a_id_pokemon_b_id_key"
ON "pokemon_friendships"("pokemon_a_id", "pokemon_b_id");

CREATE INDEX "pokemon_friendships_pokemon_a_id_idx"
ON "pokemon_friendships"("pokemon_a_id");

CREATE INDEX "pokemon_friendships_pokemon_b_id_idx"
ON "pokemon_friendships"("pokemon_b_id");

ALTER TABLE "pokemon_friendships"
ADD CONSTRAINT "pokemon_friendships_pokemon_a_id_fkey"
FOREIGN KEY ("pokemon_a_id") REFERENCES "pokemon"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "pokemon_friendships"
ADD CONSTRAINT "pokemon_friendships_pokemon_b_id_fkey"
FOREIGN KEY ("pokemon_b_id") REFERENCES "pokemon"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

CREATE TYPE "behavior" AS ENUM ('Tree', 'Water', 'City');

CREATE TABLE "pokemon" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "behavior" "behavior" NOT NULL,

    CONSTRAINT "pokemon_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "routes" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "pokemon_id" INTEGER NOT NULL,
    "ended" BOOLEAN NOT NULL DEFAULT false,
    "in_progress" BOOLEAN NOT NULL DEFAULT false,
    "done_percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "points" (
    "id" SERIAL NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "visited" BOOLEAN NOT NULL DEFAULT false,
    "previous_point_id" INTEGER,
    "next_point_id" INTEGER,
    "route_id" INTEGER NOT NULL,

    CONSTRAINT "points_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pokemon_user_id_idx" ON "pokemon"("user_id");
CREATE INDEX "routes_user_id_in_progress_idx" ON "routes"("user_id", "in_progress");
CREATE INDEX "routes_pokemon_id_idx" ON "routes"("pokemon_id");
CREATE INDEX "points_route_id_idx" ON "points"("route_id");

ALTER TABLE "pokemon"
ADD CONSTRAINT "pokemon_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "Users"("userId")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "routes"
ADD CONSTRAINT "routes_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "Users"("userId")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "routes"
ADD CONSTRAINT "routes_pokemon_id_fkey"
FOREIGN KEY ("pokemon_id") REFERENCES "pokemon"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "points"
ADD CONSTRAINT "points_route_id_fkey"
FOREIGN KEY ("route_id") REFERENCES "routes"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

INSERT INTO "pokemon" ("user_id", "name", "behavior")
SELECT
    "userId",
    COALESCE(NULLIF(TRIM("petName"), ''), CONCAT("username", '''s companion')),
    CASE "petType"
        WHEN 'tree' THEN 'Tree'::"behavior"
        WHEN 'water' THEN 'Water'::"behavior"
        WHEN 'city' THEN 'City'::"behavior"
    END
FROM "Users"
WHERE "petType" IN ('tree', 'water', 'city');

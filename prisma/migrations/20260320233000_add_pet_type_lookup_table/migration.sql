CREATE TABLE "PetType" (
    "code" TEXT NOT NULL,

    CONSTRAINT "PetType_pkey" PRIMARY KEY ("code")
);

INSERT INTO "PetType" ("code")
VALUES ('city'), ('water'), ('tree');

UPDATE "Users"
SET "petType" = LOWER(TRIM("petType"))
WHERE "petType" IS NOT NULL;

UPDATE "Users"
SET "petType" = NULL
WHERE "petType" IS NOT NULL
  AND "petType" NOT IN ('city', 'water', 'tree');

ALTER TABLE "Users"
ADD CONSTRAINT "Users_petType_fkey"
FOREIGN KEY ("petType") REFERENCES "PetType"("code")
ON DELETE SET NULL
ON UPDATE CASCADE;

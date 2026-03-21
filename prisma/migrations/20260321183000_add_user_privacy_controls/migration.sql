ALTER TABLE "Users"
ADD COLUMN "share_location_with_friends" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "share_location_publicly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "allow_external_ai_processing" BOOLEAN NOT NULL DEFAULT false;

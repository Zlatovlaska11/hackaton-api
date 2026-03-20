-- CreateEnum
CREATE TYPE "FriendRequestStatus" AS ENUM ('PENDING', 'ACCEPTED');

-- CreateTable
CREATE TABLE "FriendRequest" (
    "id" SERIAL NOT NULL,
    "requesterId" INTEGER NOT NULL,
    "receiverId" INTEGER NOT NULL,
    "pairUserAId" INTEGER NOT NULL,
    "pairUserBId" INTEGER NOT NULL,
    "status" "FriendRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "FriendRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FriendRequest_distinct_users_check" CHECK ("requesterId" <> "receiverId"),
    CONSTRAINT "FriendRequest_pair_order_check" CHECK ("pairUserAId" < "pairUserBId"),
    CONSTRAINT "FriendRequest_pair_match_check" CHECK (
        "pairUserAId" = LEAST("requesterId", "receiverId")
        AND "pairUserBId" = GREATEST("requesterId", "receiverId")
    ),
    CONSTRAINT "FriendRequest_accept_timestamp_check" CHECK (
        ("status" = 'PENDING' AND "acceptedAt" IS NULL)
        OR ("status" = 'ACCEPTED' AND "acceptedAt" IS NOT NULL)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "FriendRequest_pairUserAId_pairUserBId_key" ON "FriendRequest"("pairUserAId", "pairUserBId");

-- CreateIndex
CREATE INDEX "FriendRequest_requesterId_status_idx" ON "FriendRequest"("requesterId", "status");

-- CreateIndex
CREATE INDEX "FriendRequest_receiverId_status_idx" ON "FriendRequest"("receiverId", "status");

-- AddForeignKey
ALTER TABLE "FriendRequest" ADD CONSTRAINT "FriendRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "Users"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendRequest" ADD CONSTRAINT "FriendRequest_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "Users"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

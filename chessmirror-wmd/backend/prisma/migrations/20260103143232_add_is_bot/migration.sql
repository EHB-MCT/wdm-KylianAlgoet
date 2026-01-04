-- AlterTable
ALTER TABLE "Move" ADD COLUMN     "isBot" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "quality" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Move_gameId_isBot_idx" ON "Move"("gameId", "isBot");

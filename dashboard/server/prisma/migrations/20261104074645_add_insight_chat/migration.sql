-- CreateTable
CREATE TABLE "insight_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brand" TEXT NOT NULL,
    "period_from" TEXT NOT NULL,
    "period_to" TEXT NOT NULL,
    "title" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "insight_messages" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "session_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tokens" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "insight_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "insight_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "insight_sessions_brand_period_from_period_to_updated_at_idx" ON "insight_sessions"("brand", "period_from", "period_to", "updated_at");

-- CreateIndex
CREATE INDEX "insight_messages_session_id_created_at_idx" ON "insight_messages"("session_id", "created_at");

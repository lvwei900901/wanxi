-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_answer_records" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source_id" INTEGER NOT NULL,
    "brand" TEXT NOT NULL DEFAULT 'AsterVision',
    "observed_on" TEXT NOT NULL,
    "platform_id" INTEGER NOT NULL,
    "topic" TEXT NOT NULL,
    "intent_code" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "brand_mentioned" BOOLEAN NOT NULL,
    "brand_recommended" BOOLEAN NOT NULL,
    "sentiment" TEXT NOT NULL,
    "answer_excerpt" TEXT,
    "mentioned_products" TEXT NOT NULL DEFAULT '[]',
    "citations" TEXT NOT NULL DEFAULT '[]',
    "citation_count" INTEGER NOT NULL DEFAULT 0,
    "import_batch_id" INTEGER,
    CONSTRAINT "answer_records_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "platforms" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "answer_records_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_answer_records" ("answer_excerpt", "brand_mentioned", "brand_recommended", "citation_count", "citations", "id", "import_batch_id", "intent_code", "mentioned_products", "observed_on", "platform_id", "question", "sentiment", "source_id", "topic") SELECT "answer_excerpt", "brand_mentioned", "brand_recommended", "citation_count", "citations", "id", "import_batch_id", "intent_code", "mentioned_products", "observed_on", "platform_id", "question", "sentiment", "source_id", "topic" FROM "answer_records";
DROP TABLE "answer_records";
ALTER TABLE "new_answer_records" RENAME TO "answer_records";
CREATE UNIQUE INDEX "answer_records_source_id_key" ON "answer_records"("source_id");
CREATE INDEX "answer_records_brand_observed_on_idx" ON "answer_records"("brand", "observed_on");
CREATE INDEX "answer_records_topic_idx" ON "answer_records"("topic");
CREATE INDEX "answer_records_platform_id_observed_on_idx" ON "answer_records"("platform_id", "observed_on");
CREATE UNIQUE INDEX "answer_records_platform_id_question_observed_on_key" ON "answer_records"("platform_id", "question", "observed_on");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

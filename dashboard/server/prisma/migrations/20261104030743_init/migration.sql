-- CreateTable
CREATE TABLE "platforms" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source_file" TEXT NOT NULL,
    "period_start" TEXT NOT NULL,
    "period_end" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'success',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "answer_records" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source_id" INTEGER NOT NULL,
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

-- CreateIndex
CREATE UNIQUE INDEX "platforms_name_key" ON "platforms"("name");

-- CreateIndex
CREATE UNIQUE INDEX "answer_records_source_id_key" ON "answer_records"("source_id");

-- CreateIndex
CREATE INDEX "answer_records_observed_on_idx" ON "answer_records"("observed_on");

-- CreateIndex
CREATE INDEX "answer_records_topic_idx" ON "answer_records"("topic");

-- CreateIndex
CREATE INDEX "answer_records_platform_id_observed_on_idx" ON "answer_records"("platform_id", "observed_on");

-- CreateIndex
CREATE UNIQUE INDEX "answer_records_platform_id_question_observed_on_key" ON "answer_records"("platform_id", "question", "observed_on");

CREATE TABLE "UploadedAsset" (
  "id" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "data" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UploadedAsset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UploadedAsset_filename_key" ON "UploadedAsset"("filename");
CREATE INDEX "UploadedAsset_createdAt_idx" ON "UploadedAsset"("createdAt");
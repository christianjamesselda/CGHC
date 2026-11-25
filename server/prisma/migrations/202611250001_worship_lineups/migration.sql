CREATE TABLE "WorshipLineup" (
    "id" TEXT NOT NULL,
    "serviceDate" DATE NOT NULL,
    "serviceName" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedById" TEXT NOT NULL,
    CONSTRAINT "WorshipLineup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LineupSong" (
    "id" TEXT NOT NULL,
    "lineupId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    CONSTRAINT "LineupSong_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorshipLineup_serviceDate_serviceName_idx" ON "WorshipLineup"("serviceDate", "serviceName");
CREATE INDEX "WorshipLineup_submittedById_submittedAt_idx" ON "WorshipLineup"("submittedById", "submittedAt");
CREATE INDEX "LineupSong_lineupId_category_position_idx" ON "LineupSong"("lineupId", "category", "position");

ALTER TABLE "WorshipLineup" ADD CONSTRAINT "WorshipLineup_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LineupSong" ADD CONSTRAINT "LineupSong_lineupId_fkey" FOREIGN KEY ("lineupId") REFERENCES "WorshipLineup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

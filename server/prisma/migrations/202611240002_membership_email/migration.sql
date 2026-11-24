ALTER TABLE "EmailVerification" ADD COLUMN "pendingEmail" TEXT;
CREATE TABLE "MembershipApplication" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "age" INTEGER,
  "instrument" TEXT,
  "photoUrl" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MembershipApplication_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MembershipApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MembershipApplication_userId_key" ON "MembershipApplication"("userId");

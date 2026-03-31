CREATE TABLE "Technician" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "techName" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "Technician_username_key" ON "Technician"("username");
CREATE INDEX "Technician_active_techName_idx" ON "Technician"("active", "techName");

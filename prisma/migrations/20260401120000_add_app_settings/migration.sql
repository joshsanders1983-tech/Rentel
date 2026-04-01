-- Create singleton app settings for theme + logo branding.
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "theme" TEXT NOT NULL DEFAULT 'dark',
    "logoMime" TEXT,
    "logoBytes" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AppSettings" ("id", "theme")
VALUES ('default', 'dark')
ON CONFLICT ("id") DO NOTHING;

-- AlterTable: add per-browser and per-IP submission limit fields to Survey
ALTER TABLE "Survey" ADD COLUMN "maxSubmissionsPerBrowser" INTEGER;
ALTER TABLE "Survey" ADD COLUMN "maxSubmissionsPerIp" INTEGER;

-- Add CHECK constraints to prevent <= 0 draft autosaves from bypassing limits silently
ALTER TABLE "Survey" ADD CONSTRAINT "maxSubmissionsPerBrowser_check" CHECK ("maxSubmissionsPerBrowser" > 0);
ALTER TABLE "Survey" ADD CONSTRAINT "maxSubmissionsPerIp_check" CHECK ("maxSubmissionsPerIp" > 0);

-- Performance note: The submission limit checks query responses by (surveyId, contactId),
-- (surveyId, displayId), and (surveyId, meta->ipAddress). Existing indexes on (surveyId)
-- provide partial coverage. For high-volume surveys, consider adding compound indexes
-- on (surveyId, contactId) and (surveyId, displayId) if query latency becomes an issue.

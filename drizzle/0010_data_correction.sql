-- One-off data correction applied to the production database in September
-- 2026 (a make-up debt that had been double-counted for one member). It was
-- data, not schema, and it named a real person, so the body has been removed
-- from the published history. Fresh installs have nothing to correct.
SELECT 1;

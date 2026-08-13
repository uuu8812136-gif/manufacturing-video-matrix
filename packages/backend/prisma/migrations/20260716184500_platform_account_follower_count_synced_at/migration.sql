-- followerCount defaults to 0 for historical rows, so a zero alone cannot tell
-- whether the platform reported a real zero or no follower metric was fetched.
ALTER TABLE `PlatformAccount`
  ADD COLUMN `followerCountSyncedAt` DATETIME(3) NULL;

-- Existing positive values necessarily came from an explicit metric and can be
-- preserved as synchronized. Historical zeros stay unknown until refreshed.
UPDATE `PlatformAccount`
SET `followerCountSyncedAt` = `updatedAt`
WHERE `followerCount` > 0;

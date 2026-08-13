ALTER TABLE `PlatformAccount`
  ADD COLUMN `platformUid` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `PlatformAccount_teamId_platform_platformUid_key`
  ON `PlatformAccount`(`teamId`, `platform`, `platformUid`);

ALTER TABLE `Comment` ADD COLUMN `externalId` VARCHAR(191) NULL;
ALTER TABLE `Message` ADD COLUMN `externalId` VARCHAR(191) NULL;

UPDATE `Comment` SET `externalId` = `id` WHERE `externalId` IS NULL;
UPDATE `Message` SET `externalId` = `id` WHERE `externalId` IS NULL;

ALTER TABLE `Comment` MODIFY `externalId` VARCHAR(191) NOT NULL;
ALTER TABLE `Message` MODIFY `externalId` VARCHAR(191) NOT NULL;

CREATE UNIQUE INDEX `Comment_accountId_externalId_key` ON `Comment`(`accountId`, `externalId`);
CREATE UNIQUE INDEX `Message_accountId_externalId_key` ON `Message`(`accountId`, `externalId`);

ALTER TABLE `DigitalHumanTask`
  ADD COLUMN `provider` VARCHAR(191) NULL,
  ADD COLUMN `providerTaskId` VARCHAR(191) NULL,
  ADD COLUMN `error` LONGTEXT NULL,
  ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

CREATE INDEX `DigitalHumanTask_status_idx` ON `DigitalHumanTask`(`status`);

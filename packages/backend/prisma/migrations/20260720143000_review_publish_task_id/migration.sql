-- Link review flows to their asynchronous publish tasks so "published" is only
-- shown after every platform record has actually completed.
ALTER TABLE `ReviewFlow`
    ADD COLUMN `publishTaskId` VARCHAR(191) NULL;

CREATE INDEX `ReviewFlow_publishTaskId_idx` ON `ReviewFlow`(`publishTaskId`);

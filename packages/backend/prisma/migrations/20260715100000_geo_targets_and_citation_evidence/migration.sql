ALTER TABLE `GeoKeyword`
  ADD COLUMN `targetDomain` VARCHAR(253) NULL,
  ADD COLUMN `targetBrand` VARCHAR(100) NULL;

ALTER TABLE `GeoRankRecord`
  ADD COLUMN `citationEvidence` JSON NULL;

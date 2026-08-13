-- Platform credentials can contain encrypted Cookie/OAuth payloads. AES-256-GCM
-- hex encoding also expands the 79-byte browser-session reference to 216
-- characters, which cannot fit in Prisma's default VARCHAR(191).
ALTER TABLE `PlatformAccount`
  MODIFY `credentials` LONGTEXT NULL;

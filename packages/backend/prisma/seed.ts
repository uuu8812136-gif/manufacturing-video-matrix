import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { resolveSeedEnvironment } from '../src/config/seed-environment';

const seedEnvironment = resolveSeedEnvironment(process.env);
const prisma = new PrismaClient();

/**
 * Bootstrap only: create the minimum identity required to sign in.
 *
 * Business examples, platform accounts, metrics and workflow fixtures belong in
 * an isolated test database and must never be inserted into the application DB.
 */
async function main() {
  console.log('初始化系统管理员...');

  const password = await bcrypt.hash(seedEnvironment.adminPassword, 10);
  const team = await prisma.team.upsert({
    where: { id: 'seed-team-foshan' },
    update: {},
    create: {
      id: 'seed-team-foshan',
      name: '默认企业',
      plan: 'enterprise',
      contactPhone: seedEnvironment.adminPhone,
    },
  });

  const existingAdmin = await prisma.user.findUnique({
    where: { phone: seedEnvironment.adminPhone },
  });
  if (existingAdmin && existingAdmin.teamId !== team.id) {
    throw new Error(`SEED_ADMIN_PHONE=${seedEnvironment.adminPhone} 已属于其他企业，拒绝覆盖`);
  }

  const admin = await prisma.user.upsert({
    where: { phone: seedEnvironment.adminPhone },
    update: {
      role: 'super_admin',
      status: 'active',
    },
    create: {
      phone: seedEnvironment.adminPhone,
      password,
      name: '系统管理员',
      role: 'super_admin',
      teamId: team.id,
    },
  });

  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId: team.id, userId: admin.id } },
    update: { role: 'super_admin' },
    create: { teamId: team.id, userId: admin.id, role: 'super_admin' },
  });

  console.log('系统管理员初始化完成；未写入任何演示业务数据。');
  console.log(`管理员账号: ${seedEnvironment.adminPhone}（密码从 SEED_ADMIN_PASSWORD 读取）`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

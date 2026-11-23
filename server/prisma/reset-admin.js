import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
try {
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
    throw new Error('Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters in server/.env.');
  }
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  await prisma.user.update({ where: { email: ADMIN_EMAIL }, data: { passwordHash } });
  console.log(`Admin password reset for ${ADMIN_EMAIL}.`);
} finally {
  await prisma.$disconnect();
}

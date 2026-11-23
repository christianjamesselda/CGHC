import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
try {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 12 || /^(replace|change|your|example)/i.test(password)) throw new Error('Set ADMIN_EMAIL and a unique ADMIN_PASSWORD of at least 12 characters in server/.env before seeding.');
  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { name: process.env.ADMIN_NAME || 'Church Administrator', email, passwordHash: await bcrypt.hash(password, 12), role: 'ADMIN', emailVerifiedAt: new Date() }
  });
  await prisma.churchConfig.upsert({ where: { id: 'main' }, update: { name: process.env.CHURCH_NAME || 'Cornerstone Global Harvest Church' }, create: { id: 'main', name: process.env.CHURCH_NAME || 'Cornerstone Global Harvest Church' } });
  const todayManila = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const firstSunday = new Date(`${todayManila}T00:00:00Z`);
  firstSunday.setUTCDate(firstSunday.getUTCDate() + ((7 - firstSunday.getUTCDay()) % 7 || 7));
  for (let week = 0; week < 4; week++) {
    const day = new Date(firstSunday); day.setUTCDate(day.getUTCDate() + week * 7);
    const dateOnly = day.toISOString().slice(0, 10);
    for (const [name, startHour, endHour] of [['1st Service', 8, 10], ['2nd Service', 10, 12]]) {
      const startsAt = new Date(`${dateOnly}T${String(startHour).padStart(2, '0')}:00:00+08:00`);
      const endsAt = new Date(`${dateOnly}T${String(endHour).padStart(2, '0')}:00:00+08:00`);
      const title = `${name} — Cornerstone Global Harvest Church`;
      const existing = await prisma.schedule.findFirst({ where: { title, startsAt } });
      if (!existing) {
        await prisma.schedule.create({ data: { title, type: 'WORSHIP', startsAt, endsAt, location: 'Main sanctuary', services: { create: { name, startsAt, endsAt } } } });
      }
    }
  }
  console.log(`Seed complete. Admin: ${admin.email}`);
} finally { await prisma.$disconnect(); }

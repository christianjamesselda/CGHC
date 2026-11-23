import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import multer from 'multer';
import { z } from 'zod';
import { randomInt, randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const prisma = new PrismaClient();
const app = express();
const port = Number(process.env.PORT || 4000);
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientDistDir = path.resolve(serverDir, '..', 'client', 'dist');
const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32 || /^(replace|change|your|example)/i.test(jwtSecret)) throw new Error('Set JWT_SECRET to a unique random value of at least 32 characters in server/.env.');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: clientUrl, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(path.join(serverDir, 'uploads')));
fs.mkdirSync(path.join(serverDir, 'uploads'), { recursive: true });

const hash = (value) => createHash('sha256').update(value).digest('hex');
const tokenFor = (user) => jwt.sign({ sub: user.id, role: user.role }, jwtSecret, { expiresIn: '12h' });
const cleanUser = ({ id, name, email, role, emailVerifiedAt, createdAt }) => ({ id, name, email, role, emailVerifiedAt, createdAt });
function auth(req, res, next) {
  const value = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!value) return res.status(401).json({ error: 'Please sign in to continue.' });
  try { req.user = jwt.verify(value, jwtSecret); next(); }
  catch { return res.status(401).json({ error: 'Your session expired. Please sign in again.' }); }
}
const allow = (...roles) => (req, res, next) => req.user && roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'You do not have permission to do that.' });
const staff = allow('ADMIN', 'LEADER');
async function audit(req, action, module, recordId, beforeJson, afterJson) {
  await prisma.auditLog.create({ data: { userId: req.user?.sub, action, module, recordId, ...(beforeJson != null ? { beforeJson } : {}), ...(afterJson != null ? { afterJson } : {}) } });
}
async function notifyMinistryMembers(ministryId, notification) {
  if (!ministryId) return;
  const members = await prisma.member.findMany({ where: { ministryId, userId: { not: null } }, select: { userId: true } });
  if (!members.length) return;
  await prisma.notification.createMany({
    data: members.filter(member => member.userId).map(({ userId }) => ({ ...notification, userId, sourceKey: notification.sourceKey ? `${notification.sourceKey}:${userId}` : null })),
    skipDuplicates: true,
  });
}
function manilaDayBounds(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const start = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)) - 8 * 60 * 60 * 1000);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000), key: `${values.year}-${values.month}-${values.day}` };
}
const smtpUser = process.env.SMTP_USER || 'christianjames.selda@gmail.com';
const smtpPassword = process.env.SMTP_PASS?.replace(/\s/g, '');
const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
const smtpPort = Number(process.env.SMTP_PORT || 465);
const resendApiKey = process.env.RESEND_API_KEY;
const emailFrom = process.env.EMAIL_FROM || process.env.SMTP_FROM || `Cornerstone Global Harvest Church <${smtpUser}>`;
const smtpSecure = process.env.SMTP_SECURE
  ? process.env.SMTP_SECURE.toLowerCase() === 'true'
  : smtpPort === 465;
const mailer = smtpPassword ? nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpSecure,
  auth: { user: smtpUser, pass: smtpPassword },
  connectionTimeout: 8000,
  greetingTimeout: 8000,
  socketTimeout: 8000,
}) : null;
if (resendApiKey) {
  console.log('HTTPS email delivery is configured.');
} else if (mailer) {
  mailer.verify().then(() => console.log(`SMTP email sender ready (${smtpHost}:${smtpPort}, ${smtpUser}).`)).catch((error) => console.error('SMTP connection failed:', error.code || error.message));
} else {
  console.warn('Email sending is not configured. Set RESEND_API_KEY and EMAIL_FROM, or configure SMTP.');
}
class EmailDeliveryError extends Error {}
async function sendCode(email, code, purpose) {
  const subject = purpose === 'RESET_PASSWORD' ? 'Your password reset code' : 'Verify your Cornerstone church account';
  const title = purpose === 'RESET_PASSWORD' ? 'Reset your password' : 'Verify your email address';
  const text = `${title}\n\nYour 6-digit code is ${code}. It expires in 10 minutes. If you did not request this, you can ignore this email.`;
  const html = `<div style="font-family:Arial,sans-serif;color:#24332b;line-height:1.6"><h2>${title}</h2><p>Enter this code in the Cornerstone church website:</p><p style="font-size:28px;font-weight:700;letter-spacing:8px;color:#17614b">${code}</p><p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p></div>`;
  if (resendApiKey) {
    let response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: emailFrom, to: [email], subject, text, html }),
        signal: AbortSignal.timeout(8000),
      });
    } catch (error) {
      console.error('HTTPS email delivery failed:', error.name || error.message);
      throw new EmailDeliveryError('Email delivery timed out. Please try again shortly.');
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('HTTPS email provider rejected the message:', response.status, detail);
      throw new EmailDeliveryError('Email provider could not send the code. Check the sender address in Render settings.');
    }
    return;
  }
  if (!mailer) throw new EmailDeliveryError('Email verification is not configured. Add an email provider in the Render settings.');
  try {
    await mailer.sendMail({ from: emailFrom, to: email, subject, text, html });
  } catch (error) {
    console.error('SMTP email delivery failed:', error.code || error.message);
    throw new EmailDeliveryError(process.env.RENDER
      ? 'SMTP failed. Render Free blocks Gmail SMTP. Upgrade this service to a paid instance or configure an HTTPS email provider.'
      : 'Email delivery failed. Please try again shortly.');
  }
}
const codeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many code requests. Please try again later.' } });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many sign-in attempts. Please try again later.' } });
const authSchema = z.object({ name: z.string().trim().min(2).max(100).optional(), email: z.string().trim().email().max(255).transform((v) => v.toLowerCase()), password: z.string().min(8).max(100) });

app.get('/api/health', (_req, res) => res.json({ ok: true, church: process.env.CHURCH_NAME || 'Cornerstone Global Harvest Church' }));
app.post('/api/auth/register', codeLimiter, async (req, res, next) => {
  try {
    const data = authSchema.extend({ name: z.string().trim().min(2).max(100) }).parse(req.body);
    if (!resendApiKey && !mailer) return res.status(503).json({ error: 'Email verification is not configured. Ask the site administrator to add an email provider.' });
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing?.emailVerifiedAt) return res.status(409).json({ error: 'That email is already registered. Please sign in.' });
    const { password, ...profile } = data;
    const passwordHash = await bcrypt.hash(password, 12);
    const user = existing
      ? await prisma.user.update({ where: { id: existing.id }, data: { ...profile, passwordHash } })
      : await prisma.user.create({ data: { ...profile, passwordHash } });
    const code = String(randomInt(100000, 1000000));
    const verification = await prisma.emailVerification.create({ data: { userId: user.id, codeHash: hash(code), expiresAt: new Date(Date.now() + 10 * 60 * 1000) } });
    try {
      await sendCode(user.email, code, 'VERIFY_EMAIL');
    } catch (error) {
      await prisma.emailVerification.delete({ where: { id: verification.id } }).catch(() => {});
      if (!existing) await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
      throw error;
    }
    res.status(existing ? 200 : 201).json({ message: 'A verification code has been sent to your email.' });
  } catch (e) { next(e); }
});
app.post('/api/auth/verify', codeLimiter, async (req, res, next) => {
  try {
    const data = z.object({ email: z.string().email().transform(v => v.toLowerCase()), code: z.string().regex(/^\d{6}$/) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    const entry = user && await prisma.emailVerification.findFirst({ where: { userId: user.id, purpose: 'VERIFY_EMAIL', consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    if (!entry || entry.codeHash !== hash(data.code)) return res.status(400).json({ error: 'That code is invalid or expired.' });
    await prisma.$transaction([prisma.emailVerification.update({ where: { id: entry.id }, data: { consumedAt: new Date() } }), prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } })]);
    res.json({ message: 'Email verified. You can sign in now.' });
  } catch (e) { next(e); }
});
app.post('/api/auth/resend', codeLimiter, async (req, res, next) => {
  try {
    const email = z.string().email().parse(req.body.email).toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.emailVerifiedAt) return res.json({ message: 'If the account needs verification, a new code has been sent.' });
    if (!resendApiKey && !mailer) return res.status(503).json({ error: 'Email verification is not configured. Ask the site administrator to add an email provider.' });
    const code = String(randomInt(100000, 1000000));
    await prisma.emailVerification.create({ data: { userId: user.id, codeHash: hash(code), expiresAt: new Date(Date.now() + 10 * 60 * 1000) } });
    await sendCode(email, code, 'VERIFY_EMAIL');
    res.json({ message: 'A new verification code has been sent to your email.' });
  } catch (e) { next(e); }
});
app.post('/api/auth/login', loginLimiter, async (req, res, next) => {
  try {
    const data = authSchema.pick({ email: true, password: true }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user || !await bcrypt.compare(data.password, user.passwordHash)) return res.status(401).json({ error: 'Email or password is incorrect.' });
    if (!user.emailVerifiedAt) return res.status(403).json({ error: 'Please verify your email before signing in.' });
    res.json({ token: tokenFor(user), user: cleanUser(user) });
  } catch (e) { next(e); }
});
app.post('/api/auth/forgot', codeLimiter, async (req, res, next) => {
  try {
    const email = z.string().email().parse(req.body.email).toLowerCase();
    if (!resendApiKey && !mailer) return res.status(503).json({ error: 'Email delivery is not configured. Ask the site administrator to add an email provider.' });
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) { const code = String(randomInt(100000, 1000000)); await prisma.emailVerification.create({ data: { userId: user.id, purpose: 'RESET_PASSWORD', codeHash: hash(code), expiresAt: new Date(Date.now() + 10 * 60 * 1000) } }); await sendCode(email, code, 'RESET_PASSWORD'); }
    res.json({ message: 'If that account exists, a password reset code has been sent.' });
  } catch (e) { next(e); }
});
app.post('/api/auth/reset', codeLimiter, async (req, res, next) => {
  try {
    const data = z.object({ email: z.string().email().transform(v => v.toLowerCase()), code: z.string().regex(/^\d{6}$/), password: z.string().min(8).max(100) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    const entry = user && await prisma.emailVerification.findFirst({ where: { userId: user.id, purpose: 'RESET_PASSWORD', consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    if (!entry || entry.codeHash !== hash(data.code)) return res.status(400).json({ error: 'That code is invalid or expired.' });
    await prisma.$transaction([prisma.emailVerification.update({ where: { id: entry.id }, data: { consumedAt: new Date() } }), prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(data.password, 12) } })]);
    res.json({ message: 'Password updated. Please sign in.' });
  } catch (e) { next(e); }
});
app.get('/api/auth/me', auth, async (req, res, next) => { try { const user = await prisma.user.findUnique({ where: { id: req.user.sub }, include: { member: true } }); res.json({ user: cleanUser(user), member: user?.member }); } catch (e) { next(e); } });
app.patch('/api/auth/profile', auth, async (req, res, next) => {
  try {
    const data = z.object({ name: z.string().trim().min(2).max(100), currentPassword: z.string().optional(), password: z.string().min(8).max(100).optional(), confirmPassword: z.string().optional() }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (data.password && data.password !== data.confirmPassword) return res.status(400).json({ error: 'The new passwords do not match.' });
    if (data.password && !await bcrypt.compare(data.currentPassword || '', user.passwordHash)) return res.status(400).json({ error: 'Current password is incorrect.' });
    const nameChanged = data.name !== user.name;
    const passwordChanged = Boolean(data.password);
    const updated = await prisma.user.update({ where: { id: user.id }, data: { name: data.name, ...(passwordChanged ? { passwordHash: await bcrypt.hash(data.password, 12) } : {}) } });
    await audit(req, 'UPDATE', 'users', user.id, { name: user.name }, { name: updated.name });
    if (nameChanged || passwordChanged) {
      try { await prisma.notification.create({ data: { userId: user.id, title: 'Profile updated', message: passwordChanged ? 'Your profile or password was changed.' : 'Your name was updated.', kind: 'PROFILE', link: '/settings' } }); }
      catch (notificationError) { console.error('Could not create profile notification:', notificationError.message); }
    }
    res.json({ user: cleanUser(updated) });
  } catch (e) { next(e); }
});

// Multipart files are restricted by size and MIME; generated names prevent path traversal.
const upload = multer({ storage: multer.diskStorage({ destination: (_req, _file, cb) => cb(null, path.join(serverDir, 'uploads')), filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`) }), limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 10) * 1024 * 1024 }, fileFilter: (_req, file, cb) => cb(null, /^(image\/(jpeg|png|webp|gif)|application\/pdf|text\/plain)$/.test(file.mimetype)) });
app.post('/api/uploads', auth, staff, upload.single('file'), (req, res) => req.file ? res.status(201).json({ url: `/uploads/${req.file.filename}`, fileName: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size }) : res.status(400).json({ error: 'Choose a PNG, JPG, WebP, GIF, PDF, or text file under the size limit.' }));

const routes = {
  members: { model: 'member', roles: ['ADMIN', 'LEADER'], include: { ministry: true }, fields: ['firstName', 'lastName', 'age', 'photoUrl', 'instrument', 'ministryId', 'userId'] },
  ministries: { model: 'ministry', roles: ['ADMIN'], fields: ['name'] },
  songs: { model: 'song', roles: ['ADMIN', 'LEADER'], include: { musicians: { include: { member: true } }, files: true }, fields: ['title', 'artist', 'originalKey', 'teamKey', 'bpm', 'worshipLeader', 'youtubeUrl', 'chordText', 'notes'] },
  schedules: { model: 'schedule', roles: ['ADMIN', 'LEADER'], include: { services: { include: { assignments: { include: { member: true } } } }, training: true }, fields: ['title', 'type', 'startsAt', 'endsAt', 'location', 'details'] },
  presentations: { model: 'presentation', roles: ['ADMIN', 'LEADER'], include: { slides: { orderBy: { position: 'asc' } } }, fields: ['title'] },
  links: { model: 'linkResource', roles: ['ADMIN', 'LEADER'], fields: ['title', 'url'] },
  trainings: { model: 'training', roles: ['ADMIN', 'LEADER'], include: { schedule: true, ministry: true, attendance: { include: { member: true } } }, fields: ['scheduleId', 'ministryId', 'description'] },
  attendance: { model: 'attendance', roles: ['ADMIN', 'LEADER'], include: { member: true, training: { include: { schedule: true } } }, fields: ['trainingId', 'memberId', 'status', 'notes'] },
};
app.use('/api', auth);
app.get('/api/notifications', async (req, res, next) => {
  try {
    const account = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { member: { select: { id: true, ministryId: true } } } });
    const member = account?.member;
    if (member) {
      const { start, end, key } = manilaDayBounds();
      const [services, trainings] = await Promise.all([
        prisma.service.findMany({ where: { startsAt: { gte: start, lt: end }, assignments: { some: { memberId: member.id } } }, include: { schedule: true } }),
        member.ministryId ? prisma.training.findMany({ where: { ministryId: member.ministryId, schedule: { startsAt: { gte: start, lt: end } } }, include: { schedule: true } }) : [],
      ]);
      const reminders = [
        ...services.map(({ id, name, startsAt, schedule }) => ({ userId: req.user.sub, title: 'You are serving today', message: `${schedule.title} · ${name} at ${new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }).format(startsAt)}`, kind: 'SERVICE', link: '/planning', sourceKey: `service-day:${id}:${key}` })),
        ...trainings.map(({ id, schedule }) => ({ userId: req.user.sub, title: 'Training today', message: `${schedule.title} starts at ${new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }).format(schedule.startsAt)}.`, kind: 'TRAINING', link: '/trainings', sourceKey: `training-day:${id}:${key}` })),
      ];
      if (reminders.length) await prisma.notification.createMany({ data: reminders, skipDuplicates: true });
    }
    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({ where: { userId: req.user.sub }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.notification.count({ where: { userId: req.user.sub, readAt: null } }),
    ]);
    res.json({ notifications, unreadCount });
  } catch (e) { next(e); }
});
app.patch('/api/notifications/read-all', async (req, res, next) => {
  try {
    await prisma.notification.updateMany({ where: { userId: req.user.sub, readAt: null }, data: { readAt: new Date() } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});
app.patch('/api/notifications/:id/read', async (req, res, next) => {
  try {
    const notification = await prisma.notification.findFirst({ where: { id: req.params.id, userId: req.user.sub } });
    if (!notification) return res.status(404).json({ error: 'Notification not found.' });
    if (!notification.readAt) await prisma.notification.update({ where: { id: notification.id }, data: { readAt: new Date() } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});
for (const [slug, config] of Object.entries(routes)) {
  const delegate = prisma[config.model];
  app.get(`/api/${slug}`, async (req, res, next) => { try { const orderField = slug === 'attendance' ? 'markedAt' : slug === 'links' ? 'addedAt' : 'createdAt'; const rows = await delegate.findMany({ ...(config.include ? { include: config.include } : {}), orderBy: { [orderField]: 'desc' }, take: slug === 'members' || slug === 'songs' ? 500 : 1000 }); res.json(rows); } catch (e) { next(e); } });
  app.get(`/api/${slug}/:id`, async (req, res, next) => { try { const row=await delegate.findUnique({where:{id:req.params.id},...(config.include?{include:config.include}:{})}); if(!row)return res.status(404).json({error:'Record not found.'});res.json(row); } catch(e){next(e);} });
  app.post(`/api/${slug}`, allow(...config.roles), async (req, res, next) => { try {
    let data = Object.fromEntries(Object.entries(req.body).filter(([key]) => config.fields.includes(key)));
    if (slug === 'members') data = z.object({ firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().min(1).max(80), age: z.coerce.number().int().min(1).max(120).optional(), photoUrl: z.string().max(500).optional(), instrument: z.string().max(80).optional(), ministryId: z.string().nullable().optional(), userId: z.string().nullable().optional() }).parse(data);
    if (slug === 'schedules') {
      data = z.object({ title: z.string().trim().min(1).max(180), type: z.enum(['WORSHIP', 'TRAINING', 'EVENT']), startsAt: z.coerce.date(), endsAt: z.coerce.date().nullable().optional(), location: z.string().max(180).nullable().optional(), details: z.string().max(4000).nullable().optional() }).parse(data);
      const services = data.type === 'WORSHIP' ? [{ name: '1st Service', startsAt: data.startsAt, endsAt: data.endsAt }, { name: '2nd Service', startsAt: new Date(data.startsAt.getTime() + 2 * 60 * 60 * 1000), endsAt: data.endsAt ? new Date(data.endsAt.getTime() + 2 * 60 * 60 * 1000) : null }] : undefined;
      data = { ...data, ...(services ? { services: { create: services } } : {}) };
    }
    if (slug === 'trainings') {
      const training = z.object({ title: z.string().trim().min(1).max(180), startsAt: z.coerce.date(), endsAt: z.coerce.date().nullable().optional(), location: z.string().max(180).nullable().optional(), description: z.string().max(4000).nullable().optional(), ministryId: z.preprocess(value => value === '' ? null : value, z.string().nullable().optional()) }).parse(req.body);
      const created = await prisma.schedule.create({ data: { title: training.title, type: 'TRAINING', startsAt: training.startsAt, endsAt: training.endsAt, location: training.location, details: training.description, training: { create: { description: training.description, ministryId: training.ministryId } } }, include: { training: { include: { schedule: true, ministry: true, attendance: { include: { member: true } } } } } });
      try {
        await notifyMinistryMembers(training.ministryId, { title: 'New ministry training', message: `${training.title} is scheduled for ${new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }).format(training.startsAt)}.`, kind: 'TRAINING', link: '/trainings', sourceKey: `training-created:${created.training.id}` });
      } catch (notificationError) { console.error('Could not create training notifications:', notificationError.message); }
      await audit(req, 'CREATE', slug, created.training.id, null, created); return res.status(201).json(created.training);
    }
    if (!Object.keys(data).length) return res.status(400).json({ error: 'Provide at least one valid field.' });
    const created = await delegate.create({ data, ...(config.include ? { include: config.include } : {}) }); await audit(req, 'CREATE', slug, created.id, null, created); res.status(201).json(created);
  } catch (e) { next(e); } });
  app.patch(`/api/${slug}/:id`, allow(...config.roles), async (req, res, next) => { try { const data = Object.fromEntries(Object.entries(req.body).filter(([key]) => config.fields.includes(key))); const before = await delegate.findUnique({ where: { id: req.params.id } }); if (!before) return res.status(404).json({ error: 'Record not found.' }); const updated = await delegate.update({ where: { id: req.params.id }, data, ...(config.include ? { include: config.include } : {}) }); await audit(req, 'UPDATE', slug, updated.id, before, updated); if (slug === 'trainings' && (data.scheduleId || data.ministryId || data.description)) { try { const training = await prisma.training.findUnique({ where: { id: updated.id }, include: { schedule: true } }); if (training) await notifyMinistryMembers(training.ministryId, { title: 'Training updated', message: `${training.schedule.title} has updated training details for ${new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }).format(training.schedule.startsAt)}.`, kind: 'TRAINING', link: '/trainings', sourceKey: `training-updated:${training.id}:${Date.now()}` }); } catch (notificationError) { console.error('Could not create training update notifications:', notificationError.message); } } res.json(updated); } catch (e) { next(e); } });
  app.delete(`/api/${slug}/:id`, allow(...config.roles), async (req, res, next) => { try { const before = await delegate.findUnique({ where: { id: req.params.id } }); if (!before) return res.status(404).json({ error: 'Record not found.' }); await delegate.delete({ where: { id: req.params.id } }); await audit(req, 'DELETE', slug, req.params.id, before, null); res.json({ ok: true }); } catch (e) { next(e); } });
}

app.get('/api/presentations/:id', auth, async (req, res, next) => { try { const item = await prisma.presentation.findUnique({ where: { id: req.params.id }, include: { slides: { orderBy: { position: 'asc' } } } }); if (!item) return res.status(404).json({ error: 'Presentation not found.' }); res.json(item); } catch (e) { next(e); } });
app.post('/api/presentations/:id/slides', auth, staff, async (req, res, next) => { try { const parent = await prisma.presentation.findUnique({ where: { id: req.params.id } }); if (!parent) return res.status(404).json({ error: 'Presentation not found.' }); const slides = z.object({ slides: z.array(z.object({ type: z.enum(['LYRICS','SCRIPTURE','ANNOUNCEMENT','TEXT']).optional(), text: z.string().max(12000).optional(), background: z.string().max(100).optional(), backgroundUrl: z.string().max(500).optional(), fontFamily: z.string().max(100).optional(), fontSize: z.number().int().min(12).max(100).optional(), textColor: z.string().max(30).optional(), alignment: z.enum(['left','center','right']).optional() })).min(1).max(100) }).parse(req.body).slides; const max = await prisma.slide.aggregate({ where: { presentationId: parent.id }, _max: { position: true } }); const created = await prisma.$transaction(slides.map((slide,i)=>prisma.slide.create({data:{...slide,presentationId:parent.id,position:(max._max.position??-1)+i+1}}))); await audit(req,'CREATE','presentations',parent.id,null,{slides:created}); res.status(201).json(created); } catch(e){next(e);} });
app.patch('/api/presentations/:id/slides/:slideId', auth, staff, async (req, res, next) => { try { const data=z.object({ type:z.enum(['LYRICS','SCRIPTURE','ANNOUNCEMENT','TEXT']).optional(),text:z.string().max(12000).optional(),background:z.string().max(100).optional(),backgroundUrl:z.string().max(500).optional(),fontFamily:z.string().max(100).optional(),fontSize:z.number().int().min(12).max(100).optional(),textColor:z.string().max(30).optional(),alignment:z.enum(['left','center','right']).optional(),position:z.number().int().nonnegative().optional() }).parse(req.body); const before=await prisma.slide.findFirst({where:{id:req.params.slideId,presentationId:req.params.id}}); if(!before)return res.status(404).json({error:'Slide not found.'}); const slide=await prisma.slide.update({where:{id:before.id},data}); await audit(req,'UPDATE','presentations',before.id,before,slide); res.json(slide); }catch(e){next(e);} });
app.delete('/api/presentations/:id/slides/:slideId', auth, staff, async (req,res,next)=>{try{const before=await prisma.slide.findFirst({where:{id:req.params.slideId,presentationId:req.params.id}});if(!before)return res.status(404).json({error:'Slide not found.'});await prisma.slide.delete({where:{id:before.id}});await audit(req,'DELETE','presentations',before.id,before,null);res.json({ok:true});}catch(e){next(e);}});
app.post('/api/chord-files', auth, staff, async (req,res,next)=>{try{const data=z.object({songId:z.string(),fileName:z.string().max(255),filePath:z.string().startsWith('/uploads/'),mimeType:z.string().max(120),size:z.number().int().positive()}).parse(req.body);const file=await prisma.chordFile.create({data});await audit(req,'CREATE','songs',file.songId,null,file);res.status(201).json(file);}catch(e){next(e);}});
app.post('/api/services/:serviceId/assignments', auth, staff, async (req,res,next)=>{try{const data=z.object({memberId:z.string(),role:z.string().trim().min(1).max(80),slot:z.number().int().positive().default(1)}).parse(req.body);const item=await prisma.serviceAssignment.create({data:{...data,serviceId:req.params.serviceId},include:{member:true,service:{include:{schedule:true}}}});const {service,member}=item;if(member.userId){try{await prisma.notification.create({data:{userId:member.userId,title:'New service assignment',message:`You are assigned as ${item.role} for ${service.schedule.title} · ${service.name} on ${new Intl.DateTimeFormat('en',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'Asia/Manila'}).format(service.startsAt)}.`,kind:'SERVICE',link:'/planning',sourceKey:`service-assignment:${item.id}`}});}catch(notificationError){console.error('Could not create service assignment notification:',notificationError.message);}}await audit(req,'CREATE','schedules',item.id,null,item);res.status(201).json(item);}catch(e){next(e);}});
app.delete('/api/assignments/:id', auth, staff, async (req,res,next)=>{try{const before=await prisma.serviceAssignment.findUnique({where:{id:req.params.id},include:{member:true,service:{include:{schedule:true}}}});if(!before)return res.status(404).json({error:'Assignment not found.'});await prisma.serviceAssignment.delete({where:{id:before.id}});if(before.member.userId){try{await prisma.notification.create({data:{userId:before.member.userId,title:'Service assignment updated',message:`Your ${before.role} assignment for ${before.service.schedule.title} · ${before.service.name} was removed.`,kind:'SERVICE',link:'/planning',sourceKey:`service-assignment-removed:${before.id}`}});}catch(notificationError){console.error('Could not create assignment removal notification:',notificationError.message);}}await audit(req,'DELETE','schedules',before.id,before,null);res.json({ok:true});}catch(e){next(e);}});

app.get('/api/users', auth, allow('ADMIN'), async (_req, res, next) => { try { res.json(await prisma.user.findMany({ where: { emailVerifiedAt: { not: null } }, select: { id: true, name: true, email: true, role: true, emailVerifiedAt: true, createdAt: true }, orderBy: { createdAt: 'desc' } })); } catch (e) { next(e); } });
app.patch('/api/users/:id', auth, allow('ADMIN'), async (req, res, next) => {
  try {
    const data = z.object({ role: z.enum(['ADMIN', 'LEADER', 'MEMBER']) }).parse(req.body);
    const before = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: 'User not found.' });
    const updated = await prisma.user.update({ where: { id: req.params.id }, data });
    await audit(req, 'UPDATE', 'users', updated.id, { role: before.role }, { role: updated.role });
    if (before.role !== updated.role) {
      try { await prisma.notification.create({ data: { userId: updated.id, title: 'Account access updated', message: `Your church workspace role is now ${updated.role.toLowerCase()}.`, kind: 'PROFILE', link: '/settings' } }); }
      catch (notificationError) { console.error('Could not create role notification:', notificationError.message); }
    }
    res.json(cleanUser(updated));
  } catch (e) { next(e); }
});
app.get('/api/audit', auth, allow('ADMIN', 'LEADER'), async (req, res, next) => { try { res.json(await prisma.auditLog.findMany({ where: { ...(req.query.module ? { module: String(req.query.module) } : {}), ...(req.query.action ? { action: String(req.query.action) } : {}) }, include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: 'desc' }, take: 500 })); } catch (e) { next(e); } });
app.get('/api/dashboard', auth, async (_req, res, next) => { try { const now = new Date(); const [members, songs, upcoming, trainings, recentSongs] = await Promise.all([prisma.member.count(), prisma.song.count(), prisma.schedule.findMany({ where: { startsAt: { gte: now } }, orderBy: { startsAt: 'asc' }, take: 6 }), prisma.schedule.count({ where: { type: 'TRAINING', startsAt: { gte: now } } }), prisma.song.findMany({ orderBy: { createdAt: 'desc' }, take: 5 })]); res.json({ members, songs, upcoming, trainings, recentSongs }); } catch (e) { next(e); } });
app.get('/api/church', auth, async (_req,res,next)=>{try{const config=await prisma.churchConfig.upsert({where:{id:'main'},update:{},create:{id:'main',name:process.env.CHURCH_NAME||'Cornerstone Global Harvest Church'}});res.json(config);}catch(e){next(e);}});
app.patch('/api/church', auth, allow('ADMIN'), async (req,res,next)=>{try{const data=z.object({name:z.string().trim().min(2).max(150),logoUrl:z.string().max(500).nullable().optional(),service1Start:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),service1End:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),service2Start:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),service2End:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)}).parse(req.body);const before=await prisma.churchConfig.findUnique({where:{id:'main'}});const config=await prisma.churchConfig.upsert({where:{id:'main'},update:data,create:{id:'main',...data}});await audit(req,'UPDATE','settings','main',before,config);res.json(config);}catch(e){next(e);}});
app.get('/api/attendance/export.csv', auth, staff, async (_req, res, next) => { try { const rows = await prisma.attendance.findMany({ include: { member: true, training: { include: { schedule: true } } }, orderBy: { markedAt: 'desc' } }); const quote = v => `"${String(v ?? '').replaceAll('"', '""')}"`; res.type('text/csv').attachment('attendance.csv').send(['Member,Training,Date,Status,Notes', ...rows.map(r => [r.member.firstName + ' ' + r.member.lastName, r.training.schedule.title, r.training.schedule.startsAt.toISOString(), r.status, r.notes].map(quote).join(','))].join('\r\n')); } catch (e) { next(e); } });

app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));

// Serve the built React app from the same origin as the API in production.
// Keep unknown API routes as JSON 404s instead of returning index.html.
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientDistDir, { index: false }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/api' || req.path.startsWith('/uploads/')) return next();
    res.sendFile(path.join(clientDistDir, 'index.html'));
  });
}

app.use((err, _req, res, _next) => { console.error(err); if (err instanceof EmailDeliveryError) return res.status(503).json({ error: err.message }); if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues.map(i => i.message).join(' ') }); if (err.code === 'P2002') return res.status(409).json({ error: 'That record already exists.' }); if (err.code === 'P2025') return res.status(404).json({ error: 'Record not found.' }); if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than the configured upload limit.' : 'Upload could not be processed.' }); res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Something went wrong. Please try again.' : err.message || 'Internal server error.' }); });
app.listen(port, () => console.log(`Church API listening on http://localhost:${port}`));

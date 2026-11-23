# Cornerstone Global Harvest Church

A responsive church management workspace built with React, Vite, Tailwind CSS, Express, PostgreSQL, and Prisma.

## Requirements

- Node.js 20 or newer
- PostgreSQL 14 or newer
- npm

## Setup

1. Start PostgreSQL with Docker Compose (`docker compose up -d db`) or create a PostgreSQL database named `cornerstone_church` manually. The Compose password is for local development only.
2. Copy `.env.example` to `server/.env` and replace `JWT_SECRET` with a unique random secret of at least 32 characters. Set `DATABASE_URL` and a unique `ADMIN_PASSWORD` of at least 12 characters. Add a Google App Password for `christianjames.selda@gmail.com` to `SMTP_PASS` to enable verification and reset emails.
3. Install dependencies from the project root:

   ```bash
   npm install
   npm install --prefix server
   npm install --prefix client
   ```

   For the Docker Compose database, use `DATABASE_URL="postgresql://postgres:local-development-only@localhost:5432/cornerstone_church?schema=public"`.

4. Generate Prisma Client, apply the included PostgreSQL migration, and seed the first administrator and four weeks of Sunday service placeholders:

   ```bash
   npm run db:generate
   npm run db:migrate
   npm run db:seed
   ```

5. Start the API and web app:

   ```bash
   npm run dev
   ```

   The app runs at <http://localhost:8080> and the API at <http://localhost:4000>.

## First sign-in

Use the `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `server/.env`. Seeded admin accounts are already email verified. New registrations need a six-digit email verification code. When SMTP is not configured, the code is written to the API console for local development; configure SMTP before using registration in production.

For Gmail SMTP, turn on 2-Step Verification on the sender Google Account and create an App Password. Put that 16-character app password in `SMTP_PASS` in `server/.env`; do not use the regular Gmail password. Google only offers App Passwords when 2-Step Verification is enabled, and may restrict them on managed or protected accounts. See [Google Account Help](https://support.google.com/accounts/answer/185833).

## Available commands

- `npm run dev` — run API and client together
- `npm run build` — build the client
- `npm run db:generate` — regenerate Prisma Client
- `npm run db:migrate` — apply checked-in migrations
- `npm run db:seed` — add the admin and sample Sunday service schedule
- `npm start` — run the API in production mode

## Roles and access

- **Admin:** manage users and roles, ministries, members, schedules, songs, trainings, presentations, and links.
- **Leader:** manage ministry content and take attendance.
- **Member:** browse the church workspace and update their own profile.

Authorization is enforced by API middleware. Uploads accept image, PDF, and plain text files up to `MAX_UPLOAD_MB` (10 MB by default) in `server/uploads`.

## Notes

- No ministries are seeded. Admins can add the ministries the church uses.
- The two Sunday service times are 8:00–10:00 AM and 10:00 AM–12:00 PM.
- Set `CLIENT_URL` to the deployed client origin. Set a strong random `JWT_SECRET`, restrict uploads at the hosting layer as appropriate, and use SMTP credentials before deployment.
- In production, Express serves the built website and API together, so the browser uses the same website address for API requests. Local development continues to use `http://localhost:4000/api`.

## Publish the website

The included [`render.yaml`](render.yaml) is a Render Blueprint for one website/API service. For a free database, create a PostgreSQL project with Neon and copy its connection string. Put this project in a GitHub repository (exclude `.env`, credentials, `FOR CHURCH/`, and `.vscode/`), connect that repository to Render, and create a Blueprint from `render.yaml`. When prompted, provide Neon's connection string as `DATABASE_URL`, plus `ADMIN_EMAIL`, a strong `ADMIN_PASSWORD`, and the other secret values. Keep secrets in the hosting dashboard; never commit them.

Render's free web service supports custom domains but sleeps after 15 minutes without traffic, so the first visit after idle can take about a minute to load. Neon's free database currently includes 1 GB of storage and 100 compute hours per month. Free plans have usage limits and no production uptime guarantee. Render's local file storage is temporary, so uploaded photos and chord files can disappear after a restart or deploy. Render also blocks SMTP ports 25, 465, and 587 on free web services; email verification needs an email provider that sends over HTTPS or a paid host.

Use the free `*.onrender.com` address Render assigns to the service; no custom domain or DNS changes are needed. Render serves the website and API together on that address and provides HTTPS automatically.

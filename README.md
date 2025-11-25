# Installment Management Backend

Quick notes to run the backend locally and required environment variables.

Required environment variables (see `.env.example`):

- `MONGODB_URI` - MongoDB connection string
- `JWT_SECRET` - Secret for signing JWTs (do NOT commit)
- `FRONTEND_URL` - Frontend origin (used for CORS in production)
- `PORT` - Optional, default `5000`

Dev commands

```bash
cd backend
npm install
# start in dev mode (nodemon + tsx)
npm run dev
```

Seeding

Create default roles:

```bash
npm run seed:roles
```

Create admin user (connects to DB and inserts user if missing):

```bash
node ./checkPassword.ts # or run seedUsers.ts with tsx
npx tsx ./seedUsers.ts
```

Security notes

- Public registration assigns the `employee` role by default. To create admin users use the seed script or create via an existing admin using the `/api/users` endpoint.
- Ensure `JWT_SECRET` is set in production and never checked into source control.
- Consider using HttpOnly cookies for auth tokens and adding CSRF protection for production.

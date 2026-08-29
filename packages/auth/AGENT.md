# AGENT: packages/auth

- **Stack:** Better Auth, Drizzle ORM, Elysia integration at the API boundary
- **Conventions:** Export factories that receive their database dependency. Keep Better Auth configuration here and keep HTTP mounting in `apps/api`.
- **Constraints:** Use the Drizzle adapter with SQLite. Better Auth authenticates people into Herald through email/password only for V1; do not add social providers or store publisher-channel credentials here. Keep secrets and deployment URLs in environment variables; never commit credentials or generated local database files.

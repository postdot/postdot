# AGENT: packages/auth

- **Stack:** Better Auth, Drizzle ORM, Elysia integration at the API boundary
- **Conventions:** Export factories that receive their database dependency. Keep Better Auth configuration here and keep HTTP mounting in `apps/api`.
- **Constraints:** Use the Drizzle adapter with SQLite. Better Auth authenticates people into Herald through email/password; do not add social providers or store publisher-channel credentials here. Keep secrets and deployment URLs in environment variables; never commit credentials or generated local database files.
- **Password hashing:** Expose the Better Auth password-hash operation through this package for trusted offline maintenance callers; do not duplicate the hash algorithm or import auth internals from other packages.
- **Dependency upgrades:** Upgrade `better-auth` and `@better-auth/api-key` together. Keep the explicit `HeraldAuth` API additions and the `as unknown as HeraldAuth` conversion inside `createAuth`; do not widen this boundary with `any`. After an upgrade, run this package's typecheck and tests, then the API typecheck and tests. Confirm the Better Auth endpoints used by Herald's plugin APIs still behave as expected before changing the local contract.

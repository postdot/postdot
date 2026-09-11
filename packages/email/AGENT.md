# AGENT: packages/email

- **Stack:** React Email, React 19, Bun, TypeScript
- **Conventions:** Keep reusable transactional email components and their
  renderers here. Keep transport configuration, delivery policy, and runtime
  logging in `apps/api`.
- **Constraints:** Every template must render both HTML and plain text, keep
  action URLs explicit, and escape user-provided values through React Email.
  Never put credentials or deployment-specific origins in a template.
- **Preview:** Use `bun run --cwd packages/email dev` for the local React Email
  preview server. The development SMTP relay is Mailpit, configured by the
  repository-level Docker Compose file.

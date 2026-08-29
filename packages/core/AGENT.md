# AGENT: packages/core

- **Stack:** TypeScript, framework-independent domain code
- **Conventions:** Keep business concepts independent from HTTP, Bun, and UI concerns.
- **Constraints:** Preserve the distinctions `Post`, `Publication`, `Channel`, `Publisher`, `Job`, `Project`, and `Actor`; do not invent a universal database abstraction before a real boundary exists.

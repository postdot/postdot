# AGENT: packages/core

- **Stack:** TypeScript, TypeBox 1.3, framework-independent domain code
- **Conventions:** Keep business concepts independent from HTTP, Bun, and UI concerns. Provider modules own destination knowledge; core owns only the shared profile, capability, binding, and normalized validation protocols.
- **Content boundary:** Keep reusable source content separate from exact channel target content. Built-in profiles may use trusted TypeBox schemas; persisted custom schemas must pass the bounded JSON Schema policy before compilation.
- **Constraints:** Preserve the distinctions `Post`, `Publication`, `Channel`, `Publisher`, `Job`, `Project`, and `Actor`; never bypass normalized validation issues or add executable behavior to stored schemas; do not invent a universal database abstraction before a real boundary exists.

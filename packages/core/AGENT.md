# AGENT: packages/core

- **Stack:** TypeScript, TypeBox 1.3, framework-independent domain code
- **Conventions:** Keep business concepts independent from HTTP, Bun, and UI concerns. Provider modules own destination knowledge; core owns only the shared profile, capability, binding, and normalized validation protocols.
- **Content boundary:** Keep reusable source content separate from exact channel target content. Built-in profiles may use trusted TypeBox schemas; persisted custom schemas must pass the bounded JSON Schema policy before compilation.
- **Constraints:** Preserve the distinctions `Post`, `Publication`, `Channel`, `Publisher`, `Job`, `Project`, and `Actor`; never bypass normalized validation issues or add executable behavior to stored schemas; do not invent a universal database abstraction before a real boundary exists.
- **External effects:** Keep publication and notification execution behind the shared fenced external-effect contract. New work items must carry only the durable identity and attempt count required by the executor; transport behavior and persistence remain outside this package. Treat `NextEventScheduler.stop()` as an asynchronous drain barrier: callers must await it before closing resources used by an in-flight effect.

- **Provider processing:** A `deferred` effect requests a positive relative delay from executor completion, not an absolute time captured before a long upload. Publication stores schedule it durably without consuming failure attempts; provider-specific status checks and processing limits remain in adapters. It is not a retryable failure or a confirmed publication.

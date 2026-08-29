# AGENT: packages/linkedin

- Stack: framework-independent TypeScript and native Fetch
- Conventions: keep LinkedIn request mapping and provider error classification here;
  expose outcomes that can be consumed by the durable workflow executor
- Constraints: never log or return OAuth token material; do not add a generic
  provider configuration language before another real provider boundary exists

# AGENT: packages/media

- **Purpose:** Provide Postbot's object-storage port and Bun-native local and
  S3-compatible adapters.
- **Boundary:** `MediaStore` exposes web streams and normalized object metadata;
  Bun file objects, S3 file objects, credentials, buckets, and local paths stay
  inside this package.
- **Safety:** Object keys are application-generated opaque identifiers. Adapters
  reject traversal and control characters, enforce byte limits while streaming,
  and keep local writes atomic.
- **Ownership:** This package stores bytes only. Media assets, representations,
  format inspection, retention, publication references, and provider delivery
  belong to higher-level media services and persistence.

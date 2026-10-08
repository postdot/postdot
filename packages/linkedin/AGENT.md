# AGENT: packages/linkedin

- Stack: framework-independent TypeScript and native Fetch
- Conventions: keep LinkedIn request mapping and provider error classification here;
  expose outcomes that can be consumed by the durable workflow executor
- Constraints: never log or return OAuth token material; do not add a generic
  provider configuration language before another real provider boundary exists

- **Image execution:** Keep the legacy `member-post-v2` one-image adapter registered alongside `member-post-v3` (up to 20 JPEG/PNG images). Profile upgrades are explicit; immutable execution revisions keep their original contract. Upload each image through its durable checkpoint, preserve target order and alternatives, and create the post only after every image is confirmed. A retry reuses confirmed uploads; ambiguous uploads require reconciliation.

- **Video execution:** `member-post-v4` adds one H.264 MP4 video, mutually exclusive with images, while v2/v3 remain registered for historical targets. Record the video URN before sending parts; a URN alone never proves transfer completion. Finalization and provider `AVAILABLE` are separate checkpoints. Processing defers the durable job without consuming failure attempts; unknown transfers stay ambiguous and are not blindly uploaded again. No FFmpeg or transcoding is required in production.

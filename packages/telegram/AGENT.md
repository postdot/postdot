# Telegram protocol

- Own only Telegram protocol, payload validation and response classification; keep persistence, credentials, worker claims and media inspection in the application adapter.
- Use injected fetchers and synthetic credentials in tests. No real bot or destination calls.
- The token is in the request URL. Never return provider descriptions, raw URLs or caught exceptions in public errors. Do not follow redirects.
- One send produces one message. Preserve chat plus message identity; uncertain results are ambiguous and never replayed internally.
- Verification only reads bot, chat and membership metadata. Never send a probe, consume updates or change webhooks.
- Media Blob input must come from inspected owned storage. Enforce byte/dimension bounds here as well; metadata does not replace application inspection.

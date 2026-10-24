# Superseded current classification

Source: .autonomos/ISSUES.md, ISSUE-114 Current classification, before META-576
on 2026-10-24. This original text is historical, not current transport guidance.
NOTIFY-354 and the production email executor establish the bounded later SMTP
alert delivery; unrelated destination deferrals remain applicable.

- Current classification: The durable delivery store is real and tested, but no
  external destination is part of the current Postbot product contract. The owner
  explicitly deferred Ntfy, Telegram, and other real adapters for now, without
  ruling them out permanently. A recording in-memory transport verifies the
  delivery seam without network access; revisit real adapters when a concrete
  destination is requested.

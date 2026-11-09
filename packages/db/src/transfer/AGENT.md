# AGENT: packages/db/src/transfer

- **Profile transfer (ADR-097 §8):** `transfer/` exports every table generically, so a new table needs nothing, but these need explicit support or the export/import refuses: a column value outside text/integer/real/blob, rows a migration seeds (`seededRows`), a new AUTOINCREMENT/identity key, and any new table holding a media `store_id` (`locatorTables` in `media-transfer.ts`). Keep the byte-order guarantee (`collate "C"` for text keys on PostgreSQL): the import commits only when the target re-exports to the manifest's checksums.

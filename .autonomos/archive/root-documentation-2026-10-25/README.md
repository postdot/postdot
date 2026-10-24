# Retired root documentation

Original source commit: `ef1c192ddd3ca060c941a1f83a6fbbf30f95d682`. This batch preserves the former root
`docs/` files as dated evidence, not current operating instructions. Do not load
this batch for ordinary development or treat a proposal as an accepted contract.

Current public documentation lives in `apps/docs/content/docs/`. Current tasks,
issues, specifications and decisions remain outside this archive. Original
relative links refer to the original source layout and may describe removed code;
use the source commit when investigating them. HTML/CSS calibration files retain
their adjacent assets. Do not publish these fixtures as current product UI.

`manifest.json` records all 52 original files and their SHA-256 values. The 18
license texts are preserved in root `licenses/`, without byte changes. Original
license provenance prose is retained here; current distribution instructions
live with the notices. This preservation is not a fresh license audit.

## Retrieval by topic

- Deployment/runtime/release: `source/docs/deployment/`; current installation,
  operations and release information is in the public site. The accepted release
  policy is retained in ADR-093; old candidate IDs are evidence, not a new release.
- Product expansion, channel-builder and Meta discovery: `source/docs/project/`;
  the original proposal/acceptance status remains in each file. Current remaining
  scope is tracked by ISSUE-162/165/166/167/171/172/174 and the relevant accepted
  decisions, including ADR-088. Do not restart an old recommended implementation lot.
- Provider/CLI/client coverage: `source/docs/`; dated test/acceptance descriptions
  do not establish current completion. Public references describe verified scope.
- BENCH-395: `source/docs/benchmarks/`; raw samples and their measurement method
  remain together. They establish neither current footprint nor minimum hardware.
- DESIGN-33/META-34: `source/docs/design/`; historical calibration fixtures only.
  Root DESIGN.md remains the current design contract.
- PUBLIC-552: `source/docs/security/public-source-review.md`; bounded historical
  disclosure review, not a current security certificate or execution instruction.

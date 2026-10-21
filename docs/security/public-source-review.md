# Public source preparation review

Date: 2026-10-21. Scope: PUBLIC-552. Publication status: **not cleared**.

## Outcome

No genuine application access credential, private-key block, tracked environment
file or SQLite database was confirmed in the examined source and history. This
is a finding from bounded inspection, not a guarantee that arbitrary secrets or
sensitive prose cannot remain.

The main obstacle is disclosure of operational context: historical worklogs link
real provider accounts to acceptance tests, describe authentication difficulties,
and expose unrelated local project paths. Deleting a current file does not remove
it from earlier commits. The owner must choose the public history and records
policy before changing visibility.

## Examined surfaces

- Current tracked tree: 2,178 files before this preparation, including 735
  Autonomos records. Runtime environment files and databases are ignored rather
  than tracked; no database file header was found in examined reachable blobs.
- Local Git: 9,663 unique reachable file blobs across branches, tags, stash and
  harness checkpoint refs. Default-branch history contained 1,004 commits at the
  reviewed baseline. Local-only harness objects are not automatically exposed by
  making a GitHub repository public.
- Remote Git: a read-only mirror of all advertised refs, including 56 branches
  and 215 pull-request refs, 776 commits and 5,249 blobs. Another 125 blobs were
  outside the local object inventory and received supplementary inspection.
- GitHub metadata: 215 pull requests, the issue-list endpoint (the same 215 pull
  requests, not 215 additional issues), and 14 issue comments. There were no pull
  request review comments, releases or downloadable Actions artifacts at inspection.
- Tracked raster images: no EXIF/GPS metadata found. The ten marketing captures
  were visually checked and show demonstration content. This does not establish
  every asset's legal clearance; existing attribution and license checks remain.

Gitleaks 8.30.1 was downloaded from its official release and checked against its
GitHub-published SHA-256 digest. Redacted reports stayed outside the repository.
The scan used default rules with no repository-wide exclusions or suppressed
findings. Parent inspection classified the 23 findings in the tracked-tree plus
metadata export, 1,149 all-local-ref findings, and 21 remote-history findings:

- Source matches were explicit replacement values, deterministic test credentials,
  translation labels or variable names rather than provider secrets.
- Repeated local findings primarily came from harness checkpoints. Old npm cache
  objects were reachable only from local auxiliary refs, not main or remote
  branches. They must not be pushed with a mirror/all-refs operation.
- One match was a temporary clone credential returned by GitHub's authenticated
  repository-metadata API. It exists only in the private audit export, not in
  committed source; no value was copied into this report or chat.

Supplementary searches covered personal-address patterns, known live-acceptance
identities, local paths, private-key blocks, provider-token shapes and SQLite file
headers. Two MiniMax M3.1 Flash Free reviews at max reasoning covered Autonomos
privacy and the README; the parent reviewed both reports and retained their limits.

## Findings and disposition

| Finding | Assessment | Disposition |
| --- | --- | --- |
| Real social handles, permanent account identifiers and test-post URLs in worklogs | Unnecessary personal-account correlation; not credentials | Exclude from a public snapshot, or redact every reachable historical occurrence under an explicitly accepted history plan |
| Account recovery and secret-reveal difficulties in worklogs | Personal operational state | Keep the original evidence private; publish only the technical prerequisite |
| Home directories, unrelated project paths, internal session IDs | Mostly low sensitivity, unnecessary operational detail | Generalize useful technical evidence; keep raw execution records private |
| Deleted handover still in Git history | Current-tree deletion does not remove the historical context | Include in the history decision |
| Historical security audit reproductions | Evidence of prior defects, not proof of an unfixed current flaw | Preserve useful transparency with accurate fix/version context; do not erase known defects to imply safety |
| Commit author identities | Names and email addresses are public with commit history | Review the author identity on any new public initial commit |
| Runtime/credential file variants | Existing ignores covered ordinary .env and SQLite files | Extended Git ignores for SQLite3, .db and private-key/certificate-store formats; templates remain visible |

The independent reviewer assigned some public identifiers a higher risk than the
parent accepts. An OAuth client ID, a public domain or an orchestration UUID is
not an access credential by itself. The actionable concern is unnecessary personal
correlation and operational context, not an invented authentication bypass.

## Proposed publication boundary

**Recommendation, not an adopted migration:** keep the present repository private
and create postdot/postdot from a reviewed source snapshot with a new initial
history. Preserve copyright notices, third-party licenses and provenance. Keep
reviewed architecture, accepted contracts and contributor instructions available;
keep raw worklogs, private acceptance evidence and conversational handovers in a
separate private store. Curate task/issue records and documentation links rather
than publishing or deleting the entire Autonomos tree mechanically.

Before using that snapshot, resolve links to excluded evidence and ensure a fresh
checkout can build and follow the public instructions. The repository should have
one clearly identified canonical development path after migration; do not create
an indefinitely diverging public mirror. Existing private collaborators, branches
and issues remain intact until a deliberate transition.

The alternative is a coordinated cleanup of the existing repository and its
reachable history, branches, pull-request surfaces and associated metadata before
changing visibility. That keeps more history but changes commit identities and
requires more coordination. GitHub documents the [effects of history rewriting](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).

Neither strategy has been executed. No force push, repository transfer, visibility
change, package/image publication, external account creation or deployment occurred.

## Limits and next decision

This was a disclosure review, not a penetration test, exhaustive authorization
review or legal clearance. Pattern scanning cannot prove the absence of secrets
in arbitrary formats or private prose. Ignored runtime stores were not copied or
opened for this audit. Historical Actions logs were not downloaded (584 runs were
listed); retained logs would need review under an existing-repository visibility
change. GitHub-internal inaccessible refs, caches and attachments not represented
by the fetched metadata are not cleared by this review.

The new-snapshot recommendation avoids exposing those old remote surfaces; it
still requires inspecting the exact final snapshot before publication. Complete
BRAND-551's namespace and identity plan alongside that launch preparation. The
owner reports reserving postdot.app, the npm postdot namespace and the GitHub
postdot organization; no package or registry image publication is implied.

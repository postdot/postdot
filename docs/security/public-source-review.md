# Public source preparation review

Date: 2026-10-21. Scope: PUBLIC-552. Review result: **no major disclosure blocker identified**. Transfer/publication preparation continues in PUBLIC-553.

## Outcome

No genuine application access credential, private-key block, tracked environment
file or SQLite database was confirmed in the examined source and history. This
is a finding from bounded inspection, not a guarantee that arbitrary secrets or
sensitive prose cannot remain.

On 2026-10-21 the owner chose to preserve the existing repository history, branches
and pull requests. Public account identifiers, local paths and working preferences
are low-sensitivity context, not reasons to reset history. Apply useful corrections
to current records without attempting to erase every earlier occurrence. Revisit
history only if a concrete serious exposure, such as an exploitable secret, is
confirmed. The earlier new-initial-history proposal was rejected.

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
| Real social handles, permanent account identifiers and test-post URLs in worklogs | Unnecessary personal-account correlation; not credentials | Generalize unnecessary current account references; preserve earlier commits under the owner-accepted policy |
| Account recovery and secret-reveal difficulties in worklogs | Personal operational state | Reduce current wording to the technical prerequisite; do not rewrite history for low-sensitivity context |
| Home directories, unrelated project paths, internal session IDs | Mostly low sensitivity, unnecessary operational detail | Generalize unrelated private paths where useful; retain ordinary technical records |
| Deleted handover still in Git history | Current-tree deletion does not remove the historical context | Accepted as low-sensitivity historical context; no history rewrite |
| Historical security audit reproductions | Evidence of prior defects, not proof of an unfixed current flaw | Preserve useful transparency with accurate fix/version context; do not erase known defects to imply safety |
| Commit author identities | Names and email addresses are public with commit history | Preserve existing authorship and contributions |
| Runtime/credential file variants | Existing ignores covered ordinary .env and SQLite files | Extended Git ignores for SQLite3, .db and private-key/certificate-store formats; templates remain visible |

The independent reviewer assigned some public identifiers a higher risk than the
parent accepts. An OAuth client ID, a public domain or an orchestration UUID is
not an access credential by itself. The actionable concern is unnecessary personal
correlation and operational context, not an invented authentication bypass.

## Accepted publication boundary

Preserve the existing repository and its history. Prepare its rename and transfer
to postdot/postdot, retaining commits, branches, pull requests and useful Autonomos
records. Do not create a replacement repository with a new initial history, squash
the accumulated work, force push, or delete agent records wholesale.

Current-document corrections can remove unnecessary personal-account correlations
and unrelated private paths while retaining acceptance outcomes and technical
rationale. Their earlier versions remain in Git by design. This is proportionate
to the observed low sensitivity; it is not a claim of historical erasure.

GitHub documents that [repository transfers](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository)
preserve Git history and associated pull requests, issues, stars and watchers.
Check actual permissions, destination availability and integrations before transfer.
The code rename must preserve persisted cryptographic/data identities rather than
blindly replacing every historical byte. Making source public does not authorize
publishing packages/images or deploying the site.

No reset or history rewrite was performed. PUBLIC-553 records actual subsequent
preparation and any external changes; this report records the disclosure review.

## Limits and next steps

This was a disclosure review, not a penetration test, exhaustive authorization
review or legal clearance. Pattern scanning cannot prove the absence of secrets
in arbitrary formats or private prose. Ignored runtime stores were not copied or
opened for this audit. Historical Actions logs were not downloaded (584 runs were
listed). Their contents are outside the evidence of this review; absent a concrete
signal, this does not mandate an exhaustive historical-log cleanup. GitHub-internal inaccessible refs, caches and attachments not represented
by the fetched metadata are not cleared by this review.

Complete BRAND-551's namespace and identity plan alongside launch preparation.
The owner reports reserving postdot.app, the npm postdot namespace, the GitHub
postdot organization and Docker Hub ID postdot. None implies a package or image
release. No serious confirmed exposure currently justifies rewriting history.

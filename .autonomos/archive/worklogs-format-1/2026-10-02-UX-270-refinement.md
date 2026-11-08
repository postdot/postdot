# UX-270 — Configuration layout and administrative recovery refinement

Status: complete.

## Outcome and decisions

The owner rejected unjustified configuration width changes, bright dark-theme
OAuth dialogs, explanatory form clutter and nested member-list boxes. OAuth,
installation access and API keys now use the compact General/Account body width
under the shared page header. Resource rows are flat, separated only where useful.
Dialog content uses the existing raised surface rather than the brighter overlay
surface; this scoped adjustment does not redefine all application overlays.

OAuth forms retain required provider fields and callback requirements. General
setup prose and redundant switch/secret explanations were removed. Editing an
existing secret keeps one concise instruction about leaving it blank.

Installation members show avatars and readable current-account role/state badges.
Editable controls remain available for other members with the original server
protections. Invitations use one inline form and one row per invitation. A newly
issued link and its one-time copy warning live within the corresponding row;
revocation removes the transient link as well as the pending invitation.

API keys retain visible project/action limits, expiry and explicit revocation.
One-time secret reveal remains a distinct earned surface with its copy warning.
Creation, permission editing and revocation errors appear inside their dialogs,
not behind them. Failed list loading offers Retry and stops the loading indicator;
failed creation preserves typed input. No credential or authorization semantics
were expanded.

## Validation

Final full `bun run check` passed: format, lint/spelling, types, localization,
unit checks, 48 main browser scenarios, two password-reset scenarios and all
17 build tasks. Final log: `/tmp/postbot-ux270-settings-final-check.log`.

Focused native OAuth, installation access and API-key journeys passed. Rendered
and Axe checks cover light/dark at 1280, 820 and 390 pixels, including the issued
invitation link and French mobile OAuth form. Added API-key creation failure with
retained input and list failure/retry assertions. Existing permission, secret
omission, invitation acceptance/revocation and publication-media assertions remain.

An earlier full gate was deliberately interrupted to add API-key error recovery;
only the final complete gate establishes success. Review used the isolated repo
Playwright environment, not the blocked live browser surface. No real invitation,
provider credential or API key was issued for UI review.

## Files and durable guidance

Changed OAuth page/form/fields/row, installation access page, personal API-key
page, English/French catalogs and the corresponding browser journeys, including
the media journey's one-time-key warning assertion. DESIGN.md records the owner's
compact configuration layout requirement and rejects gratuitous nested boxes.
Task board marks UX-270 complete. No AGENT.md update: existing navigation and
primitive rules suffice; task-specific details belong here.

## Next work

Continue a bounded review of remaining configuration surfaces against the same
layout and interaction principles. OPS-271 remains independently queued for API
watch shutdown; this UI pass does not alter process-lock semantics.

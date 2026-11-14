# ADR-103 — Studio experience principles

- Status: accepted
- Accepted by: owner, 2026-11-14, on reading the audit ("I fully share the finding"; existing rules may change when the change improves the product)
- Scope: every authenticated and anonymous Studio surface in `apps/web` and the shared primitives in `packages/ui`
- Provenance: [Studio experience audit](../reviews/2026-11-14-studio-experience-audit.md); task UX-651
- Related specs: [SPEC-010](../specs/SPEC-010-web-experience-standard.md)
- Supersedes: the centred-title-with-return page header, the in-cell calendar overflow expansion, and the blocking composer recovery dialog recorded in `DESIGN.md`; the matching passages of [ADR-073](ADR-073-in-cell-calendar-actions-and-sticky-time-gutter.md) and `postdot-operational-ux`

## Context

The owner rated Studio about 3/10 after several weeks of agent-led work. A rendered audit found 110 defects and traced them to six causes: the interface exposes the storage model, pages share no anatomy, channel identity is missing where a multichannel product needs it, navigation is scattered, copy explains mechanism rather than outcome, and everything carries the same visual weight.

Most earlier rules were written one surface at a time. Each was reasonable locally; together they produced an application that no single rule describes. Agents then preserved those rules faithfully, including the ones causing harm. This record states the principles that outrank local rules, so the next agent corrects course instead of repeating the pattern.

## Decision

### 1. Speak the user's language

Studio uses the vocabulary of a person publishing content, never the vocabulary of the schema.

| Say                                                                         | Never show                                                |
| --------------------------------------------------------------------------- | --------------------------------------------------------- |
| Post (the thing written once)                                               | source, source document, source revision                  |
| Channel (where it goes)                                                     | target, destination contract, profile (as an object name) |
| Channel version (customized text)                                           | target content, payload, override                         |
| Content rules (per channel)                                                 | profile, contract, schema, capability, binding            |
| Draft, Scheduled, Publishing, Published, Failed, Needs attention, Cancelled | queued, ready, promoted, claimed, ambiguous, reconciled   |
| Save changes                                                                | promote, apply to channel, use this version, rebase       |
| Publish by hand (manual channel)                                            | manual delivery, due manual work                          |
| Platform setup                                                              | OAuth application, provider application                   |
| Installation                                                                | instance                                                  |
| Could not confirm                                                           | ambiguous, uncertain outcome, reconciliation              |
| characters                                                                  | graphemes, weighted characters                            |

One concept has one word in each locale. Revision numbers, schema identifiers, hashes and execution internals stay out of Studio; they belong to the API, the CLI and MCP. Studio never shows or accepts JSON: Studio is a no-code interface for daily use, so any complexity is expressed through forms, choices and plain sentences, and a value the form cannot represent is shown as set by its content rules, not as raw data (owner decision, 2026-11-14).

An error says what happened and what to do next. `The request could not be completed` and `… action failed` are not acceptable final messages.

Helper text states a consequence in one sentence, or it is removed. It never describes implementation.

### 2. One page anatomy

- The page title is left-aligned, at a modest size, with the page action on the right of the same row.
- A top-level destination (anything in the sidebar) has no return control. Only an object page (a post, a publication) has one, and it names the parent.
- The title equals the navigation label.
- One empty-state component, one dialog specification, one status component, one button scale. A page does not compose its own.
- Dialogs dim the page; they do not blur it.
- Filters and view controls appear only when there is something to filter.

### 3. Channel identity everywhere

Wherever a publication is listed or drawn, its channel is identified by its mark and, space permitting, its name. A post going to several channels is shown once with its channels, not once per channel, unless the view is explicitly per channel.

### 4. One navigation

One sidebar, with two states. The product state lists the work (Overview, Queue, Performance), the project (Channels, Media, Tags, People, Project settings) and workspace channels; a Settings entry at its foot opens the settings state. The settings state lists personal, workspace and installation settings and starts with a single return row naming the project it returns to. No other return control exists on a sidebar destination.

Project, workspace, personal and installation settings are reached from visible entries, never only from inside a selector menu. Settings that act on an object live on that object's settings page, with destructive actions in a danger zone at the end. One concept has one page: project members and invitations share People; the time zone and archiving share Project settings. The header carries scope, search, notifications and the account menu; language and theme sit in the account menu and in personal settings, never as loose header buttons.

### 5. Weight follows frequency

The primary flow (write, choose channels, choose time, confirm) is the most prominent thing on its surface. Rare, technical and destructive controls go into a menu or a disclosure. A destructive action is never the most prominent control and never sits beside its safe sibling at equal weight.

### 6. Actions are forgiving

A one-click state change from a list offers undo. Work is restored silently with a way to start over; the interface does not block on a question the person did not ask. Defaults are safe: a schedule never defaults to a time already past.

### 7. Time and numbers are consistent

One formatter per locale: no leading-zero hours beside plain ones, no 24-hour field in a 12-hour locale, the current year omitted, week start consistent between every calendar. A timeline's axis is linear.

### 8. Honest previews

A preview shows the channel's own name and mark and never invents people or engagement.

## Alternatives considered

- **Repair each finding locally and keep the rules.** Rejected: the rules are part of the cause, and the next agent would restore the defects in good faith.
- **Rewrite `DESIGN.md` from scratch.** Rejected: the visual foundations (palette, type, geometry, surface roles) are sound and owner-calibrated. Only composition, vocabulary and interaction rules change.

## Consequences

- `DESIGN.md`, SPEC-010, `apps/web` guidance and `postdot-operational-ux` are revised to match; where an older record disagrees with this one, this one wins.
- Existing browser tests assert superseded copy and structure. They are updated with the surface they cover; an assertion is rewritten to the new contract, not deleted.
- The API, CLI and MCP keep their domain vocabulary. This record governs what Studio displays, not the names of fields.
- A rule here changes the same way it was made: by owner decision, with rendered evidence.

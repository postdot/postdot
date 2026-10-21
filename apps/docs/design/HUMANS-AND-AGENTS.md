# Human and agent access — visual study

Status: SITE-443 proposal, awaiting owner review. Homepage unchanged.
Review route: `/usage-study/`.

## Rejected direction

SITE-441/442 centered the shared draft, with agent/Studio tabs and simulated
preparation. The owner rejected this concept: it read as a technical diagram,
required clicks to communicate, and relegated the actual clients to a footnote.
Do not iterate on that scene or treat functional checks as aesthetic approval.

## Current proposal

The access surfaces themselves are the main content. Three large visual panels
feature Studio (real product crop), MCP (actual protocol mark on brand blue), and
n8n (actual integration mark with a short workflow). CLI/API, agent skills and
mobile remain visible directly below, without tabs, editing or fake actions.

Scroll moves the Studio crop, protocol mark and workflow within clipped panels.
The workflow lines carry an in-view signal. Reduced motion keeps the complete
composition still. No entrance opacity hides essential content. Narrow screens
use a vertical reading order rather than a squeezed desktop diagram.

This is a client gallery, not a working integration demonstration. The headline,
composition, color assignments and copy are proposals, not accepted public claims.
The Studio crop is deliberately partial; it identifies the client rather than
pretending to be an editable product walkthrough.

## Availability boundaries

- Studio and CLI/API: available, without a promise of complete feature parity.
- MCP: planned, ISSUE-036. No released MCP server is implied.
- Agent skills: first-launch target, not authored or installable yet.
- n8n: planned workflow integration, no native node promised.
- Mobile: future client, no app-store download or invented native screenshot.

No assistant-provider logos imply compatibility, no prompt triggers an actual
agent, and no publication happens. Local motion does not change product state.

## Review criterion

The visitor should recognize the range of ways to use Postdot before reading a
paragraph or clicking. The owner must still judge whether this visual treatment
has enough character; correct icons and responsive geometry alone do not establish
that it is a successful marketing section. Do not integrate into the homepage
without that review.

## Owner feedback and SITE-444 refinement

The owner accepted the client-card direction: shared foundations with a distinct
visual style for each access surface, and less emphasis on future integrations.
This accepts the direction, not every detail or homepage integration.

The refinement gives compact clients their own artwork: a real CLI help command,
a fan of skill sheets, and an abstract mobile-device silhouette, without claiming
these are shipped skills or a native app screenshot. Status tags retain text and
use restrained color, so availability never depends on color alone. Skill sheets
and the phone have a finite in-view composition and a separate hover response.
The CLI copy control provides feedback and a manual-copy fallback when clipboard
access is unavailable. No terminal command executes.

Section headers have no pre-title label. This owner rule is captured in the public
site AGENT.md; descriptive text remains optional and short.

## SITE-445 corrections

Availability tags have no leading dot. n8n uses a rose tag and a larger, fixed
workflow scene whose connector reveals follow the actual nodes. CLI artwork shows
an excerpt of the existing help resources rather than three decorative words.
Copy success uses Solar Check, not the messaging read-receipt icon.

Studio no longer receives a scroll-derived initial translation. The homepage
product image also starts at its final scale; neither waits for scroll measurement
to establish its first position. Homepage section entrances now distinguish copy,
illustration reveal and product surfaces. They apply only to initially below-fold
content, run once, preserve layout space and respect reduced motion. Existing
Skills and Mobile artwork is retained. Homepage gallery integration is still a
separate step.

## Homepage integration — SITE-446

The owner authorized replacing the terminal-led automation section with this
shared gallery. `UsageGallery` is now reused by the homepage and isolated study;
`#automation` remains the public navigation target. Gallery headings use h2/h3.

The CLI is a window illustration, not a copyable snippet: monospace throughout,
window chrome, prompt, finite stepped command entry and delayed help output. No
copy button or clipboard access remains. Workflow connectors and node emphasis
replay together on card entry, pointer entry or the accessible replay controls.
Controls remain mounted while replaying so keyboard focus is preserved. Reduced
motion shows the completed terminal and workflow without playing the sequence.

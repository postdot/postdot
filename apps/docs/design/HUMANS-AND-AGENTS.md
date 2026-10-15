# Human and agent usage scene — design proposal

Status: proposed composition, not approved final copy or an implementation task.
Scope: replace the current terminal-led automation presentation after review.
Source: owner direction on 2026-10-15, ISSUE-157 and public-positioning.md.

## What the visitor should understand

I can use Postbot myself, ask my existing agent to work with it, or connect a
workflow. These are entry points to the same posts and project, not separate
products or an AI chat I must buy inside Postbot. Preparing a draft is not sending
it live. I can pick up the draft myself after an agent prepares it.

## Recommended form: a shared workspace scene

One broad visual stage, rather than a card grid or auto-advancing carousel. The
post is the persistent subject. Two explicit entry choices change only the way
that post is prepared: **Studio** and **Your agent**. The scene opens on the agent
path because the existing hero already demonstrates direct authoring.

The core composition has three connected parts:

1. A short natural-language request, left: an example from a normal user, not a
   terminal, protocol log or model-specific chat clone.
2. A compact shared draft, center: recognizable content, image and two real
   destination marks. This is a draft, not a fake dashboard or an isometric machine.
3. A direct human continuation, right: the same draft ready to review in Studio.
   Emphasize the editable content, not a celebratory success indicator.

Keep the draft geometry and location fixed when switching entry paths. The Studio
path brings authoring into focus; it does not duplicate the same card into another
feature. On the agent path the request leads to preparation, then the human review
point becomes available. Do not send the example post during the scene.

The stage can combine a cropped, faithful Studio representation with restrained
vector connections. Do not require another complex isometric object. The accepted
distribution illustration is a style reference for line hierarchy, not a mandate
to render every feature in perspective.

## Concrete illustrative action

Example request, deliberately limited to existing draft semantics:

> Prepare a draft announcing our new collection for LinkedIn and Bluesky.
> Keep it unpublished; I want to review it first.

Example draft subject: **The spring collection is here.**
Use an editorial product image only after choosing a suitable owned/licensed asset;
do not fabricate an abstract map or reuse the old cycling campaign just to fill
space. Keep the final subject/image open until the visual prototype is prepared.

The natural-language exchange is an illustrative external-agent workflow through
available CLI/API access, not proof of a shipped built-in assistant or MCP client.
Keep a small example cue outside the scene. No unverified assistant brand logos,
compatibility claim or simulated streaming novel.

## Motion sequence

- Initial frame: show the request and recognizable shared draft immediately.
  No long blank canvas, skeleton theatre or mandatory entrance delay.
- Preparation: one restrained connection carries the request to the draft. Its
  content is revealed as a coherent unit, not character-by-character chat typing.
- Handoff: focus passes to the Studio review point; the draft stays in place.
  The visual relationship explains that a human can continue the same work.
- Rest: hold the composed result for reading. Replay is optional; switching the
  entry choice restarts only that demonstration. Do not rotate choices on a timer.
- Reduced motion: all relationships and the review point are visible as a still.
  Offscreen/hidden scenes sleep, focus is stable, and controls work without hover.

Use the shared scene model for any connected movement. Prefer opacity and local
content reveal to moving whole windows. Limit animation to this handoff; do not
add a second ambient loop behind it.

## Access ecosystem around the scene

A narrow, typographically deliberate strip under the stage establishes breadth;
it is not six equal promotional cards. Names remain visible without a carousel.
Availability is part of the composition, not buried in a tooltip.

| Item         | Representation in this proposal                                      | Availability boundary                                  |
| ------------ | -------------------------------------------------------------------- | ------------------------------------------------------ |
| Studio       | Direct-work entry choice and human review destination                | Available                                              |
| CLI / API    | Compact access mark connecting an external agent to the shared draft | Available; do not imply complete UI parity             |
| MCP          | Named access option alongside the existing interfaces                | Planned, ISSUE-036; not part of the live example       |
| Agent skills | Guidance beside the agent entry, not another transport arrow         | Intended for first launch, not authored yet            |
| n8n          | Workflow access option, visually separate from conversation          | Planned supported integration; no native node promised |
| Mobile       | Future human access option near Studio                               | Future client; not an app-store badge or download link |

Current and planned items use a short status treatment, without decorative disabled
controls that look broken. Do not imply users need all clients. Agent skill launch
intent does not make the skill currently installable. A later prototype may show
an n8n workflow as a selectable example only after its behavior is verified.

## Layout and visual constraints

- Reuse the accepted Host Grotesk, small radii, neutral surfaces and blue accent.
  Blue follows the active preparation/handoff, not every client mark at once.
- One broad stage on desktop with a deliberate reading order. No unrelated image
  backgrounds, generic settings icons, terminal wall or floating logo constellation.
- Mobile: request, shared draft and human continuation in that order. Preserve the
  same subject; do not squeeze a desktop canvas into unreadable thumbnails.
- Show a product crop at a legible size. Avoid screenshot-within-screenshot and
  fake interactive authoring controls. Real section controls only switch examples.
- Keep the headline short and the supporting copy to one sentence. Final wording
  is not selected by this document. The scene must explain the handoff without a
  paragraph describing every arrow.

## Why this form

A card grid lists tools but does not explain their shared data. A carousel can
support multiple use cases, but hides breadth and risks presenting clients as
unrelated slides. A shared stage preserves context and shows agency moving from
human request to agent preparation to human review. It complements the previous
one-source/many-destinations section: that section explains outputs, this one
explains ways into the product.

## Prototype acceptance

A visitor can identify direct use, agent-assisted use and the common draft without
reading implementation details. Current and future availability are unambiguous.
No automatic publication is suggested. Both paths preserve the same draft identity.
Small-screen content is readable; controls support keyboard/touch and reduced
motion; a failed animation still leaves an informative illustration.

Next deliverable: one complete, isolated section prototype using this handoff,
with actual component styling and one resolved example asset. Do not replace the
current live automation section or build further scenes in the same pass. The
owner can judge a finished section proposal rather than an empty wireframe.

## Prototype delivered — SITE-442

Review route: `/usage-study/`, independent of the homepage. The shared draft is
an illustrative Postbot introduction, using the existing brand mark as its cover
rather than an unrelated invented collection asset. Studio and agent tabs keep
the same local content. Review/Edit enables the actual textarea; switching modes
or replaying preparation preserves edits. Timed preparation only demonstrates
the handoff; it does not call an LLM, API, publisher or external service.

The availability strip names Studio, CLI/API, MCP, skills, n8n and mobile. Labels
distinguish available, launch intent, planned and future. This is a section
proposal, not proof of the future integrations. Native Base UI tabs/buttons, Solar
icons, existing typography/palette and bounded Motion are used. Headline and
layout remain reviewable, not adopted public messaging.

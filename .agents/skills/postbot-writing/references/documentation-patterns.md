# Documentation patterns to evaluate

Reviewed 2026-10-15. This is a small research baseline, not a style contract or a
ranking of entire documentation sites. Observations below come from the linked
pages' content and structure, not a full visual or usability audit. Revisit a source
before relying on its current product instructions.

| Page | Observation | Useful direction for Postbot | What not to import |
| --- | --- | --- | --- |
| [Linear: Issues](https://linear.app/docs/creating-issues) | A product-object overview leads to task headings, literal controls and targeted screenshots. Language explains actions rather than selling the feature. The page grows long as advanced cases accumulate. | Studio guides can put a real screenshot near an action that is hard to locate. Name the control and result; place advanced cases lower or link to them. | Its whole information density, every shortcut, or a screenshot for every sentence. |
| [Bun: Installation](https://bun.com/docs/installation) | Installation alternatives are grouped by environment. Verification commands and recovery from an unrecognized command follow the main action. Most of the useful content is concrete commands and short explanations. | For CLI/operator pages, put a working command and expected result near each other. Use tabs when OS or client choices are actual alternatives. | Sales asides, unverified time estimates or a command-first structure for nontechnical Studio readers. |
| [Supabase: Docker self-hosting](https://supabase.com/docs/guides/self-hosting/docker) | Prerequisites, installation, configuration and operation have distinct places. Its many operational branches make a long page navigable through a detailed contents list. | Keep first installation readable and route maintenance/recovery into their own guides. Place required context before the affected operation. | Supabase's service topology, resource figures, cloud upsell or its entire long-page outline. |

## Presentation decisions, not decoration

- Use steps for a sequence. Use a table for comparable facts. Keep required steps
  and constraints visible; accordions can hold optional explanation, not hide a
  prerequisite or the effect of a destructive command.
- A screenshot should answer “where is it?” or “what should I see?”. Use current,
  clearly scoped captures of the real product. A diagram should explain a
  relationship that prose makes hard to follow. Decorative images add maintenance
  without answering either question.
- Tabs help readers choose equivalent paths, such as OS commands. Do not split
  successive instructions across tabs or make core content depend on discovery.
- Reserve callouts for a decision or consequence that deserves interruption.
  Routine tips can stay in prose. Widgets do not substitute for clear writing.

These are editorial proposals to test on actual pages. No widget, illustration,
animation or page rewrite is authorized simply by appearing in this reference.

## Small calibration example

Illustrative wording, not a claim that these sentences were accepted by the owner:

Before: “Postbot empowers you to seamlessly manage your publishing journey across
multiple destinations. In this guide, we will explore how to get started.”

After: “Write a post, choose its destinations and save a draft.”

The second version names the reader's action. A real guide must then supply the
relevant control names and result; brevity alone does not make it sufficient.

## What remains open

How much explanation new users need, the balance of screenshots and text, use of
contractions, and the final degree of informality should be calibrated through
owner reviews of real pages. Do not infer those preferences from this comparison.

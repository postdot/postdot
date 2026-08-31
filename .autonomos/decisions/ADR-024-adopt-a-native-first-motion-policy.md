# ADR-024: Adopt a Native-First Motion Policy

- Status: Accepted
- Date: 2026-08-31

## Context

Herald's web surface currently uses small CSS transitions for interaction
feedback. GSAP was identified as a possible future tool, but no concrete
interaction currently requires an animation runtime. A runtime would add
dependency weight and another abstraction to the browser bundle, while motion
must remain accessible and must not obscure workflow state.

## Decision

Herald adopts a native-first motion policy:

1. Essential state and feedback must remain understandable without motion.
2. Use CSS transitions for local state changes, limited to color, opacity,
   shadow, border, and small transforms. Do not use `transition-all`.
3. Use CSS keyframes only for finite, purposeful feedback or progressive
   disclosure. Do not add decorative infinite motion, scroll hijacking,
   parallax, or large-area scaling and panning.
4. A finite sequence that cannot be expressed clearly with CSS may use the
   browser Web Animations API before a third-party runtime is considered.
5. Every non-essential motion path must honor
   `prefers-reduced-motion: reduce`. The shared UI stylesheet provides a global
   reduced-motion fallback, and imperative animations must make the same
   decision before starting.
6. GSAP or another animation runtime requires a separate accepted decision after
   a concrete interaction demonstrates that CSS and native browser APIs are
   insufficient. That proposal must include route-level bundle impact, a
   reduced-motion behavior, keyboard/focus behavior, and a performance
   measurement.

The shared UI package owns the cross-surface reduced-motion fallback. Components
own the semantics and must not use motion as their only status channel.

## Alternatives considered

1. Add GSAP immediately: this solves no demonstrated problem and increases the
   browser dependency and maintenance surface before the product needs it.
2. Ban all motion permanently: this would unnecessarily prevent useful,
   accessible feedback where native CSS or browser APIs are sufficient.
3. Leave motion ungoverned: this would allow inconsistent transitions,
   inaccessible animation, and avoidable bundle growth to accumulate.

## Consequences

- The current application needs no animation runtime dependency.
- Motion decisions are consistent across future Herald web surfaces.
- Reduced-motion support is part of the shared UI foundation rather than a
  reminder repeated in each component.
- A future runtime remains possible, but it must earn its dependency through a
  measured interaction need.

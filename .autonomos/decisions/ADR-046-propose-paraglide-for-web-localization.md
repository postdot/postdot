# ADR-046 — Propose Paraglide for the Web Localization Foundation

- Status: proposed
- Date: 2026-09-07
- Scope: authenticated web interface localization; not publication-content translation
- Related issue: ISSUE-049
- Related task: I18N-95

## Context

Herald's web client is a Vite-powered SPA using React and TanStack Router. Its
interface currently contains English copy directly in components, with no
locale preference, catalog boundary, fallback contract, or shared language
switching behavior. The product is intended for a broad audience, so adding
more interface copy without a localization boundary would make a later
extraction expensive and inconsistent.

The API already exposes stable machine-readable error codes and parameters.
Those codes are the client translation boundary; the server must not become the
source of translated web copy. The language of a publication is also a domain
property and must not be inferred from or coupled to the language of Herald's
interface.

## Decision

Propose Paraglide JS, configured through inlang, as the web localization
foundation.

- The initial interface locales are `en` and `fr`; English is the base locale.
- Messages live in `apps/web/messages/{locale}.json` and are compiled into
  typed message functions as part of the web build, test, and typecheck
  lifecycle.
- The initial locale strategy is `localStorage`, then the browser's preferred
  language, then the base locale. The current authenticated dashboard does not
  add locale-prefixed URLs; localized public/documentation routes can make a
  separate routing decision later.
- `LanguageProvider` owns client reactivity and synchronizes `document.lang`
  and `document.dir` when the locale changes. The switcher uses the shared Base
  UI menu primitives without relying on a radio-group context for this simple
  choice.
- New user-facing interface copy must use stable message identifiers. Dates,
  numbers, plural/select forms, and accessible labels belong in the same
  message/formatting boundary rather than ad hoc component strings.
- The user's browser preference is deliberately local for this foundation. An
  account-synchronized preference is a later product decision and must define
  precedence between account, browser, and explicit session choices.
- Publication bodies, titles, and provider payloads remain untouched by this
  interface localization layer.

## Alternatives considered

### React i18next

React i18next is a mature runtime solution with a broad ecosystem, provider
integration, and lazy translation backends. It remains a credible alternative
if Herald later needs a large runtime-managed catalog or a more extensive
plugin ecosystem. It was not selected for this foundation because its runtime
instance and string-key conventions provide less compile-time and tree-shaking
guidance for this small Vite SPA.

### FormatJS / React Intl

FormatJS provides strong ICU MessageFormat and `Intl`-based formatting
primitives. It remains a credible choice if complex locale-aware formatting
becomes the dominant requirement. It was not selected as the first boundary
because it introduces a runtime provider/formatter model before Herald has
established its catalog and product-copy conventions.

### Hand-written dictionaries

A local dictionary helper would have the smallest immediate dependency surface,
but it would leave extraction, message validation, formatting, and agent/tooling
conventions to Herald. That is acceptable for a throwaway prototype, not for a
long-lived product whose UI copy will grow across several clients.

### Elysia i18n middleware or API-side translation

Elysia has community i18n integrations and request-header/context primitives,
but the authenticated SPA owns the interactive UI and already receives stable
API error codes. Adding server-side translated prose now would duplicate the
catalog boundary and make API/CLI behavior less deterministic. Server locale
negotiation can be added later for server-rendered messages or email-like
outputs without replacing the client foundation.

### Locale-prefixed TanStack Router paths

TanStack Router is library-agnostic and can type locale path parameters. This
is useful for public pages, documentation, and shareable localized URLs. The
authenticated workspace does not need locale in its URL yet, so the route
shape remains stable while the future public surface can adopt it deliberately.

## Consequences

Positive:

- Message usage is typed and visible in application code rather than hidden in
  a generic runtime lookup.
- The build can tree-shake generated messages and keep the initial catalog
  small; adding many locales can later be evaluated against code splitting or
  lazy catalog loading.
- Locale switching, browser preference, document language, and direction have
  one explicit owner.
- The approach has an official Vite integration and an official TanStack Router
  example, reducing integration guesswork for future agents.

Costs and risks:

- A build-time compiler and inlang project files become part of the web
  toolchain. The current message-format plugin is pinned by version but loaded
  from its official package URL during compilation; a future hardening pass may
  vendor or otherwise make that build input fully local if offline/reproducible
  builds require it.
- The current foundation does not translate every existing component. Migrating
  the product copy and introducing shared date/number formatters is a separate
  task, tracked as I18N-99.
- `setLocale(..., { reload: false })` requires the provider to own React
  reactivity and document synchronization. A future SSR/public surface should
  revisit the strategy instead of copying this client-only escape hatch.
- Local browser preference is not synchronized across devices or users until a
  persisted account preference is explicitly designed.

## Verification plan

- Compile the catalogs during web build, typecheck, and test commands.
- Test translated message functions directly for both supported locales.
- Exercise the selector in a real browser, including keyboard/accessibility
  semantics and an English-to-French switch without a page reload.
- Measure the generated web bundle before expanding the locale set or choosing
  lazy loading.

## References

- TanStack Router internationalization: https://tanstack.com/router/latest/docs/guide/internationalization-i18n
- Paraglide Vite integration: https://paraglidejs.com/vite
- Paraglide TanStack Router integration: https://paraglidejs.com/tanstack-router
- Paraglide locale strategies: https://paraglidejs.com/strategy
- inlang documentation: https://inlang.com/documentation
- i18next TypeScript and loading guidance: https://www.i18next.com/overview/typescript
- FormatJS React Intl: https://formatjs.github.io/docs/react-intl/
- Elysia plugin overview: https://elysiajs.com/plugins/overview

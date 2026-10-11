# Herald public site

Keep this workspace statically exportable. It has no production Node server,
authentication, or access to the application database. Search uses the exported
Fumadocs index. Motion is optional presentation and respects reduced motion.

`content/docs/installation.mdx` is generated from the canonical
`docs/deployment/self-hosting.md`; edit that guide instead. Run `sync:content`
before developing, typechecking, or building.

The landing page is a design candidate, not an accepted replacement for the
application design system. Do not publish the site or invent release claims.

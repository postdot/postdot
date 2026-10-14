# Postbot public site

Keep this workspace statically exportable. It has no production Node server,
authentication, or access to the application database. Search uses the exported
Fumadocs index. Motion is optional presentation and respects reduced motion.

`content/docs/installation.mdx` is generated from the canonical
`docs/deployment/self-hosting.md`; edit that guide instead. Run `sync:content`
before developing, typechecking, or building.

The landing page is a design candidate, not an accepted replacement for the
application design system. Do not publish the site or invent release claims.

The owner rejected the SITE-403 landing sections and copy as filler. They are
not approved public messaging. Never use Unicode arrows instead of Solar icons.
Continue visual work without treating the existing sections as editorial direction.

For local review of the actual static output, run `bun run build` then
`bun run preview` in this workspace. The preview binds to 127.0.0.1:5174 and
serves the exported not-found page with a 404 status. It is a development helper,
not a production server or a deployment change.

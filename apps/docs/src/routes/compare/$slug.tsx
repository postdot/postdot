import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/compare/$slug')({
    beforeLoad: ({ params }) => {
        throw redirect({
            to: '/alternatives/$slug',
            params: { slug: params.slug },
            statusCode: 301,
        })
    },
})

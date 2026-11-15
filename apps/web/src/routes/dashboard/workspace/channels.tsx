import { createFileRoute, redirect } from '@tanstack/react-router'

/** Keep existing bookmarks while Channels owns both scopes. */
export const Route = createFileRoute('/dashboard/workspace/channels')({
    beforeLoad: ({ search }) => {
        throw redirect({
            to: '/dashboard/channels',
            search: { ...search, scope: 'workspace' },
            replace: true,
        })
    },
})

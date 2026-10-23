export default function Glyph({
    action,
}: {
    readonly action: 'reply' | 'repost' | 'like' | 'share'
}) {
    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round">
            {action === 'reply' ? (
                <path d="M12 3C6.8 3 3 6.3 3 10.8c0 3.5 2.5 6.4 6.2 7.4V22l5-3.6c4-.6 6.8-3.6 6.8-7.6C21 6.3 17.2 3 12 3Z" />
            ) : action === 'repost' ? (
                <>
                    <path d="m3 7 3-3 3 3M6 4v12a3 3 0 0 0 3 3h4" />
                    <path d="m21 17-3 3-3-3M18 20V8a3 3 0 0 0-3-3h-4" />
                </>
            ) : action === 'like' ? (
                <path d="M12 21S2 15.5 2 8.5C2 3.2 8.4 1.5 12 6c3.6-4.5 10-2.8 10 2.5C22 15.5 12 21 12 21Z" />
            ) : (
                <>
                    <path d="M12 16V3m-4 4 4-4 4 4" />
                    <path d="M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
                </>
            )}
        </svg>
    )
}

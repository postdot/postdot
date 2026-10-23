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
            strokeWidth="1.8"
            strokeLinejoin="round">
            {action === 'like' ? (
                <path d="M7 10v11H3V10h4Zm0 0 5-7c1-1 3 0 3 2l-1 5h5c2 0 3 1 2 3l-2 7H7" />
            ) : action === 'reply' ? (
                <path d="M4 4h16v12H9l-5 4V4Z" />
            ) : action === 'repost' ? (
                <>
                    <path d="m4 8 4-4 4 4M8 4v12h5" />
                    <path d="m20 16-4 4-4-4M16 20V8h-5" />
                </>
            ) : (
                <path d="m3 3 18 9-18 9 4-9-4-9Zm4 9h14" />
            )}
        </svg>
    )
}

import * as m from '@/paraglide/messages.js'

import Glyph from './preview-glyph'

export default function Footer() {
    return (
        <>
            <span className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
                <Glyph action="like" />
                {m.publication_preview_like()}
            </span>
            <span className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
                <Glyph action="reply" />
                {m.publication_preview_comment()}
            </span>
            <span className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
                <Glyph action="repost" />
                {m.publication_preview_repost()}
            </span>
            <span className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
                <Glyph action="share" />
                {m.publication_preview_share()}
            </span>
        </>
    )
}

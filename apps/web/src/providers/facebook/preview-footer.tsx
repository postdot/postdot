import { ChatRoundIcon } from '@solar-icons/react/linear/chat-round'
import { ShareIcon } from '@solar-icons/react/linear/share'

import * as m from '@/paraglide/messages.js'

import Glyph from '../linkedin/preview-glyph'

export default function Footer() {
    return (
        <>
            <span className="flex items-center gap-1.5">
                <Glyph action="like" />
                {m.publication_preview_like()}
            </span>
            <span className="flex items-center gap-1.5">
                <ChatRoundIcon aria-hidden="true" />
                {m.publication_preview_comment()}
            </span>
            <span className="flex items-center gap-1.5">
                <ShareIcon aria-hidden="true" />
                {m.publication_preview_share()}
            </span>
        </>
    )
}

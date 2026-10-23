import { HeartIcon } from '@solar-icons/react/linear/heart'

import * as m from '@/paraglide/messages.js'

import Glyph from './preview-glyph'
export default function SampleEngagement() {
    return (
        <div
            data-publication-preview-sample-engagement="true"
            role="img"
            aria-label={m.publication_preview_sample_engagement_a11y()}
            title={m.publication_preview_sample_engagement_a11y()}
            className="mx-3 flex items-center justify-between gap-2 border-b border-[#e7e9eb] pb-1.5 text-[11px] text-[#666c72]">
            <span aria-hidden="true" className="flex items-center gap-1.5">
                <span className="flex -space-x-1">
                    <span className="flex size-4 items-center justify-center rounded-full border border-white bg-[#0a66c2] text-white">
                        <Glyph action="like" />
                    </span>
                    <span className="flex size-4 items-center justify-center rounded-full border border-white bg-[#e66d74] text-white">
                        <HeartIcon className="size-2.5" />
                    </span>
                </span>
                2
            </span>
            <span aria-hidden="true" className="truncate">
                {m.publication_preview_sample_activity()}
            </span>
        </div>
    )
}

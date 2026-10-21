import { Alert, AlertDescription, AlertTitle } from '@postdot/ui/components/alert'
import { Button } from '@postdot/ui/components/button'

import type { PostbotMediaUppyFile } from '@/lib/postbot-media-upload'
import * as m from '@/paraglide/messages.js'

export function MediaUploadRecoveryNotice({
    files,
    missingFileCount,
    onDismiss,
    onReselectMissing,
    onResume,
    pending,
}: {
    readonly files: readonly PostbotMediaUppyFile[]
    readonly missingFileCount: number
    readonly onDismiss: () => void
    readonly onReselectMissing: () => void
    readonly onResume: () => void
    readonly pending: boolean
}) {
    const recoverableFileCount = Math.max(0, files.length - missingFileCount)

    return (
        <Alert
            data-media-upload-recovery="true"
            className="mb-4 border-state-attention/35 bg-state-attention/10">
            <AlertTitle>{m.media_recovery_title()}</AlertTitle>
            <AlertDescription>
                <p>{m.media_recovery_description({ count: files.length })}</p>
                {missingFileCount > 0 ? (
                    <p className="mt-1 text-state-attention">
                        {m.media_recovery_missing({ count: missingFileCount })}
                    </p>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    {recoverableFileCount > 0 ? (
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={pending}
                            onClick={onResume}>
                            {m.media_recovery_resume()}
                        </Button>
                    ) : null}
                    {missingFileCount > 0 ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={onReselectMissing}>
                            {m.media_recovery_reselect()}
                        </Button>
                    ) : null}
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={onDismiss}>
                        {m.media_recovery_dismiss()}
                    </Button>
                </div>
            </AlertDescription>
        </Alert>
    )
}

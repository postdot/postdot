export const mediaImportSourceIds = ['device', 'webcam', 'url'] as const

export type MediaImportSourceId = (typeof mediaImportSourceIds)[number]

export type MediaImportSourceTransfer = 'browser' | 'server'

export interface MediaImportSourceDefinition {
    readonly id: MediaImportSourceId
    readonly transfer: MediaImportSourceTransfer
    readonly requiresAuthentication: boolean
}

export const mediaImportSourceDefinitions: Readonly<
    Record<MediaImportSourceId, MediaImportSourceDefinition>
> = {
    device: {
        id: 'device',
        transfer: 'browser',
        requiresAuthentication: false,
    },
    webcam: {
        id: 'webcam',
        transfer: 'browser',
        requiresAuthentication: false,
    },
    url: {
        id: 'url',
        transfer: 'server',
        requiresAuthentication: false,
    },
}

/** Legacy buffers cannot establish ownership once a draft has adopted a profile. */
export function recoveryProfileMatches(
    buffer: { readonly profileVersionId?: string },
    editor: {
        readonly draft: { readonly profileVersionId: string }
        readonly adoptionCount?: number
    }
): boolean {
    return buffer.profileVersionId === undefined
        ? (editor.adoptionCount ?? 0) === 0
        : buffer.profileVersionId === editor.draft.profileVersionId
}

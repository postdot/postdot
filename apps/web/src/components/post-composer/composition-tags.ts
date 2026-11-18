export function sharedPublicationTags(sets: readonly (readonly string[])[]) {
    return sets[0]?.filter(id => sets.every(tags => tags.includes(id))) ?? []
}

/** A shared edit changes common assignments without erasing a channel's own tags. */
export function changeSharedPublicationTags(
    current: readonly string[],
    before: readonly string[],
    next: readonly string[]
) {
    return [
        ...new Set([...current.filter(id => !before.includes(id) || next.includes(id)), ...next]),
    ]
}

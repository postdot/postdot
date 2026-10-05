/**
 * Reading helpers for the event-stream tests.
 *
 * Every stream now opens with exactly one comment frame so the connection is
 * established immediately. That frame is always the first chunk, because the
 * stream writes it while it is being constructed and every later frame is
 * queued behind it.
 *
 * So the rule is narrow on purpose: step over one chunk, then return everything
 * exactly as written. Treating every comment as skippable would be wrong, since
 * a heartbeat is also a comment and must stay visible to the tests that assert
 * on it.
 */

export interface ReadChunk {
    readonly done: boolean
    readonly text: string
}

type ChunkReader = { read: () => Promise<{ done: boolean; value?: Uint8Array }> }

const readersPastOpeningComment = new WeakSet<ChunkReader>()

function decode(result: { done: boolean; value?: Uint8Array }): string {
    return result.value === undefined ? '' : new TextDecoder().decode(result.value)
}

/** Reads the opening comment frame itself. */
export async function readOpeningComment(reader: ChunkReader): Promise<ReadChunk> {
    const result = await reader.read()
    readersPastOpeningComment.add(reader)
    return { done: result.done, text: decode(result) }
}

/**
 * Reads the next chunk, skipping the stream's single opening comment frame.
 * Every later chunk, heartbeat included, is returned as written.
 */
export async function readFrame(reader: ChunkReader): Promise<ReadChunk> {
    if (!readersPastOpeningComment.has(reader)) await readOpeningComment(reader)
    const result = await reader.read()
    return { done: result.done, text: decode(result) }
}

/** Reads exactly `count` chunks after the stream's opening comment frame. */
export async function readFrames(reader: ChunkReader, count: number): Promise<string> {
    let text = ''
    for (let index = 0; index < count; index += 1) {
        const chunk = await readFrame(reader)
        if (chunk.done) break
        text += chunk.text
    }
    return text
}

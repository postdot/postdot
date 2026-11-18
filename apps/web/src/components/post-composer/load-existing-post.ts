import { api, type Post, type PublicationEditorState, type PublicationSummary } from '@/lib/api'
import { loadPostPublications } from '@/lib/post-publications'

/**
 * Kept apart from the editor: route loaders import it, and a loader belongs to the
 * application entry, which must not carry the editor.
 */
export interface ExistingPostData {
    readonly post: Post
    readonly editors: readonly PublicationEditorState[]
    readonly publications: readonly PublicationSummary[]
}

export async function loadExistingPost(
    projectId: string,
    postId: string,
    initialEditor?: PublicationEditorState
): Promise<ExistingPostData> {
    const [{ post }, publications] = await Promise.all([
        api.getPost(projectId, postId),
        loadPostPublications(projectId, postId),
    ])
    const editors = await Promise.all(
        publications.map(async publication =>
            publication.id === initialEditor?.publication.id
                ? initialEditor
                : (await api.getPublicationEditor(projectId, publication.id)).editor
        )
    )
    return { post, publications, editors }
}

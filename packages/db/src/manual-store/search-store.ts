import type { PostdotDatabase } from '../client'

export interface SearchResult {
    readonly kind: 'post' | 'channel' | 'project' | 'media'
    readonly id: string
    readonly projectId: string
    readonly projectName: string
    readonly title: string
    readonly description: string
    readonly contentType?: string | null
}

/** Callers supply the live authorized project set, never historical actors. */
export function createSearchStore(database: PostdotDatabase) {
    return {
        search(projectIds: readonly string[], query: string): SearchResult[] {
            if (projectIds.length === 0 || query.trim().length < 2) return []
            const parameters = projectIds.map(() => '?').join(',')
            const needle = query.trim()
            const results: SearchResult[] = []
            for (const kind of ['project', 'channel', 'post'] as const) {
                // Channels are workspace-owned; a project searches the ones it actively uses.
                const table =
                    kind === 'project'
                        ? 'projects'
                        : kind === 'channel'
                          ? 'project_channel_contexts'
                          : 'posts'
                const active = kind === 'channel' ? "and item.attachment_state = 'active'" : ''
                const title =
                    kind === 'post'
                        ? "coalesce(json_extract(item.source_content, '$.headline'), item.title, '')"
                        : 'item.name'
                const matchingTitle =
                    kind === 'post' ? `${title} || ' ' || coalesce(item.title, '')` : title
                const body =
                    kind === 'post'
                        ? "coalesce(json_extract(item.source_content, '$.body.text'), '')"
                        : "''"
                const projectColumn = kind === 'project' ? 'item.id' : 'item.project_id'
                const join =
                    kind === 'project'
                        ? ''
                        : 'join projects project on project.id = item.project_id'
                const projectName = kind === 'project' ? 'item.name' : 'project.name'
                const rows = database.$client
                    .query<Omit<SearchResult, 'kind'>, string[]>(`
                    select item.id, ${projectColumn} as projectId, ${projectName} as projectName,
                           ${title} as title, substr(${body}, 1, 180) as description
                    from ${table} item ${join}
                    where ${projectColumn} in (${parameters}) ${active}
                      and (instr(lower(${matchingTitle}), lower(?)) > 0 or instr(lower(${body}), lower(?)) > 0)
                    order by item.updated_at desc, item.id asc limit 10
                `)
                    .all(...projectIds, needle, needle)
                results.push(...rows.map(row => ({ ...row, kind })))
            }
            const media = database.$client
                .query<Omit<SearchResult, 'kind'>, string[]>(`
                select item.id, item.project_id as projectId, project.name as projectName,
                       item.original_filename as title,
                       coalesce(item.default_accessibility_text, '') as description,
                       (select coalesce(detected_content_type, declared_content_type)
                        from media_representations where asset_id = item.id
                          and state = 'ready' and kind = 'original' limit 1) as contentType
                from media_assets item join projects project on project.id = item.project_id
                where item.project_id in (${parameters}) and item.state = 'ready'
                  and item.archived_at is null
                  and (instr(lower(item.original_filename), lower(?)) > 0
                    or instr(lower(coalesce(item.default_accessibility_text, '')), lower(?)) > 0)
                order by item.updated_at desc, item.id asc limit 10
            `)
                .all(...projectIds, needle, needle)
            results.push(
                ...media.map(row => ({
                    ...row,
                    kind: 'media' as const,
                    description: row.description.slice(0, 180),
                }))
            )
            return results
        },
    }
}

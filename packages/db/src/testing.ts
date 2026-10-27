import type { PostbotDatabase } from './client'

/** Test fixture: an idempotent workspace row so projects can be created under the required ownership boundary. */
export function seedTestWorkspace(database: PostbotDatabase, id = 'test-workspace'): string {
    database.$client
        .query('insert or ignore into organization(id,name,slug,created_at) values (?1,?1,?1,1)')
        .run(id)
    database.$client
        .query(
            'insert or ignore into workspaces(id,organization_id,name,slug,created_at,updated_at) values (?1,?1,?1,?1,1,1)'
        )
        .run(id)
    return id
}

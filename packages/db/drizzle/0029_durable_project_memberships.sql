-- Backfill only a deterministic, recoverable owner. The migration runner also
-- retries this insert on later starts and fails closed for unresolved projects.
INSERT INTO project_memberships (
    id, project_id, user_id, role, state, created_at, updated_at
)
SELECT
    'project-membership:' || projects.id || ':' || actors.subject_id,
    projects.id,
    actors.subject_id,
    'owner',
    'active',
    actors.created_at,
    actors.updated_at
FROM projects
INNER JOIN actors
    ON actors.id = (
        SELECT candidate.id
        FROM actors AS candidate
        WHERE candidate.project_id = projects.id
          AND candidate.kind = 'human'
        ORDER BY candidate.created_at, candidate.id
        LIMIT 1
    )
INNER JOIN user AS users ON users.id = actors.subject_id
INNER JOIN instance_memberships
    ON instance_memberships.user_id = users.id
   AND instance_memberships.state = 'enabled'
WHERE NOT EXISTS (
    SELECT 1
    FROM project_memberships
    WHERE project_memberships.project_id = projects.id
)
ON CONFLICT DO NOTHING;

import { describe, expect, test } from 'bun:test'

import {
    auditEventSequenceHighWaterSql,
    containsCaseInsensitiveSql,
    deferForeignKeysSql,
    isResourceReadOnlyTriggerError,
    isUniqueConstraintError,
    jsonContainsTextScalarSql,
    jsonEachTextFromSql,
    jsonExtractIntSql,
    jsonExtractJsonTextSql,
    jsonExtractTextSql,
    jsonGroupArrayTextSql,
    normalizeStatementSql,
    nowMillisSql,
    scalarMaxSql,
} from './dialect'

describe('SQL dialect module', () => {
    test('translates numbered and unnumbered parameter placeholders per engine', () => {
        expect(
            normalizeStatementSql(
                'select * from posts where project_id = ?1 and id = ?2 or parent_id = ?1',
                'sqlite'
            )
        ).toBe('select * from posts where project_id = ?1 and id = ?2 or parent_id = ?1')

        expect(
            normalizeStatementSql(
                'select * from posts where project_id = ?1 and id = ?2 or parent_id = ?1',
                'postgres'
            )
        ).toBe('select * from posts where project_id = $1 and id = $2 or parent_id = $1')

        expect(
            normalizeStatementSql('select * from posts where project_id = ? and id = ?', 'sqlite')
        ).toBe('select * from posts where project_id = ?1 and id = ?2')

        expect(
            normalizeStatementSql('select * from posts where project_id = ? and id = ?', 'postgres')
        ).toBe('select * from posts where project_id = $1 and id = $2')
    })

    test('preserves question marks inside string literals, identifiers, and comments', () => {
        const sql = `
            -- comment with ?99 and ?
            /* block comment ?42 and ? */
            select 'literal ?2 with ''?'' escaped' as "col?1""?2"
            from items
            where id = ?1 and state = ?2
        `
        expect(normalizeStatementSql(sql, 'postgres')).toContain(
            `select 'literal ?2 with ''?'' escaped' as "col?1""?2"`
        )
        expect(normalizeStatementSql(sql, 'postgres')).toContain('where id = $1 and state = $2')
    })

    test('rejects mixed numbered and unnumbered placeholders, zero indices, and gaps', () => {
        expect(() =>
            normalizeStatementSql(
                'select * from publications where channel_id = ? and scheduled_at between ?2 and ?3',
                'sqlite'
            )
        ).toThrow(/cannot mix unnumbered/i)

        expect(() =>
            normalizeStatementSql(
                'select * from publications where channel_id = ?1 and state = ?',
                'postgres'
            )
        ).toThrow(/cannot mix unnumbered/i)

        expect(() =>
            normalizeStatementSql('select * from publications where channel_id = ?2', 'sqlite')
        ).toThrow(/missing \?1/i)

        expect(() =>
            normalizeStatementSql('select * from publications where id = ?0', 'sqlite')
        ).toThrow(/must start at 1/i)
    })

    test('generates dialect-specific JSON, scalar max, epoch, and introspection fragments', () => {
        expect(jsonExtractTextSql('sqlite', 'audit_events.metadata_json', ['provider'])).toBe(
            "json_extract(audit_events.metadata_json, '$.provider')"
        )
        expect(jsonExtractTextSql('postgres', 'audit_events.metadata_json', ['provider'])).toBe(
            "((audit_events.metadata_json)::jsonb ->> 'provider')"
        )
        expect(jsonExtractTextSql('postgres', 'posts.source_content', ['body', 'text'])).toBe(
            "((posts.source_content)::jsonb #>> '{body,text}')"
        )

        expect(jsonExtractIntSql('sqlite', 'e.destination_snapshot_json', ['revision'])).toBe(
            "json_extract(e.destination_snapshot_json, '$.revision')"
        )
        expect(jsonExtractIntSql('postgres', 'e.destination_snapshot_json', ['revision'])).toBe(
            "(((e.destination_snapshot_json)::jsonb ->> 'revision')::integer)"
        )

        expect(jsonExtractJsonTextSql('sqlite', 'snapshot_json', ['content'])).toBe(
            "json_extract(snapshot_json, '$.content')"
        )
        expect(jsonExtractJsonTextSql('postgres', 'snapshot_json', ['content'])).toBe(
            "(((snapshot_json)::jsonb -> 'content')::text)"
        )

        expect(jsonEachTextFromSql('sqlite', '?2', 'tag_elements')).toBe(
            'json_each(?2) as tag_elements'
        )
        expect(jsonEachTextFromSql('postgres', '?2', 'tag_elements')).toBe(
            'jsonb_array_elements_text((?2)::jsonb) as tag_elements(value)'
        )

        expect(jsonGroupArrayTextSql('sqlite', 'ordered_tags.tag_id')).toBe(
            'json_group_array(ordered_tags.tag_id)'
        )
        expect(jsonGroupArrayTextSql('postgres', 'ordered_tags.tag_id')).toBe(
            '(jsonb_agg(ordered_tags.tag_id)::text)'
        )

        expect(jsonContainsTextScalarSql('sqlite', 'posts.source_content', '?2')).toContain(
            'json_tree(posts.source_content)'
        )
        expect(jsonContainsTextScalarSql('postgres', 'posts.source_content', '?2')).toContain(
            'jsonb_path_exists((posts.source_content)::jsonb'
        )

        expect(containsCaseInsensitiveSql('sqlite', 'item.name', '?')).toBe(
            'instr(lower(item.name), lower(?)) > 0'
        )
        expect(containsCaseInsensitiveSql('postgres', 'item.name', '?')).toBe(
            'strpos(lower(item.name), lower(?)) > 0'
        )

        expect(scalarMaxSql('sqlite', 'a', 'b', 'c')).toBe('max(a, b, c)')
        expect(scalarMaxSql('postgres', 'a', 'b')).toBe(
            '(case when (a) is null or (b) is null then null else greatest(a, b) end)'
        )

        expect(nowMillisSql('sqlite')).toContain('unixepoch')
        expect(nowMillisSql('postgres')).toContain('clock_timestamp')
        expect(auditEventSequenceHighWaterSql('sqlite')).toContain('sqlite_sequence')
        expect(auditEventSequenceHighWaterSql('postgres')).toContain('pg_sequences')
        expect(deferForeignKeysSql('sqlite')).toBe('pragma defer_foreign_keys = on')
        expect(deferForeignKeysSql('postgres')).toBe('set constraints all deferred')
    })

    test('classifies unique constraint and read-only trigger errors across engines', () => {
        expect(isUniqueConstraintError(new Error('UNIQUE constraint failed: tags.name'))).toBe(true)
        expect(
            isUniqueConstraintError(
                new Error('duplicate key value violates unique constraint "tags_name_uidx"')
            )
        ).toBe(true)
        expect(
            isUniqueConstraintError(
                Object.assign(new Error('constraint failure'), { code: '23505' })
            )
        ).toBe(true)
        expect(isUniqueConstraintError(new Error('foreign key constraint failed'))).toBe(false)

        expect(isResourceReadOnlyTriggerError(new Error('resource_read_only'))).toBe(true)
        expect(isResourceReadOnlyTriggerError(new Error('ERROR: resource_read_only (P0001)'))).toBe(
            true
        )
        expect(isResourceReadOnlyTriggerError(new Error('other error'))).toBe(false)
    })
})

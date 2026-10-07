import type { ValidationIssue } from './validation'

/** Check only structural safety; semantic policy stays in the existing validators. */
export function channelProfileStructureIssues(value: unknown): readonly ValidationIssue[] {
    const issues: ValidationIssue[] = []
    const add = (path: string, type: string) => {
        issues.push({
            path,
            code: `profile.${type}_required`,
            message: `Expected ${type}`,
            severity: 'error',
            source: 'domain',
        })
    }
    const object = (value: unknown, path: string): Record<string, unknown> | undefined => {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
            add(path, 'object')
            return undefined
        }
        return value as Record<string, unknown>
    }
    const field = (
        record: Record<string, unknown>,
        key: string,
        path: string,
        type: 'string' | 'number' | 'boolean',
        optional = false
    ) => {
        if (optional && record[key] === undefined) return
        if (typeof record[key] !== type) add(`${path}/${key}`, type)
    }
    const array = (value: unknown, path: string, visit: (value: unknown, path: string) => void) => {
        if (!Array.isArray(value)) {
            add(path, 'array')
            return
        }
        for (const [index, item] of value.entries()) visit(item, `${path}/${index}`)
    }
    const strings = (value: unknown, path: string) =>
        array(value, path, (item, itemPath) => {
            if (typeof item !== 'string') add(itemPath, 'string')
        })
    const root = object(value, '')
    if (root === undefined) return issues
    for (const key of ['id', 'origin', 'schemaHash', 'profileHash']) field(root, key, '', 'string')
    field(root, 'version', '', 'number')
    object(root.contentSchema, '/contentSchema')
    array(root.fieldBindings, '/fieldBindings', (value, path) => {
        const binding = object(value, path)
        if (binding === undefined) return
        for (const key of ['id', 'semantic', 'path']) field(binding, key, path, 'string')
        if (binding.semantic === 'ordered_media') {
            const item = object(binding.item, `${path}/item`)
            if (item !== undefined) {
                field(item, 'assetIdPath', `${path}/item`, 'string')
                field(item, 'accessibilityTextPath', `${path}/item`, 'string', true)
            }
        }
    })
    const capabilities = object(root.capabilities, '/capabilities')
    if (capabilities !== undefined) {
        field(capabilities, 'revision', '/capabilities', 'string')
        array(capabilities.textFields, '/capabilities/textFields', (value, path) => {
            const capability = object(value, path)
            if (capability === undefined) return
            field(capability, 'bindingId', path, 'string')
            strings(capability.acceptedSourceFormats, `${path}/acceptedSourceFormats`)
            field(capability, 'maxLength', path, 'number')
            for (const key of ['minLength', 'maxGraphemes', 'maxWeightedLength'])
                field(capability, key, path, 'number', true)
            field(capability, 'weightedLengthAlgorithm', path, 'string', true)
        })
        array(capabilities.mediaFields, '/capabilities/mediaFields', (value, path) => {
            const capability = object(value, path)
            if (capability === undefined) return
            field(capability, 'bindingId', path, 'string')
            strings(capability.families, `${path}/families`)
            strings(capability.mimeTypes, `${path}/mimeTypes`)
            field(capability, 'maxItems', path, 'number')
            for (const key of ['minItems', 'maxBytesPerItem', 'maxTotalBytes'])
                field(capability, key, path, 'number', true)
            for (const key of ['accessibilityTextRequired', 'publicUrlRequired'])
                field(capability, key, path, 'boolean', true)
            for (const [key, fields] of [
                ['dimensions', ['minWidth', 'maxWidth', 'minHeight', 'maxHeight']],
                ['duration', ['minMilliseconds', 'maxMilliseconds']],
            ] as const) {
                if (capability[key] === undefined) continue
                const limits = object(capability[key], `${path}/${key}`)
                if (limits !== undefined)
                    for (const name of fields) field(limits, name, `${path}/${key}`, 'number', true)
            }
        })
        array(capabilities.relations, '/capabilities/relations', (value, path) => {
            const relation = object(value, path)
            if (relation !== undefined)
                for (const key of ['kind', 'bindingId', 'relatedBindingId'])
                    field(relation, key, path, 'string')
        })
    }
    const execution = object(root.execution, '/execution')
    if (execution !== undefined) {
        field(execution, 'kind', '/execution', 'string')
        if (execution.kind !== 'manual') {
            field(execution, 'contractId', '/execution', 'string')
            field(execution, 'revision', '/execution', 'string')
        }
    }
    return issues
}

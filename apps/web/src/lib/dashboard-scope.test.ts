import { describe, expect, test } from 'bun:test'

import { resolveDashboardScope } from './dashboard-scope'

const projects = [
    { id: 'a', workspaceId: 'one' },
    { id: 'b', workspaceId: 'two' },
]
const workspaces = [
    { id: 'one', isDefault: true },
    { id: 'two', isDefault: false },
]

describe('dashboard scope restoration', () => {
    test('restores the selected project and workspace from an optional-context link', () => {
        expect(
            resolveDashboardScope({
                projects,
                workspaces,
                remembered: { workspaceId: 'two', projectId: 'b' },
            })
        ).toEqual({ workspaceId: 'two', projectId: 'b' })
    })
    test('an explicit project overrides a remembered workspace', () => {
        expect(
            resolveDashboardScope({
                projects,
                workspaces,
                projectId: 'a',
                remembered: { workspaceId: 'two', projectId: 'b' },
            })
        ).toEqual({ workspaceId: 'one', projectId: 'a' })
    })
    test('an explicit directory or different workspace does not resurrect a project', () => {
        const remembered = { workspaceId: 'two', projectId: 'b' }
        expect(
            resolveDashboardScope({ projects, workspaces, remembered, projectId: 'none' })
        ).toEqual({ workspaceId: 'two', projectId: null })
        expect(
            resolveDashboardScope({ projects, workspaces, remembered, workspaceId: 'one' })
        ).toEqual({ workspaceId: 'one', projectId: null })
    })
    test('removed or inaccessible identities fall back to a current workspace', () => {
        expect(
            resolveDashboardScope({
                projects,
                workspaces,
                remembered: { workspaceId: 'removed', projectId: 'old' },
            })
        ).toEqual({ workspaceId: 'one', projectId: null })
        expect(
            resolveDashboardScope({
                projects: [],
                workspaces: [],
                remembered: { workspaceId: 'two', projectId: 'b' },
            })
        ).toEqual({ workspaceId: null, projectId: null })
    })
})

import { expect, test } from 'bun:test'

import { renderToStaticMarkup } from 'react-dom/server'

import {
    ApiKeyActionAccessFieldset,
    capabilityLabel,
    editableCapabilities,
    elevatedCapabilities,
} from './user-api-keys-actions'

test('exposes all 15 SPEC-012 capabilities with non-empty labels and elevated flags', () => {
    expect(editableCapabilities).toHaveLength(15)
    expect(editableCapabilities).toEqual(
        expect.arrayContaining([
            'project:access_manage',
            'publication:approve',
            'workspace:manage',
            'api_key:manage',
            'instance:admin',
        ])
    )
    for (const capability of editableCapabilities) {
        expect(capabilityLabel(capability).length).toBeGreaterThan(0)
    }
    expect(elevatedCapabilities.has('instance:admin')).toBe(true)
    expect(elevatedCapabilities.has('workspace:manage')).toBe(true)
    expect(elevatedCapabilities.has('api_key:manage')).toBe(true)
    expect(elevatedCapabilities.has('project:access_manage')).toBe(true)
    expect(elevatedCapabilities.has('project:read')).toBe(false)
})

test('renders elevated badges, admin-role gating, all-projects requirement, and anti-escalation notices', () => {
    const restrictedMemberHtml = renderToStaticMarkup(
        <ApiKeyActionAccessFieldset
            isInstanceAdmin={false}
            name="test-restricted"
            onCapabilitiesChange={() => {}}
            onScopeChange={() => {}}
            projectScope="selected"
            scope="selected"
            selectedCapabilities={['workspace:manage', 'api_key:manage']}
        />
    )

    expect(restrictedMemberHtml).toContain('Elevated')
    expect(restrictedMemberHtml).toContain('Requires instance administrator role')
    expect(restrictedMemberHtml).toContain('disabled=""')
    expect(restrictedMemberHtml).toContain('All projects')
    expect(restrictedMemberHtml).toContain('cannot grant wider projects or actions')

    const adminAllHtml = renderToStaticMarkup(
        <ApiKeyActionAccessFieldset
            isInstanceAdmin={true}
            name="test-admin"
            onCapabilitiesChange={() => {}}
            onScopeChange={() => {}}
            projectScope="all"
            scope="all"
            selectedCapabilities={[]}
        />
    )

    expect(adminAllHtml).toContain('Bounded by your live roles')
    expect(adminAllHtml).not.toContain('Requires instance administrator role')
})

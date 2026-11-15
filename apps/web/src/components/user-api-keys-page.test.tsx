import { expect, test } from 'bun:test'

import { renderToStaticMarkup } from 'react-dom/server'

import {
    ApiKeyActionAccessFieldset,
    capabilityLabel,
    editableCapabilities,
} from './user-api-keys-actions'

test('exposes all 15 SPEC-012 capabilities with non-empty labels', () => {
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
})

test('renders admin-role gating, all-projects requirement, and single-sentence anti-escalation notice without unexplained badges', () => {
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

    expect(restrictedMemberHtml).not.toContain('Elevated')
    expect(restrictedMemberHtml).not.toContain('Sensitive')
    expect(restrictedMemberHtml).toContain('Requires installation administrator role')
    expect(restrictedMemberHtml).toContain('disabled=""')
    expect(restrictedMemberHtml).toContain('All projects')
    expect(restrictedMemberHtml).toContain('A key can never do more than you can.')

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

    expect(adminAllHtml).toContain('A key can never do more than you can.')
    expect(adminAllHtml).not.toContain('Requires installation administrator role')
})

import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements, memberAc, ownerAc } from 'better-auth/plugins/organization/access'

/**
 * Herald keeps the organization plugin's native permissions and adds the
 * domain resources that will be used when project authorization moves onto
 * Better Auth. Keeping this in one module makes the server configuration,
 * CLI schema generation, and future client checks share the same vocabulary.
 */
export const heraldOrganizationStatement = {
    ...defaultStatements,
    project: ['read', 'create', 'update', 'delete'],
    publication: ['read', 'create', 'update', 'delete', 'publish'],
    channel: ['read', 'create', 'update', 'delete'],
    media: ['read', 'create', 'delete'],
    apiKey: ['read', 'create', 'delete', 'revoke'],
} as const

export const heraldOrganizationAccess = createAccessControl(heraldOrganizationStatement)

export const heraldOrganizationRoles = {
    owner: heraldOrganizationAccess.newRole({
        ...ownerAc.statements,
        project: ['read', 'create', 'update', 'delete'],
        publication: ['read', 'create', 'update', 'delete', 'publish'],
        channel: ['read', 'create', 'update', 'delete'],
        media: ['read', 'create', 'delete'],
        apiKey: ['read', 'create', 'delete', 'revoke'],
    }),
    editor: heraldOrganizationAccess.newRole({
        ...memberAc.statements,
        project: ['read'],
        publication: ['read', 'create', 'update', 'publish'],
        channel: ['read', 'create', 'update'],
        media: ['read', 'create'],
    }),
    viewer: heraldOrganizationAccess.newRole({
        ...memberAc.statements,
        project: ['read'],
        publication: ['read'],
        channel: ['read'],
        media: ['read'],
    }),
} as const

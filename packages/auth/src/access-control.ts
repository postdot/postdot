import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements, memberAc, ownerAc } from 'better-auth/plugins/organization/access'

/**
 * Postbot keeps the organization plugin's native permissions and adds the
 * domain resources that will be used when project authorization moves onto
 * Better Auth. Keeping this in one module makes the server configuration,
 * CLI schema generation, and future client checks share the same vocabulary.
 */
export const postbotOrganizationStatement = {
    ...defaultStatements,
    project: ['read', 'create', 'update', 'delete'],
    publication: ['read', 'create', 'update', 'delete', 'publish'],
    channel: ['read', 'create', 'update', 'delete'],
    media: ['read', 'create', 'delete'],
    apiKey: ['read', 'create', 'delete', 'revoke'],
} as const

export const postbotOrganizationAccess = createAccessControl(postbotOrganizationStatement)

export const postbotOrganizationRoles = {
    owner: postbotOrganizationAccess.newRole({
        ...ownerAc.statements,
        project: ['read', 'create', 'update', 'delete'],
        publication: ['read', 'create', 'update', 'delete', 'publish'],
        channel: ['read', 'create', 'update', 'delete'],
        media: ['read', 'create', 'delete'],
        apiKey: ['read', 'create', 'delete', 'revoke'],
    }),
    editor: postbotOrganizationAccess.newRole({
        ...memberAc.statements,
        project: ['read'],
        publication: ['read', 'create', 'update', 'publish'],
        channel: ['read', 'create', 'update'],
        media: ['read', 'create'],
    }),
    viewer: postbotOrganizationAccess.newRole({
        ...memberAc.statements,
        project: ['read'],
        publication: ['read'],
        channel: ['read'],
        media: ['read'],
    }),
} as const

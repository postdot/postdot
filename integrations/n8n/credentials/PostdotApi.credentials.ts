import type {
    Icon,
    IAuthenticateGeneric,
    ICredentialTestRequest,
    ICredentialType,
    INodeProperties,
} from 'n8n-workflow'

export class PostdotApi implements ICredentialType {
    name = 'postdotApi'
    displayName = 'Postdot API'
    icon: Icon = {
        light: 'file:../nodes/Postdot/postdot.svg',
        dark: 'file:../nodes/Postdot/postdot.dark.svg',
    }
    documentationUrl = 'https://postdot.app/docs/n8n/'
    properties: INodeProperties[] = [
        {
            displayName: 'Postdot URL',
            name: 'url',
            type: 'string',
            default: '',
            required: true,
            placeholder: 'https://postdot.example',
            description: 'Origin of your Postdot instance, without /api or a trailing path',
        },
        {
            displayName: 'API Key',
            name: 'apiKey',
            type: 'string',
            default: '',
            required: true,
            typeOptions: { password: true },
            description:
                'A project-scoped key with project:read and publication:manage. No dispatch permission is needed.',
        },
    ]
    authenticate: IAuthenticateGeneric = {
        type: 'generic',
        properties: { headers: { Authorization: '={{ "Bearer " + $credentials.apiKey }}' } },
    }
    test: ICredentialTestRequest = {
        request: {
            baseURL: '={{ $credentials.url.replace(/\\/+$/, "") }}',
            url: '/api/projects',
            method: 'GET',
            disableFollowRedirect: true,
        },
    }
}

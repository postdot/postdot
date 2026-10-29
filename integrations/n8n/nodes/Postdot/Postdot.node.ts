import { NodeConnectionTypes } from 'n8n-workflow'
import type { INodeType, INodeTypeDescription } from 'n8n-workflow'

export class Postdot implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Postdot',
        name: 'postdot',
        icon: { light: 'file:postdot.svg', dark: 'file:postdot.dark.svg' },
        group: ['transform'],
        version: 1,
        subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
        description: 'Prepare publication drafts and read Postdot projects, channels, and outcomes',
        defaults: { name: 'Postdot' },
        usableAsTool: true,
        inputs: [NodeConnectionTypes.Main],
        outputs: [NodeConnectionTypes.Main],
        credentials: [{ name: 'postdotApi', required: true }],
        requestDefaults: {
            baseURL: '={{ $credentials.url.replace(/\\/+$/, "") }}',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            disableFollowRedirect: true,
            timeout: 30000,
        },
        properties: [
            {
                displayName: 'Resource',
                name: 'resource',
                type: 'options',
                noDataExpression: true,
                options: [
                    { name: 'Channel', value: 'channel' },
                    { name: 'Post', value: 'post' },
                    { name: 'Project', value: 'project' },
                    { name: 'Publication', value: 'publication' },
                ],
                default: 'post',
            },
            {
                displayName: 'Operation',
                name: 'operation',
                type: 'options',
                noDataExpression: true,
                displayOptions: { show: { resource: ['project'] } },
                options: [
                    {
                        name: 'Get Many',
                        value: 'getMany',
                        action: 'Get many projects',
                        description: 'List accessible active projects',
                        routing: {
                            request: { method: 'GET', url: '/api/projects' },
                            output: {
                                postReceive: [
                                    { type: 'rootProperty', properties: { property: 'projects' } },
                                ],
                            },
                        },
                    },
                ],
                default: 'getMany',
            },
            {
                displayName: 'Operation',
                name: 'operation',
                type: 'options',
                noDataExpression: true,
                displayOptions: { show: { resource: ['channel'] } },
                options: [
                    {
                        name: 'Get Many',
                        value: 'getMany',
                        action: 'Get many channels',
                        description: 'List channels attached to a project',
                        routing: {
                            request: {
                                method: 'GET',
                                url: '=/api/projects/{{encodeURIComponent($parameter.projectId)}}/channels',
                            },
                            output: {
                                postReceive: [
                                    { type: 'rootProperty', properties: { property: 'channels' } },
                                ],
                            },
                        },
                    },
                ],
                default: 'getMany',
            },
            {
                displayName: 'Operation',
                name: 'operation',
                type: 'options',
                noDataExpression: true,
                displayOptions: { show: { resource: ['post'] } },
                options: [
                    {
                        name: 'Create Draft',
                        value: 'createDraft',
                        action: 'Create a draft',
                        description: 'Create a source post and one unscheduled text publication',
                        routing: {
                            request: {
                                method: 'POST',
                                url: '=/api/projects/{{encodeURIComponent($parameter.projectId)}}/posts',
                                body: {
                                    sourceContent:
                                        '={{ { body: { format: "plain_text", text: $parameter.text }, media: [] } }}',
                                    publications:
                                        '={{ [{ channelId: $parameter.channelId, deliveryMode: $parameter.deliveryMode }] }}',
                                },
                            },
                        },
                    },
                ],
                default: 'createDraft',
            },
            {
                displayName: 'Operation',
                name: 'operation',
                type: 'options',
                noDataExpression: true,
                displayOptions: { show: { resource: ['publication'] } },
                options: [
                    {
                        name: 'Get',
                        value: 'get',
                        action: 'Get a publication',
                        description:
                            'Read current state, draft, selected target, and recorded outcome',
                        routing: {
                            request: {
                                method: 'GET',
                                url: '=/api/projects/{{encodeURIComponent($parameter.projectId)}}/publications/{{encodeURIComponent($parameter.publicationId)}}/editor',
                            },
                            output: {
                                postReceive: [
                                    { type: 'rootProperty', properties: { property: 'editor' } },
                                ],
                            },
                        },
                    },
                ],
                default: 'get',
            },
            {
                displayName: 'Project Name or ID',
                name: 'projectId',
                type: 'options',
                default: '',
                required: true,
                typeOptions: {
                    loadOptions: {
                        routing: {
                            request: { method: 'GET', url: '/api/projects' },
                            output: {
                                postReceive: [
                                    { type: 'rootProperty', properties: { property: 'projects' } },
                                    {
                                        type: 'setKeyValue',
                                        properties: {
                                            name: '={{$responseItem.name}}',
                                            value: '={{$responseItem.id}}',
                                        },
                                    },
                                ],
                            },
                        },
                    },
                },
                displayOptions: { show: { resource: ['channel', 'post', 'publication'] } },
                description: 'Choose from the list, or specify an ID using an expression',
            },
            {
                displayName: 'Channel Name or ID',
                name: 'channelId',
                type: 'options',
                default: '',
                required: true,
                typeOptions: {
                    loadOptionsDependsOn: ['projectId'],
                    loadOptions: {
                        routing: {
                            request: {
                                method: 'GET',
                                url: '=/api/projects/{{encodeURIComponent($parameter.projectId)}}/channels',
                            },
                            output: {
                                postReceive: [
                                    { type: 'rootProperty', properties: { property: 'channels' } },
                                    {
                                        type: 'setKeyValue',
                                        properties: {
                                            name: '={{$responseItem.name}}',
                                            value: '={{$responseItem.id}}',
                                        },
                                    },
                                ],
                            },
                        },
                    },
                },
                displayOptions: { show: { resource: ['post'] } },
                description:
                    'Choose from the list, or specify an ID using an expression. Postdot adapts the text to this destination.',
            },
            {
                displayName: 'Text',
                name: 'text',
                type: 'string',
                typeOptions: { rows: 5 },
                default: '',
                required: true,
                displayOptions: { show: { resource: ['post'] } },
                description:
                    'Plain text to prepare for review. Destination validation may require further editing in Studio.',
            },
            {
                displayName: 'Delivery Mode',
                name: 'deliveryMode',
                type: 'options',
                default: 'automatic',
                displayOptions: { show: { resource: ['post'] } },
                options: [
                    {
                        name: 'Automatic',
                        value: 'automatic',
                        description: 'For a connected publishing destination',
                    },
                    {
                        name: 'Manual',
                        value: 'manual',
                        description: 'For a destination published by a person',
                    },
                ],
                description:
                    'Eventual delivery method. This operation saves an unscheduled draft in either mode.',
            },
            {
                displayName:
                    'This creates a draft, not a delivery. Keep Retry On Fail off: a lost response may still have saved a draft. Inspect Studio before repeating an uncertain creation.',
                name: 'draftNotice',
                type: 'notice',
                default: '',
                displayOptions: { show: { resource: ['post'] } },
            },
            {
                displayName: 'Publication ID',
                name: 'publicationId',
                type: 'string',
                default: '',
                required: true,
                displayOptions: { show: { resource: ['publication'] } },
                description: 'Publication ID returned by Create Draft, or copied from Studio',
            },
        ],
    }
}

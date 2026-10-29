import { CodeSquareIcon } from '@solar-icons/react/linear/code-square'
import N8n from '~icons/logos/n8n-icon'

import { PostdotLogo } from './brand'
import { DotField } from './dot-field/dot-field'
import type { FieldScene } from './dot-field/engine'

import './workflow-illustration.css'

const workflowScene: FieldScene = {
    cycle: 5.6,
    routes: [
        { from: 'trigger', to: 'hub', toEdge: 'top', at: 0, travel: 1.1, ripple: 'draft' },
        { from: 'hub', fromEdge: 'bottom', to: 'draft', at: 1.3, travel: 1.3, ripple: 'draft' },
    ],
}

/** Preserve the curved particle links without the background dot grid. */
export function WorkflowIllustration() {
    return (
        <DotField
            scene={workflowScene}
            grid="none"
            fill
            className="dot-field-bare workflow-illustration"
            label="A trigger passes through n8n to create a Postdot draft. This integration is planned.">
            <div data-field-node="trigger" className="field-card workflow-trigger">
                <CodeSquareIcon size={30} />
            </div>
            <span className="workflow-label workflow-label-trigger">Trigger</span>
            <div data-field-node="hub" className="field-card workflow-hub">
                <N8n />
            </div>
            <div data-field-node="draft" className="field-card workflow-draft">
                <PostdotLogo />
            </div>
            <span className="workflow-label workflow-label-draft">Create a draft</span>
        </DotField>
    )
}

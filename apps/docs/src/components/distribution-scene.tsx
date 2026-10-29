import { ClockCircleIcon } from '@solar-icons/react/linear/clock-circle'
import { useMemo, useSyncExternalStore } from 'react'
import Bluesky from '~icons/logos/bluesky'
import LinkedIn from '~icons/logos/linkedin-icon'
import X from '~icons/logos/x'

import { DotField } from './dot-field/dot-field'
import type { FieldScene } from './dot-field/engine'

import './distribution-scene.css'

const targets = [
    {
        id: 'x',
        name: 'X',
        logo: <X />,
        time: '18:00',
        text: 'New 32 km coastal route. Less traffic, more coastline. Saturday, 9 am.',
    },
    {
        id: 'linkedin',
        name: 'LinkedIn',
        logo: <LinkedIn />,
        time: '12:30',
        text: 'Northline’s new 32 km weekend route is ready: less traffic, more coastline. We roll out Saturday at 9. Bring a friend.',
        image: true,
    },
    {
        id: 'bluesky',
        name: 'Bluesky',
        logo: <Bluesky />,
        time: '09:00',
        text: 'Less traffic. More coastline. Our 32 km weekend route is ready.',
    },
]

function useNarrow() {
    return useSyncExternalStore(
        notify => {
            const query = window.matchMedia('(max-width: 640px)')
            query.addEventListener('change', notify)
            return () => query.removeEventListener('change', notify)
        },
        () => window.matchMedia('(max-width: 640px)').matches,
        () => false
    )
}

/** One post leaves the source on its own route for every destination, each with its own copy and time. */
export function DistributionScene() {
    const narrow = useNarrow()
    const scene = useMemo<FieldScene>(
        () => ({
            cycle: 8,
            routes: targets.map((target, index) => ({
                from: 'source',
                to: target.id,
                fromEdge: narrow ? 'bottom' : 'right',
                toEdge: narrow ? 'top' : 'left',
                at: index * 0.55,
                travel: 2,
                ripple: 'queued',
            })),
        }),
        [narrow]
    )
    return (
        <DotField
            scene={scene}
            className="dot-field-bare distribution-scene"
            label="One source post branches into three destination versions, each with its own copy and scheduled time: 18:00, 12:30 and 09:00. Content and times are illustrative.">
            <div className="distribution-scene-layout">
                <div data-field-node="source" className="field-card distribution-source">
                    <p className="distribution-label">Source post</p>
                    <p className="distribution-title">Weekend on the coast.</p>
                    <p className="distribution-copy">
                        Less traffic. More coastline. Our new 32 km weekend route is ready. Bring a
                        friend — we roll out Saturday at 9.
                    </p>
                    <img
                        className="distribution-map"
                        src="/product/coastal-route.svg"
                        alt=""
                        width="720"
                        height="540"
                        loading="lazy"
                    />
                </div>
                <div className="distribution-targets">
                    {targets.map(target => (
                        <div
                            key={target.id}
                            data-field-node={target.id}
                            className="field-card distribution-target">
                            <span className="field-logo distribution-logo">{target.logo}</span>
                            <div className="distribution-target-body">
                                <p className="distribution-target-head">
                                    <span>{target.name}</span>
                                    <span className="distribution-time">
                                        <ClockCircleIcon size={13} />
                                        {target.time}
                                    </span>
                                </p>
                                <p className="distribution-copy">{target.text}</p>
                            </div>
                            {target.image ? (
                                <img
                                    className="distribution-thumb"
                                    src="/product/coastal-route.svg"
                                    alt=""
                                    width="720"
                                    height="540"
                                    loading="lazy"
                                />
                            ) : null}
                        </div>
                    ))}
                </div>
            </div>
        </DotField>
    )
}

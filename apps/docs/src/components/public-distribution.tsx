import { DistributionScene } from './distribution-scene'
import { PublicEntrance } from './public-entrance'

import './public-distribution.css'

export function PublicDistribution() {
    return (
        <section className="home-distribution" aria-labelledby="distribution-title">
            <PublicEntrance className="home-distribution-copy" kind="copy">
                <h2 id="distribution-title">
                    Write once.
                    <br />
                    Make each destination yours.
                </h2>
                <p>
                    Start with one post. Adapt the text, media and schedule for each network, while
                    keeping your source in one place.
                </p>
            </PublicEntrance>
            <PublicEntrance kind="illustration">
                <DistributionScene />
            </PublicEntrance>
        </section>
    )
}

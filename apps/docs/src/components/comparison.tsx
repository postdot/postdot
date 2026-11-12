import {
    comparisonDimensions,
    comparisonGroups,
    type getAlternative,
    postdotComparison,
} from '@/lib/alternatives'

import { Link } from './site-link'

import './comparison.css'

type Alternative = NonNullable<ReturnType<typeof getAlternative>>

export function ComparisonOverview({ item }: { item: Alternative }) {
    return (
        <section className="comparison-fit" aria-labelledby="workflow-fit">
            <h2 id="workflow-fit">Which tool fits your workflow?</h2>
            <div className="comparison-fit-columns">
                <div>
                    <h3>Choose Postdot for</h3>
                    <ul>
                        {item.postdotFit.map(text => (
                            <li key={text}>{text}</li>
                        ))}
                    </ul>
                </div>
                <div>
                    <h3>Choose {item.name} for</h3>
                    <ul>
                        {item.otherFit.map(text => (
                            <li key={text}>{text}</li>
                        ))}
                    </ul>
                </div>
            </div>
        </section>
    )
}

export function ComparisonMatrix({ item }: { item: Alternative }) {
    const columns = ['Postdot', ...item.columns]
    return (
        <section className="comparison-capabilities" aria-labelledby="capability-comparison">
            <h2 id="capability-comparison">Compare the workflows</h2>
            <p className="comparison-caption">
                Documented capabilities and editions. Each cell links to its source.
            </p>
            <p className="comparison-scroll-hint">
                Scroll the table horizontally to compare editions.
            </p>
            <div
                className="comparison-scroll"
                role="region"
                aria-label={`${item.name} capability comparison`}
                tabIndex={0}>
                <table className="comparison-matrix">
                    <caption className="sr-only">
                        Postdot and {item.name}: capabilities by edition
                    </caption>
                    <thead>
                        <tr>
                            <th scope="col">Capability</th>
                            {columns.map((column, index) => (
                                <th
                                    key={column}
                                    scope="col"
                                    className={index === 0 ? 'comparison-postdot' : undefined}>
                                    {column}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    {comparisonGroups.map(group => (
                        <tbody key={group.title}>
                            <tr className="comparison-group">
                                <th colSpan={columns.length + 1} scope="rowgroup">
                                    {group.title}
                                </th>
                            </tr>
                            {group.keys.map(key => (
                                <tr key={key} data-comparison-key={key}>
                                    <th scope="row">{comparisonDimensions[key]}</th>
                                    {[postdotComparison[key], ...item.values[key]].map(
                                        (cell, index) => (
                                            <td
                                                key={columns[index]}
                                                className={
                                                    index === 0 ? 'comparison-postdot' : undefined
                                                }>
                                                <p>{cell.text}</p>
                                                <Link
                                                    className="comparison-source"
                                                    href={cell.source}
                                                    aria-label={`Source: ${columns[index]}, ${comparisonDimensions[key]}`}>
                                                    Source
                                                </Link>
                                            </td>
                                        )
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    ))}
                </table>
            </div>
            <p className="comparison-reading-note">
                On a narrow screen, scroll the table to compare columns. “Not confirmed” identifies
                a capability we have not established from the reviewed documentation.
            </p>
        </section>
    )
}

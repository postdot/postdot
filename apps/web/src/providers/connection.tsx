import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react'

import * as m from '@/paraglide/messages.js'

import type { ProviderDefinition, ProviderConnectionProps } from './contract'

const components = new WeakMap<
    ProviderDefinition,
    LazyExoticComponent<ComponentType<ProviderConnectionProps>>
>()
export function ProviderConnection({
    definition,
    ...props
}: ProviderConnectionProps & { readonly definition: ProviderDefinition }) {
    let Component = components.get(definition)
    if (!Component) {
        Component = lazy(definition.loadConnection)
        components.set(definition, Component)
    }
    return (
        <Suspense
            fallback={
                <p role="status" className="text-sm text-muted-foreground">
                    {m.common_loading()}
                </p>
            }>
            <Component {...props} />
        </Suspense>
    )
}

import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react'

import * as m from '@/paraglide/messages.js'

import type { ProviderFieldDefinition, ProviderFieldProps } from './contract'
const components = new WeakMap<
    ProviderFieldDefinition,
    LazyExoticComponent<ComponentType<ProviderFieldProps>>
>()
export function ProviderFieldControl({
    definition,
    ...props
}: ProviderFieldProps & { readonly definition: ProviderFieldDefinition }) {
    let Component = components.get(definition)
    if (!Component) {
        Component = lazy(definition.loadControl)
        components.set(definition, Component)
    }
    return (
        <Suspense fallback={<p role="status">{m.common_loading()}</p>}>
            <Component {...props} />
        </Suspense>
    )
}

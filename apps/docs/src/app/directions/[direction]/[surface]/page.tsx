import { notFound } from 'next/navigation'

import { PrismStudy } from '@/components/prism-study'

export function generateStaticParams() {
    return ['workspace', 'documentation'].map(surface => ({ direction: 'prism', surface }))
}
export default async function Page({
    params,
}: {
    params: Promise<{ direction: string; surface: string }>
}) {
    const { direction, surface } = await params
    if (direction !== 'prism' || (surface !== 'workspace' && surface !== 'documentation'))
        notFound()
    return <PrismStudy surface={surface} />
}

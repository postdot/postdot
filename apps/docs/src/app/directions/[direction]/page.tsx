import { notFound } from 'next/navigation'

import { Direction } from '@/components/directions'
import { directions } from '@/lib/directions'

export function generateStaticParams() {
    return directions.map(direction => ({ direction }))
}
export default async function Page({ params }: { params: Promise<{ direction: string }> }) {
    const { direction } = await params
    if (!directions.includes(direction as (typeof directions)[number])) notFound()
    return <Direction direction={direction as (typeof directions)[number]} />
}

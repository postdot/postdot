import { createMDX } from 'fumadocs-mdx/next'
import type { NextConfig } from 'next'

const config: NextConfig = {
    output: 'export',
    trailingSlash: true,
    images: { unoptimized: true },
}

export default createMDX()(config)

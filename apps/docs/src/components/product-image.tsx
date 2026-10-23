import type { ComponentProps } from 'react'

/** A product screenshot: AVIF where supported, the WebP otherwise. `name` has no extension. */
export function ProductImage({
    name,
    alt,
    ...props
}: { name: string; alt: string } & Omit<ComponentProps<'img'>, 'src' | 'alt'>) {
    return (
        <picture>
            <source srcSet={`/product/${name}.avif`} type="image/avif" />
            <img src={`/product/${name}.webp`} alt={alt} {...props} />
        </picture>
    )
}

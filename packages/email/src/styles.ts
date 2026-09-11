import type { CSSProperties } from 'react'

export const emailStyles = {
    body: {
        margin: 0,
        backgroundColor: '#f4f4f2',
        color: '#18181b',
        fontFamily: 'Arial, Helvetica, sans-serif',
    } satisfies CSSProperties,
    container: {
        maxWidth: '560px',
        margin: '32px auto',
        padding: '0 16px',
    } satisfies CSSProperties,
    panel: {
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        padding: '36px 32px 32px',
    } satisfies CSSProperties,
    brand: {
        margin: '0 0 28px',
        color: '#2563eb',
        fontSize: '14px',
        fontWeight: 700,
        letterSpacing: '0.12em',
        lineHeight: '20px',
        textTransform: 'uppercase',
    } satisfies CSSProperties,
    title: {
        margin: '0 0 24px',
        color: '#18181b',
        fontSize: '26px',
        fontWeight: 700,
        letterSpacing: '-0.02em',
        lineHeight: '32px',
    } satisfies CSSProperties,
    text: {
        margin: '0 0 16px',
        color: '#3f3f46',
        fontSize: '16px',
        lineHeight: '24px',
    } satisfies CSSProperties,
    mutedText: {
        margin: '0 0 16px',
        color: '#71717a',
        fontSize: '14px',
        lineHeight: '21px',
    } satisfies CSSProperties,
    action: {
        margin: '28px 0',
    } satisfies CSSProperties,
    button: {
        backgroundColor: '#2563eb',
        borderRadius: '6px',
        color: '#ffffff',
        display: 'inline-block',
        fontSize: '15px',
        fontWeight: 700,
        lineHeight: '20px',
        padding: '12px 18px',
        textDecoration: 'none',
    } satisfies CSSProperties,
    fallback: {
        margin: '0 0 16px',
        color: '#71717a',
        fontSize: '13px',
        lineHeight: '19px',
        overflowWrap: 'anywhere',
    } satisfies CSSProperties,
    link: {
        color: '#1d4ed8',
        textDecoration: 'underline',
    } satisfies CSSProperties,
    footer: {
        margin: '20px 0 0',
        color: '#71717a',
        fontSize: '12px',
        lineHeight: '18px',
        textAlign: 'center',
    } satisfies CSSProperties,
} as const

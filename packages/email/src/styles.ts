import type { CSSProperties } from 'react'

export const emailStyles = {
    body: {
        margin: 0,
        backgroundColor: '#f4f3f0',
        color: '#181716',
        fontFamily: "'Recursive Variable', Arial, Helvetica, sans-serif",
    } satisfies CSSProperties,
    container: {
        maxWidth: '600px',
        margin: '40px auto',
        padding: '0 24px',
    } satisfies CSSProperties,
    panel: {
        backgroundColor: '#fefdfc',
        borderRadius: '6px',
        boxShadow:
            '0 2px 4px rgba(24, 24, 27, 0.04), 0 1px 2px rgba(24, 24, 27, 0.05), 0 0 1px rgba(24, 24, 27, 0.06)',
        overflow: 'hidden',
    } satisfies CSSProperties,
    brandHeader: {
        padding: '28px 32px 0',
    } satisfies CSSProperties,
    brandLogoCell: {
        padding: 0,
        verticalAlign: 'middle',
        width: '30px',
    } satisfies CSSProperties,
    brandWordmarkCell: {
        padding: '0 0 0 10px',
        verticalAlign: 'middle',
    } satisfies CSSProperties,
    brandWordmark: {
        margin: 0,
        color: '#181716',
        fontFamily: "'Recursive Variable', Arial, Helvetica, sans-serif",
        fontSize: '18px',
        fontWeight: 600,
        letterSpacing: '-0.04em',
        lineHeight: '22px',
    } satisfies CSSProperties,
    content: {
        padding: '34px 32px 32px',
    } satisfies CSSProperties,
    title: {
        margin: '0 0 22px',
        color: '#181716',
        fontFamily: "'Recursive Variable', Arial, Helvetica, sans-serif",
        fontSize: '28px',
        fontWeight: 600,
        letterSpacing: '-0.04em',
        lineHeight: '32px',
    } satisfies CSSProperties,
    text: {
        margin: '0 0 16px',
        color: '#414047',
        fontFamily: "'Recursive Variable', Arial, Helvetica, sans-serif",
        fontSize: '15px',
        lineHeight: '23px',
    } satisfies CSSProperties,
    mutedText: {
        margin: '0 0 16px',
        color: '#6d6e75',
        fontFamily: "'Recursive Variable', Arial, Helvetica, sans-serif",
        fontSize: '14px',
        lineHeight: '20px',
    } satisfies CSSProperties,
    action: {
        margin: '24px 0 24px',
    } satisfies CSSProperties,
    button: {
        backgroundColor: '#426bce',
        borderRadius: '6px',
        color: '#ffffff',
        display: 'inline-block',
        fontFamily: "'Recursive Variable', Arial, Helvetica, sans-serif",
        fontSize: '14px',
        fontWeight: 600,
        lineHeight: '20px',
        padding: '11px 16px',
        textDecoration: 'none',
    } satisfies CSSProperties,
    fallback: {
        margin: '0 0 16px',
        color: '#6d6e75',
        fontFamily: "'Recursive Variable', Arial, Helvetica, sans-serif",
        fontSize: '13px',
        lineHeight: '19px',
        overflowWrap: 'anywhere',
    } satisfies CSSProperties,
    link: {
        color: '#315fbf',
        fontFamily: "'Recursive Variable', Arial, Helvetica, sans-serif",
        textDecoration: 'underline',
    } satisfies CSSProperties,
    notice: {
        margin: '22px 0 0',
        color: '#5f6067',
        fontFamily: "'Recursive Variable', Arial, Helvetica, sans-serif",
        fontSize: '13px',
        lineHeight: '19px',
    } satisfies CSSProperties,
    footer: {
        margin: '18px 0 0',
        color: '#6d6e75',
        fontFamily: "'Recursive Variable', Arial, Helvetica, sans-serif",
        fontSize: '12px',
        lineHeight: '18px',
        textAlign: 'center',
    } satisfies CSSProperties,
} as const

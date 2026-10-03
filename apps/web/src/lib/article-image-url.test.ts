import { expect, test } from 'bun:test'

import { articleImageUrl } from './article-image-url'

test('preserves external addresses and rejects embedded bytes, credentials and obvious private hosts', () => {
    expect(articleImageUrl(' https://images.example.com/photo(1).png?width=300&height=200 ')).toBe(
        'https://images.example.com/photo(1).png?width=300&height=200'
    )
    for (const value of [
        'data:image/png;base64,AAAA',
        'blob:https://example.com/image',
        '/api/media/image',
        'javascript:alert(1)',
        'https://user:secret@example.com/image',
        'http://localhost/image',
        'http://127.1/image',
        'http://10.0.0.1/image',
        'http://172.16.0.1/image',
        'http://192.168.1.1/image',
        'http://169.254.169.254/image',
        'http://[::1]/image',
        'http://[::ffff:127.0.0.1]/image',
        'http://[fd00::1]/image',
    ]) {
        expect(articleImageUrl(value)).toBeNull()
    }
})

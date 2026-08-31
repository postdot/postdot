import { once } from 'node:events'
import { request as requestHttp } from 'node:http'
import { request as requestHttps } from 'node:https'

import type { CustomHttpRequest, CustomHttpRequester, CustomHttpResponse } from './contract'

export function createNodeHttpRequester(): CustomHttpRequester {
    return {
        request(input, signal) {
            return requestWithNode(input, signal)
        },
    }
}

async function requestWithNode(
    input: CustomHttpRequest,
    signal: AbortSignal
): Promise<CustomHttpResponse> {
    const requestFunction = input.url.protocol === 'https:' ? requestHttps : requestHttp
    const hostname = input.url.hostname.replace(/^\[|\]$/g, '')
    const requestPath = `${input.url.pathname}${input.url.search}`
    const headers: Record<string, string> = { ...input.headers, host: input.url.host }
    if (input.body !== null && input.body.contentLength !== null) {
        headers['content-length'] = input.body.contentLength.toString()
    }

    return new Promise<CustomHttpResponse>((resolve, reject) => {
        let settled = false
        const finish = (callback: () => void) => {
            if (settled) return
            settled = true
            callback()
        }

        const request = requestFunction(
            {
                protocol: input.url.protocol,
                hostname: input.address.address,
                port: input.url.port.length > 0 ? Number(input.url.port) : undefined,
                method: input.method,
                path: requestPath,
                headers,
                agent: false,
                signal,
                servername: hostname,
                lookup: (_lookupHostname, _lookupOptions, callback) => {
                    callback(null, input.address.address, input.address.family)
                },
            },
            response => {
                const chunks: Buffer[] = []
                let byteCount = 0
                let bodyTruncated = false

                response.on('data', (chunk: Buffer | Uint8Array | string) => {
                    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
                    const remaining = input.maxResponseBytes - byteCount
                    if (remaining <= 0) {
                        bodyTruncated = true
                        return
                    }
                    if (bytes.byteLength > remaining) {
                        chunks.push(bytes.subarray(0, remaining))
                        byteCount += remaining
                        bodyTruncated = true
                        return
                    }
                    chunks.push(bytes)
                    byteCount += bytes.byteLength
                })
                response.once('end', () =>
                    finish(() =>
                        resolve({
                            status: response.statusCode ?? 0,
                            headers: responseHeaders(response.headers),
                            body: Buffer.concat(chunks).toString('utf8'),
                            bodyTruncated,
                        })
                    )
                )
                response.once('error', error => finish(() => reject(error)))
            }
        )

        request.once('error', error => finish(() => reject(error)))
        void writeRequestBody(request, input.body)
            .then(() => {
                if (!settled) request.end()
            })
            .catch(error => {
                if (!settled) request.destroy(error as Error)
            })
    })
}

async function writeRequestBody(
    request: ReturnType<typeof requestHttp>,
    body: CustomHttpRequest['body']
): Promise<void> {
    if (body === null) return

    await body.write(async chunk => {
        if (!request.write(chunk)) {
            await once(request, 'drain')
        }
    })
}

function responseHeaders(
    headers: Record<string, string | string[] | undefined>
): Record<string, string> {
    return Object.fromEntries(
        Object.entries(headers).flatMap(([name, value]) => {
            if (value === undefined) return []
            return [[name.toLowerCase(), Array.isArray(value) ? value.join(', ') : value]]
        })
    )
}

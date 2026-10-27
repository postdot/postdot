// cspell:ignore addext keyout

import { spawn } from 'node:child_process'
import { chmod, mkdir, readFile } from 'node:fs/promises'
import {
    STATUS_CODES,
    request as requestHttp,
    type ClientRequest,
    type IncomingMessage,
    type OutgoingHttpHeaders,
    type ServerResponse,
} from 'node:http'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import { join } from 'node:path'
import type { Duplex } from 'node:stream'

import { isSafeE2EDataDirectory } from './e2e-runtime'

const readinessPath = '/__realtime_tls_ready'
const tlsDirectoryName = 'tls'
const hopByHopHeaders = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'proxy-connection',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
])

export interface RealtimeTlsProxyOptions {
    readonly port: number
    readonly targetOrigin: string
    readonly key: string | Buffer
    readonly cert: string | Buffer
}

export interface RealtimeTlsProxy {
    readonly server: HttpsServer
    readonly origin: string
    readonly port: number
    listen(): Promise<void>
    stop(): Promise<void>
}

export function createRealtimeTlsProxy(options: RealtimeTlsProxyOptions): RealtimeTlsProxy {
    assertPort(options.port)
    const target = parseTargetOrigin(options.targetOrigin, options.port)
    const targetPort = Number(target.port)
    const clientSockets = new Set<Duplex>()
    const upstreamSockets = new Set<Duplex>()
    const upstreamRequests = new Set<ClientRequest>()
    let listenPromise: Promise<void> | undefined
    let stopPromise: Promise<void> | undefined

    const server = createHttpsServer(
        { key: options.key, cert: options.cert },
        (request, response) => {
            handleRequest(request, response)
        }
    )

    server.on('connection', socket => {
        clientSockets.add(socket)
        socket.once('close', () => clientSockets.delete(socket))
    })
    server.on('secureConnection', socket => {
        clientSockets.add(socket)
        socket.once('close', () => clientSockets.delete(socket))
    })
    server.on('tlsClientError', (_error, socket) => {
        socket.destroy()
    })
    server.on('upgrade', (request, socket, head) => {
        handleUpgrade(request, socket, head)
    })

    function proxyHeaders(request: IncomingMessage, upgrade: boolean): OutgoingHttpHeaders {
        const headers: OutgoingHttpHeaders = {}
        const connectionTokens = headerTokens(request.headers.connection)
        for (const [name, value] of Object.entries(request.headers)) {
            const lowerName = name.toLowerCase()
            if (value === undefined) continue
            if (hopByHopHeaders.has(lowerName) || connectionTokens.has(lowerName)) continue
            if (lowerName === 'expect') continue
            headers[lowerName] = value
        }

        const publicHost = firstHeaderValue(request.headers.host)
        headers.host = publicHost ?? target.host
        if (upgrade) {
            headers.connection = 'Upgrade'
            const upgradeHeader = firstHeaderValue(request.headers.upgrade)
            if (upgradeHeader !== undefined) headers.upgrade = upgradeHeader
        }

        headers['x-forwarded-proto'] = 'https'
        headers['x-forwarded-port'] = String(options.port)
        headers['x-forwarded-host'] = publicHost ?? target.host
        const remoteAddress = request.socket.remoteAddress
        if (remoteAddress !== undefined) {
            const forwardedFor = firstHeaderValue(request.headers['x-forwarded-for'])
            headers['x-forwarded-for'] =
                forwardedFor === undefined ? remoteAddress : `${forwardedFor}, ${remoteAddress}`
        }

        return headers
    }

    function handleRequest(request: IncomingMessage, response: ServerResponse): void {
        const requestPath = request.url ?? '/'
        const pathname = pathnameOf(requestPath)
        if (pathname === readinessPath) {
            if (request.method !== 'GET') {
                response.writeHead(405, {
                    allow: 'GET',
                    'cache-control': 'no-store',
                    'content-type': 'text/plain; charset=utf-8',
                })
                response.end('Method Not Allowed')
                return
            }
            response.writeHead(200, {
                'cache-control': 'no-store',
                'content-type': 'text/plain; charset=utf-8',
            })
            response.end('ready')
            return
        }

        if (!requestPath.startsWith('/')) {
            response.writeHead(400, {
                'cache-control': 'no-store',
                'content-type': 'text/plain; charset=utf-8',
                connection: 'close',
            })
            response.end('Bad Request')
            return
        }

        const upstreamRequest = requestHttp(
            {
                agent: false,
                headers: proxyHeaders(request, false),
                hostname: target.hostname,
                method: request.method,
                path: requestPath,
                port: targetPort,
            },
            upstreamResponse => {
                forwardResponse(response, upstreamResponse)
            }
        )
        upstreamRequests.add(upstreamRequest)
        upstreamRequest.once('close', () => upstreamRequests.delete(upstreamRequest))

        const abortUpstream = () => {
            if (!response.writableFinished) upstreamRequest.destroy()
        }

        request.once('close', () => {
            if (!request.complete) abortUpstream()
        })
        response.once('close', abortUpstream)
        response.once('error', () => upstreamRequest.destroy())
        upstreamRequest.once('error', () => {
            upstreamRequests.delete(upstreamRequest)
            request.unpipe(upstreamRequest)
            request.resume()
            sendBadGateway(response)
        })

        request.pipe(upstreamRequest)
    }

    function forwardResponse(response: ServerResponse, upstreamResponse: IncomingMessage): void {
        if (response.destroyed) {
            upstreamResponse.destroy()
            return
        }

        const abort = () => {
            if (!response.writableFinished) upstreamResponse.destroy()
        }
        response.once('close', abort)

        upstreamResponse.once('aborted', () => {
            if (!response.destroyed) response.destroy()
        })
        upstreamResponse.once('error', () => {
            if (response.headersSent) {
                if (!response.destroyed) response.destroy()
                return
            }
            sendBadGateway(response)
        })

        const statusCode = upstreamResponse.statusCode ?? 502
        const headers = forwardedResponseHeaders(upstreamResponse)
        if (!response.headersSent) {
            if (upstreamResponse.statusMessage === undefined) {
                response.writeHead(statusCode, headers)
            } else {
                response.writeHead(statusCode, upstreamResponse.statusMessage, headers)
            }
            response.flushHeaders()
        }

        upstreamResponse.pipe(response)
    }

    function handleUpgrade(request: IncomingMessage, clientSocket: Duplex, head: Buffer): void {
        const requestPath = request.url ?? '/'
        if (!requestPath.startsWith('/')) {
            writeRawResponse(clientSocket, 400, 'Bad Request')
            return
        }

        let upstreamSocket: Duplex | undefined
        let upgraded = false
        const upstreamRequest = requestHttp({
            agent: false,
            headers: proxyHeaders(request, true),
            hostname: target.hostname,
            method: request.method,
            path: requestPath,
            port: targetPort,
        })
        upstreamRequests.add(upstreamRequest)
        upstreamRequest.once('close', () => upstreamRequests.delete(upstreamRequest))

        const closeUpstream = () => {
            if (upstreamSocket === undefined) upstreamRequest.destroy()
            else upstreamSocket.destroy()
        }

        clientSocket.once('close', closeUpstream)
        clientSocket.once('error', closeUpstream)
        upstreamRequest.once('error', () => {
            upstreamRequests.delete(upstreamRequest)
            if (upgraded) {
                if (upstreamSocket !== undefined) upstreamSocket.destroy()
                clientSocket.destroy()
                return
            }
            writeRawResponse(clientSocket, 502, 'Bad Gateway')
        })
        upstreamRequest.once('response', upstreamResponse => {
            if (upgraded) {
                upstreamResponse.destroy()
                return
            }
            forwardRejectedUpgrade(clientSocket, upstreamResponse)
        })
        upstreamRequest.once('upgrade', (upstreamResponse, socket, upstreamHead) => {
            upgraded = true
            upstreamSocket = socket
            upstreamSockets.add(socket)
            socket.once('close', () => upstreamSockets.delete(socket))
            socket.once('error', () => clientSocket.destroy())
            socket.once('close', () => clientSocket.destroy())

            clientSocket.write(rawUpgradeResponse(upstreamResponse))
            if (head.length > 0) socket.write(head)
            if (upstreamHead.length > 0) clientSocket.write(upstreamHead)

            clientSocket.pipe(socket)
            socket.pipe(clientSocket)
        })

        upstreamRequest.end()
    }

    const listen = (): Promise<void> => {
        listenPromise ??= new Promise((resolveListen, rejectListen) => {
            const onError = (error: Error) => {
                server.off('listening', onListening)
                rejectListen(error)
            }
            const onListening = () => {
                server.off('error', onError)
                resolveListen()
            }
            server.once('error', onError)
            server.once('listening', onListening)
            server.listen({ host: '127.0.0.1', port: options.port })
        })
        return listenPromise
    }

    const stop = (): Promise<void> => {
        stopPromise ??= (async () => {
            const wasListening = server.listening
            const closed = wasListening
                ? new Promise<void>((resolveClose, rejectClose) => {
                      server.close(error => {
                          if (error === undefined) resolveClose()
                          else rejectClose(error)
                      })
                  })
                : Promise.resolve()

            for (const socket of clientSockets) socket.destroy()
            for (const request of upstreamRequests) request.destroy()
            for (const socket of upstreamSockets) socket.destroy()

            await closed
        })()
        return stopPromise
    }

    return {
        server,
        origin: `https://127.0.0.1:${options.port}`,
        port: options.port,
        listen,
        stop,
    }
}

function parseTargetOrigin(value: string, listenerPort: number): URL {
    let target: URL
    try {
        target = new URL(value)
    } catch {
        throw new Error('POSTDOT_E2E_TLS_PROXY_TARGET must be a valid origin')
    }

    if (target.protocol !== 'http:') {
        throw new Error('POSTDOT_E2E_TLS_PROXY_TARGET must use http')
    }
    if (target.hostname !== '127.0.0.1') {
        throw new Error('POSTDOT_E2E_TLS_PROXY_TARGET must target 127.0.0.1')
    }
    if (target.username !== '' || target.password !== '') {
        throw new Error('POSTDOT_E2E_TLS_PROXY_TARGET must not contain credentials')
    }
    if (target.port === '') {
        throw new Error('POSTDOT_E2E_TLS_PROXY_TARGET must include an explicit port')
    }
    const origin = target.origin
    if (value !== origin && value !== `${origin}/`) {
        throw new Error('POSTDOT_E2E_TLS_PROXY_TARGET must not contain a path, query, or hash')
    }
    const targetPort = Number(target.port)
    if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65_535) {
        throw new Error('POSTDOT_E2E_TLS_PROXY_TARGET must use a valid port')
    }
    if (targetPort === listenerPort) {
        throw new Error('POSTDOT_E2E_TLS_PROXY_TARGET must not use the TLS listener port')
    }

    return target
}

function assertPort(port: number): void {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error('POSTDOT_E2E_TLS_PROXY_PORT must be an integer between 1 and 65535')
    }
}

function pathnameOf(requestPath: string): string {
    const queryIndex = requestPath.indexOf('?')
    return queryIndex === -1 ? requestPath : requestPath.slice(0, queryIndex)
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) return value[0]
    return value
}

function headerTokens(value: string | string[] | undefined): ReadonlySet<string> {
    const tokens = new Set<string>()
    if (value === undefined) return tokens
    for (const header of Array.isArray(value) ? value : [value]) {
        for (const token of header.split(',')) {
            const normalized = token.trim().toLowerCase()
            if (normalized.length > 0) tokens.add(normalized)
        }
    }
    return tokens
}

function forwardedResponseHeaders(upstreamResponse: IncomingMessage): OutgoingHttpHeaders {
    const headers: OutgoingHttpHeaders = {}
    const connectionTokens = headerTokens(upstreamResponse.headers.connection)
    for (const [name, value] of Object.entries(upstreamResponse.headers)) {
        const lowerName = name.toLowerCase()
        if (value === undefined) continue
        if (hopByHopHeaders.has(lowerName) || connectionTokens.has(lowerName)) continue
        headers[lowerName] = value
    }
    return headers
}

function sendBadGateway(response: ServerResponse): void {
    if (response.destroyed || response.headersSent) {
        if (!response.destroyed) response.destroy()
        return
    }
    response.writeHead(502, {
        'cache-control': 'no-store',
        'content-type': 'text/plain; charset=utf-8',
        connection: 'close',
    })
    response.end('Bad Gateway')
}

function forwardRejectedUpgrade(clientSocket: Duplex, upstreamResponse: IncomingMessage): void {
    if (clientSocket.destroyed) {
        upstreamResponse.destroy()
        return
    }

    const statusCode = upstreamResponse.statusCode ?? 502
    const headers = forwardedResponseHeaders(upstreamResponse)
    headers.connection = 'close'
    const reason = upstreamResponse.statusMessage ?? STATUS_CODES[statusCode] ?? 'Unknown'
    clientSocket.write(`HTTP/1.1 ${statusCode} ${reason}\r\n${serializeHeaders(headers)}\r\n`)

    clientSocket.once('close', () => upstreamResponse.destroy())
    upstreamResponse.once('error', () => clientSocket.destroy())
    upstreamResponse.once('end', () => clientSocket.end())
    upstreamResponse.pipe(clientSocket)
}

function rawUpgradeResponse(upstreamResponse: IncomingMessage): string {
    const statusCode = upstreamResponse.statusCode ?? 502
    const reason = upstreamResponse.statusMessage ?? STATUS_CODES[statusCode] ?? 'Unknown'
    let head = `HTTP/1.1 ${statusCode} ${reason}\r\n`
    for (let index = 0; index + 1 < upstreamResponse.rawHeaders.length; index += 2) {
        const name = upstreamResponse.rawHeaders[index]
        const value = upstreamResponse.rawHeaders[index + 1]
        head += `${name}: ${value}\r\n`
    }
    return `${head}\r\n`
}

function serializeHeaders(headers: OutgoingHttpHeaders): string {
    let block = ''
    for (const [name, value] of Object.entries(headers)) {
        if (value === undefined) continue
        for (const item of Array.isArray(value) ? value : [value]) {
            block += `${name}: ${item}\r\n`
        }
    }
    return block
}

function writeRawResponse(clientSocket: Duplex, statusCode: number, reason: string): void {
    if (clientSocket.destroyed) return
    clientSocket.end(
        `HTTP/1.1 ${statusCode} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
    )
}

async function loadOrCreateCertificate(
    dataDirectory: string
): Promise<{ key: Buffer; cert: Buffer }> {
    const tlsDirectory = join(dataDirectory, tlsDirectoryName)
    const keyPath = join(tlsDirectory, 'key.pem')
    const certPath = join(tlsDirectory, 'cert.pem')

    await mkdir(tlsDirectory, { recursive: true, mode: 0o700 })
    await chmod(tlsDirectory, 0o700)

    try {
        await chmod(keyPath, 0o600)
        const [key, cert] = await Promise.all([readFile(keyPath), readFile(certPath)])
        return { key, cert }
    } catch (error) {
        if (!isMissingFile(error)) throw error
    }

    await generateCertificate(keyPath, certPath)
    await chmod(keyPath, 0o600)

    const [key, cert] = await Promise.all([readFile(keyPath), readFile(certPath)])
    return { key, cert }
}

function isMissingFile(error: unknown): boolean {
    return (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
    )
}

function generateCertificate(keyPath: string, certPath: string): Promise<void> {
    return new Promise((resolveSpawn, rejectSpawn) => {
        const child = spawn(
            'openssl',
            [
                'req',
                '-x509',
                '-newkey',
                'rsa:2048',
                '-nodes',
                '-days',
                '1',
                '-sha256',
                '-subj',
                '/CN=127.0.0.1',
                '-addext',
                'subjectAltName=IP:127.0.0.1',
                '-keyout',
                keyPath,
                '-out',
                certPath,
            ],
            { stdio: ['ignore', 'ignore', 'pipe'] }
        )
        let stderr = ''
        child.stderr?.setEncoding('utf8')
        child.stderr?.on('data', chunk => {
            stderr = `${stderr}${String(chunk)}`.slice(-2_000)
        })
        child.once('error', rejectSpawn)
        child.once('close', code => {
            if (code === 0) {
                resolveSpawn()
                return
            }
            const exitCode = String(code)
            rejectSpawn(
                new Error(
                    `openssl certificate generation failed with exit code ${exitCode}: ${stderr.trim()}`
                )
            )
        })
    })
}

async function runCli(): Promise<void> {
    const environment = process.env
    if (
        environment.NODE_ENV !== 'test' ||
        environment.POSTDOT_E2E_REALTIME_ACCEPTANCE !== 'true' ||
        environment.POSTDOT_E2E_TLS_PROXY !== 'true'
    ) {
        throw new Error('The realtime TLS proxy is not enabled for isolated acceptance')
    }

    const dataDirectory = environment.POSTDOT_E2E_DATA_DIRECTORY
    if (!isSafeE2EDataDirectory(dataDirectory)) {
        throw new Error('The realtime TLS proxy data directory is not safely configured')
    }

    const port = Number(environment.POSTDOT_E2E_TLS_PROXY_PORT)
    assertPort(port)

    const targetOrigin = environment.POSTDOT_E2E_TLS_PROXY_TARGET
    if (targetOrigin === undefined) {
        throw new Error('POSTDOT_E2E_TLS_PROXY_TARGET is required')
    }
    parseTargetOrigin(targetOrigin, port)

    const { key, cert } = await loadOrCreateCertificate(dataDirectory)
    const proxy = createRealtimeTlsProxy({ port, targetOrigin, key, cert })
    await proxy.listen()
    console.log(`Realtime TLS proxy listening on ${proxy.origin} -> ${targetOrigin}`)

    let stopping = false
    const stop = async () => {
        if (stopping) return
        stopping = true
        await proxy.stop()
        process.exit(0)
    }

    process.once('SIGINT', () => void stop())
    process.once('SIGTERM', () => void stop())
}

if (import.meta.main) {
    void runCli().catch(error => {
        console.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
    })
}

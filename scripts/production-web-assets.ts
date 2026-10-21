export interface ProductionWebAssetCheck {
    readonly assetCount: number
    readonly javascriptCount: number
    readonly stylesheetCount: number
}

export type ProductionWebRequest = (url: URL) => Promise<Response>

export async function verifyProductionDashboard(
    origin: string,
    request: ProductionWebRequest = url => fetch(url, { signal: AbortSignal.timeout(5_000) })
): Promise<ProductionWebAssetCheck> {
    const baseUrl = new URL(origin)
    const shellUrl = new URL('/', baseUrl)
    const shellResponse = await request(shellUrl)
    if (!shellResponse.ok) {
        throw new Error(`Dashboard shell returned HTTP ${shellResponse.status}`)
    }

    const shellContentType = shellResponse.headers.get('content-type') ?? ''
    if (!shellContentType.toLowerCase().includes('text/html')) {
        throw new Error(`Dashboard shell returned unexpected content type: ${shellContentType}`)
    }

    const html = await shellResponse.text()
    if (!/<title>\s*Postdot\s*<\/title>/i.test(html) || !/id=["']root["']/i.test(html)) {
        throw new Error('Dashboard shell is missing the Postdot title or application root')
    }

    const assetUrls = Array.from(html.matchAll(/(?:src|href)=["']([^"']+)["']/gi))
        .map(match => new URL(match[1]!, baseUrl))
        .filter(url => url.origin === baseUrl.origin && url.pathname.startsWith('/assets/'))
        .filter(
            (url, index, urls) => urls.findIndex(candidate => candidate.href === url.href) === index
        )

    const javascriptUrls = assetUrls.filter(url => url.pathname.endsWith('.js'))
    const stylesheetUrls = assetUrls.filter(url => url.pathname.endsWith('.css'))
    if (javascriptUrls.length === 0) {
        throw new Error('Dashboard shell does not reference a JavaScript asset')
    }
    if (stylesheetUrls.length === 0) {
        throw new Error('Dashboard shell does not reference a stylesheet')
    }

    await Promise.all(
        assetUrls.map(async url => {
            const response = await request(url)
            if (!response.ok) {
                throw new Error(`Dashboard asset ${url.pathname} returned HTTP ${response.status}`)
            }

            const contentType = response.headers.get('content-type') ?? ''
            if (url.pathname.endsWith('.js') && !/javascript|ecmascript/i.test(contentType)) {
                throw new Error(
                    `Dashboard script ${url.pathname} returned unexpected content type: ${contentType}`
                )
            }
            if (url.pathname.endsWith('.css') && !/text\/css/i.test(contentType)) {
                throw new Error(
                    `Dashboard stylesheet ${url.pathname} returned unexpected content type: ${contentType}`
                )
            }

            if ((await response.arrayBuffer()).byteLength === 0) {
                throw new Error(`Dashboard asset ${url.pathname} is empty`)
            }
        })
    )

    return {
        assetCount: assetUrls.length,
        javascriptCount: javascriptUrls.length,
        stylesheetCount: stylesheetUrls.length,
    }
}

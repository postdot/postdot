export interface CliQualificationFixture {
    readonly url: URL
    handle(request: Request): Response | Promise<Response>
    diagnostics?(): Promise<string>
    stop(): Promise<void>
}

export interface CliQualificationFixture {
    readonly url: URL
    handle(request: Request): Response | Promise<Response>
    stop(): Promise<void>
}

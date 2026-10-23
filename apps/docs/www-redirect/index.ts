/** Sends every request of `www.postdot.app` to the same path on `postdot.app`. */
export default {
    fetch(request: Request): Response {
        const url = new URL(request.url)
        url.hostname = 'postdot.app'
        return Response.redirect(url.toString(), 301)
    },
}

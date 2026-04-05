export function buildJsonProxyRequest(request: Request, pathname: string, body: unknown) {
    const headers = new Headers(request.headers);
    headers.set('Content-Type', 'application/json');

    return new Request(new URL(pathname, request.url), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
}

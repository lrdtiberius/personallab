type RouteContext = { params: Promise<{ path: string[] }> };

async function proxy(request: Request, context: RouteContext) {
  const { path } = await context.params;
  const base = (process.env.PERSONALLAB_API_URL ?? "http://personal-lab-api:8095").replace(/\/$/, "");
  const incoming = new URL(request.url);
  const upstream = new URL(`${base}/api/${path.join("/")}`);
  upstream.search = incoming.search;
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  const hasBody = !["GET", "HEAD"].includes(request.method);
  try {
    const response = await fetch(upstream, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      cache: "no-store",
    });
    return new Response(response.body, { status: response.status, headers: response.headers });
  } catch {
    return Response.json({ error: "PersonalLab-Datendienst ist nicht erreichbar" }, { status: 503 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;

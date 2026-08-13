const UPSTREAM_ORIGIN = "https://quote.myh88.com";
const ALLOWED_PATHS = new Set(["", "quotes", "market-clock", "fx"]);

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "X-MYH88-Proxy": "pages-api",
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet(context) {
  const rawPath = context.params?.path;
  const segments = Array.isArray(rawPath) ? rawPath : rawPath ? [rawPath] : [];
  const path = segments.map((part) => String(part).replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/");
  if (segments.length > 1 || !ALLOWED_PATHS.has(path)) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const incoming = new URL(context.request.url);
  const upstream = new URL(`${UPSTREAM_ORIGIN}/${path}`);
  upstream.search = incoming.search;
  try {
    const response = await fetch(upstream, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache", Pragma: "no-cache" },
    });
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders())) headers.set(key, value);
    headers.set("X-MYH88-Proxy", "pages-api");
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Quote bridge unavailable", detail: String(error?.message || error).slice(0, 160) }), {
      status: 502,
      headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
    });
  }
}

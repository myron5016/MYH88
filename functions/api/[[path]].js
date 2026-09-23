const UPSTREAM_ORIGIN = "https://quote.myh88.com";
const SINGLE_ROUTES = new Set(["", "quotes", "market-clock", "fx", "logos"]);

function corsHeaders(noStore = true) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "X-MYH88-Proxy": "pages-api",
  };
  if (noStore) headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0";
  return headers;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet(context) {
  const rawPath = context.params?.path;
  const rawSegments = Array.isArray(rawPath) ? rawPath : rawPath ? [rawPath] : [];
  const segments = rawSegments.flatMap((part) => String(part).split("/")).map((part) => part.trim()).filter(Boolean);
  const path = segments.join("/");
  const isLogoImage = segments.length === 2 && segments[0] === "logo"
    && /^[A-Z0-9.-]{1,12}$/i.test(segments[1]) && /[A-Z0-9]/i.test(segments[1]);
  if (!((segments.length <= 1 && SINGLE_ROUTES.has(path)) || isLogoImage)) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const incoming = new URL(context.request.url);
  const upstream = new URL(`${UPSTREAM_ORIGIN}/${path}`);
  upstream.search = incoming.search;
  try {
    const requestedAccept = isLogoImage ? context.request.headers.get("Accept") || "image/*" : "application/json";
    const response = await fetch(upstream, {
      headers: isLogoImage
        ? { Accept: requestedAccept }
        : { Accept: requestedAccept, "Cache-Control": "no-cache", Pragma: "no-cache" },
    });
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders(!isLogoImage))) headers.set(key, value);
    headers.set("X-MYH88-Proxy", "pages-api");
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Quote bridge unavailable", detail: String(error?.message || error).slice(0, 160) }), {
      status: 502,
      headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
    });
  }
}

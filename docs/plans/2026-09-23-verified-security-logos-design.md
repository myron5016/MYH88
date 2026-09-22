# Verified Security Logos Design

## Goal

Show authentic company or security logos in the allocation map and position table for both current and newly added holdings. Never present a hand-drawn approximation as an authentic logo.

## Current problem

The client currently uses a hard-coded ticker-to-SVG map, a second hard-coded ticker-to-domain map, and ticker initials as a fallback. Several local SVGs are approximations, and any new ticker that is not in the maps cannot resolve automatically. Domain favicons are also not reliable proof that an image is the correct security logo.

## Product rules

1. A logo may be displayed only when it comes from a trusted market-data profile or an explicit verified override.
2. If no trustworthy logo is available, display the ticker initials. Do not synthesize or guess a logo.
3. For an ETF, prefer the product's own verified logo. Do not silently substitute the issuer logo.
4. `CASH` remains a clearly labelled local app icon because it is an app concept rather than a listed security.
5. Newly added holdings resolve automatically without a code deployment.

## Recommended architecture

### Worker metadata endpoint

Add `GET /logos?symbols=AAPL,NVDA` to the existing Cloudflare Worker. The endpoint normalizes and limits tickers using the same symbol validation already used for quotes, then resolves each symbol through Finnhub's company-profile data using the server-side `FINNHUB_API_KEY`.

The JSON response contains a record per ticker:

```json
{
  "logos": {
    "NVDA": {
      "status": "verified",
      "url": "/logo/NVDA",
      "name": "NVIDIA Corp",
      "source": "finnhub"
    },
    "MSTU": {
      "status": "missing"
    }
  }
}
```

Provider responses are stored in `MYH88_CACHE` for 30 days. Negative results are cached for 24 hours so an unavailable or unsupported ticker does not consume quota on every page load.

### Worker image proxy

Add `GET /logo/:symbol`. It reads only a logo URL previously resolved and cached by the metadata endpoint, fetches that URL server-side, validates an HTTPS URL, an image content type, a successful response, and a conservative size limit, then returns the bytes with long-lived browser and edge caching.

The client never supplies an arbitrary upstream URL. This prevents the endpoint becoming an open proxy and avoids exposing the market-data API key.

### Verified overrides

Maintain a small server-side override object for known provider gaps and ambiguous instruments. Each entry must point to an official issuer/product asset and include a short provenance comment. Overrides are exceptions, not the primary resolution mechanism.

The existing approximate SVGs must not be used as company logos. Only the `CASH` app asset is retained in the logo path.

### Frontend resolution

On render, the client immediately shows ticker initials so layout remains stable. It batches all non-cash symbols into one `/logos` request, stores successful results in an in-memory map, and rerenders only the logo elements when metadata arrives.

The same resolver is shared by the allocation map and position table. An image load error switches permanently to the ticker fallback for that element. A newly added position is included automatically on the next render.

## Failure and freshness behavior

- Worker/provider unavailable: keep ticker initials; the rest of the portfolio remains fully usable.
- Unknown or unsupported symbol: cache `missing` and show initials.
- Invalid or non-image upstream response: reject it and show initials.
- Provider later adds a logo: the negative cache expires after 24 hours and resolution is retried.
- Provider changes a logo: the 30-day metadata cache and image cache eventually refresh without a deployment.

## Security and privacy

- Keep `FINNHUB_API_KEY` only in the Worker environment.
- Normalize symbols and cap batch size.
- Proxy images only from URLs obtained from the trusted provider or a reviewed override.
- Require HTTPS and validate response type and size.
- Escape all symbol/name output and do not insert provider HTML.

## Testing

- Unit tests for symbol normalization, batch limits, positive and negative cache behavior, ETF fallback, invalid URL/content type/oversized image rejection, and provider failure.
- Worker routing tests for `/logos` and `/logo/:symbol`.
- Frontend tests for batched requests, verified image rendering, `CASH`, unknown tickers, and image-load fallback.
- Manual browser verification at desktop and mobile sizes using current holdings plus one new unknown ticker.

## Rollout

Deploy the Worker endpoint first, then the client resolver. During rollout the UI remains safe because it starts from ticker fallbacks. Remove the old hand-maintained company SVG map after the new endpoint is verified in production.

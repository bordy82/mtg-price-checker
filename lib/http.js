// Requests to the stores. Every request times out (#48): Node's fetch would wait up to 5 minutes for the headers,
// then 5 more for the body, so a store that accepts the connection and then stalls held up the whole search
// (or refresh). A timed-out store fails like any other: "couldn't reach", not cached, last prices kept on refresh.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) mtg-price-checker/0.1';
const TIMEOUT_MS = 15_000;

// Dropped connections and 5xx answers are retried `retries` times, after 750 ms, 1.5 s, 2.25 s…
// A 4xx would only fail again, and a timeout isn't retried: a stalled store would hold the search another 15 s.
async function request(url, { accept, read, retries = 1 }) {
  for (let attempt = 0; ; attempt++) {
    try {
      // The signal also covers reading the body.
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw Object.assign(new Error(`${res.status} ${res.statusText} for ${url}`), { status: res.status });
      return await read(res);
    } catch (err) {
      if (err.name === 'TimeoutError') throw new Error(`timed out after ${TIMEOUT_MS / 1000} s for ${url}`);
      const network = err instanceof TypeError; // fetch's "fetch failed" / "terminated"
      if (attempt >= retries || !(network || err.status >= 500)) {
        throw network ? new Error(`${err.message}${err.cause?.code ? ` (${err.cause.code})` : ''} for ${url}`) : err;
      }
      await new Promise((r) => setTimeout(r, 750 * (attempt + 1)));
    }
  }
}

const getJson = (url, { retries } = {}) => request(url, { accept: 'application/json', read: (res) => res.json(), retries });
const getText = (url, { retries } = {}) => request(url, { accept: '*/*', read: (res) => res.text(), retries });

module.exports = { getJson, getText };

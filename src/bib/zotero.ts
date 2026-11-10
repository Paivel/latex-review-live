import * as http from "http";

export class ZoteroUnavailable extends Error {}
export class NotInZotero extends Error {}

/**
 * Export one entry by citation key through Better BibTeX's JSON-RPC endpoint.
 * Throws ZoteroUnavailable when Zotero (or Better BibTeX) is not reachable,
 * NotInZotero when the key does not exist in the library.
 */
export function exportEntry(server: string, citekey: string, translator: string, timeoutMs = 10000): Promise<string> {
  const url = new URL("/better-bibtex/json-rpc", server);
  const body = JSON.stringify({ jsonrpc: "2.0", method: "item.export", params: [[citekey], translator], id: 1 });
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }, timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          if (res.statusCode !== 200) return reject(new ZoteroUnavailable(`Better BibTeX answered ${res.statusCode}`));
          try {
            const reply = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (reply.error) {
              const msg = String(reply.error.message ?? reply.error);
              return reject(/not found|duplicates/.test(msg) ? new NotInZotero(msg) : new Error(msg));
            }
            const r = reply.result;
            // Older Better BibTeX versions return [status, contentType, text].
            resolve(typeof r === "string" ? r : Array.isArray(r) ? String(r[2] ?? "") : "");
          } catch (e) {
            reject(new ZoteroUnavailable(`Unexpected reply from Zotero: ${e}`));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new ZoteroUnavailable("Zotero did not answer")));
    req.on("error", (e) => reject(e instanceof ZoteroUnavailable ? e : new ZoteroUnavailable(e.message)));
    req.end(body);
  });
}

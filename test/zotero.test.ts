import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as http from "http";
import { AddressInfo } from "net";
import { exportEntry, NotInZotero, ZoteroUnavailable } from "../src/bib/zotero";

let server: http.Server;
let url = "";
beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const r = JSON.parse(body);
      const key = r.params[0][0];
      res.setHeader("Content-Type", "application/json");
      if (r.method !== "item.export" || req.url !== "/better-bibtex/json-rpc") return res.end("{}");
      if (key === "missing") return res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32602, message: "not found: missing" }, id: 1 }));
      if (key === "old") return res.end(JSON.stringify({ jsonrpc: "2.0", result: [200, "text/plain", "@article{old,}"], id: 1 }));
      res.end(JSON.stringify({ jsonrpc: "2.0", result: `@article{${key},\n  title = {${r.params[1]}}\n}\n`, id: 1 }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe("zotero export", () => {
  it("returns the entry", async () => {
    expect(await exportEntry(url, "k1", "Better BibTeX")).toContain("@article{k1,");
    expect(await exportEntry(url, "old", "Better BibTeX")).toBe("@article{old,}");
  });
  it("reports missing keys", async () => {
    await expect(exportEntry(url, "missing", "Better BibTeX")).rejects.toBeInstanceOf(NotInZotero);
  });
  it("reports Zotero not running", async () => {
    await expect(exportEntry("http://127.0.0.1:1", "k", "Better BibTeX")).rejects.toBeInstanceOf(ZoteroUnavailable);
  });
});

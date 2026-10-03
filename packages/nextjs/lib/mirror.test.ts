import { describe, expect, it, vi } from "vitest";

import {
  MirrorError,
  decodeTopicMessageBody,
  evmToAccountId,
  evmToContractId,
  evmToHederaId,
  evmToTokenId,
  getAccountTokens,
  getAllContractLogs,
  getAllTopicMessages,
  getContractLogs,
  getContractResultByHash,
  getTopicMessages,
  toTransactionId,
} from "./mirror";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetchOnce(body: unknown, status = 200) {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(body, status));
  return fetchImpl;
}

describe("getContractResultByHash", () => {
  it("fetches the contract result for a transaction hash", async () => {
    const result = { from: "0xabc", to: "0xdef", hash: "0x123", timestamp: "2026-10-02T12:00:00.000Z", result: "SUCCESS", logs: [] };
    const fetchImpl = mockFetchOnce(result);
    const data = await getContractResultByHash("0x123", { fetchImpl });
    expect(data.hash).toBe("0x123");
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toContain("/api/v1/contracts/results/0x123");
  });

  it("throws a typed MirrorError on HTTP failure", async () => {
    const fetchImpl = mockFetchOnce({ _status: { messages: [] } }, 400);
    await expect(getContractResultByHash("0x123", { fetchImpl })).rejects.toMatchObject({
      name: "MirrorError",
      code: "HTTP",
      status: 400,
    });
  });

  it("maps aborts to a TIMEOUT error", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValueOnce(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
    await expect(getContractResultByHash("0x123", { fetchImpl })).rejects.toMatchObject({
      code: "TIMEOUT",
      status: null,
    });
  });

  it("maps other fetch failures to a NETWORK error", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("socket hangup"));
    await expect(getContractResultByHash("0x123", { fetchImpl })).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("maps invalid JSON to a BAD_JSON error", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("not json", { status: 200 }));
    await expect(getContractResultByHash("0x123", { fetchImpl })).rejects.toMatchObject({ code: "BAD_JSON" });
  });
});

describe("getContractLogs", () => {
  it("passes topic filters and returns one page", async () => {
    const fetchImpl = mockFetchOnce({ logs: [{ address: "0xdef" }], links: { next: null } });
    const page = await getContractLogs(
      "0xdef",
      { topics: ["0xtopic0", "0xtopic1"], order: "desc", limit: 25 },
      { fetchImpl },
    );
    expect(page.items).toHaveLength(1);
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toContain("topic0=0xtopic0");
    expect(url).toContain("topic1=0xtopic1");
    expect(url).toContain("order=desc");
    expect(url).toContain("limit=25");
  });

  it("follows pagination in getAllContractLogs", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ logs: [{ index: 1 }], links: { next: "/api/v1/contracts/0xdef/results/logs?cursor=a" } }))
      .mockResolvedValueOnce(jsonResponse({ logs: [{ index: 2 }], links: { next: null } }));
    const logs = await getAllContractLogs("0xdef", {}, { fetchImpl });
    expect(logs.map(l => l.index)).toEqual([1, 2]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("topic messages", () => {
  const helloBase64 = Buffer.from("hello verdict", "utf8").toString("base64");

  it("fetches a page of topic messages", async () => {
    const fetchImpl = mockFetchOnce({
      messages: [{ consensus_timestamp: "1790000000.000000001", sequence_number: 1, message: helloBase64 }],
      links: { next: null },
    });
    const page = await getTopicMessages("0.0.123", { order: "desc" }, { fetchImpl });
    expect(page.items[0].sequence_number).toBe(1);
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toContain("/api/v1/topics/0.0.123/messages");
  });

  it("decodes base64 and follows pagination in getAllTopicMessages", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          messages: [{ consensus_timestamp: "1790000000.000000001", sequence_number: 1, message: helloBase64 }],
          links: { next: "/api/v1/topics/0.0.123/messages?cursor=b" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          messages: [{ consensus_timestamp: "1790000001.000000001", sequence_number: 2, message: helloBase64 }],
          links: { next: null },
        }),
      );
    const messages = await getAllTopicMessages("0.0.123", {}, { fetchImpl });
    expect(messages).toEqual([
      { sequenceNumber: 1, consensusTimestamp: "1790000000.000000001", text: "hello verdict" },
      { sequenceNumber: 2, consensusTimestamp: "1790000001.000000001", text: "hello verdict" },
    ]);
  });

  it("decodes base64 to utf8", () => {
    expect(decodeTopicMessageBody(helloBase64)).toBe("hello verdict");
  });
});

describe("getAccountTokens", () => {
  it("follows pagination and flattens tokens", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ tokens: [{ token_id: "0.0.1" }], links: { next: "/api/v1/accounts/0.0.9/tokens?cursor=c" } }))
      .mockResolvedValueOnce(jsonResponse({ tokens: [{ token_id: "0.0.2" }], links: { next: null } }));
    const tokens = await getAccountTokens("0.0.9", { fetchImpl });
    expect(tokens.map(t => t.token_id)).toEqual(["0.0.1", "0.0.2"]);
  });
});

describe("evm address resolution", () => {
  it("resolves an account id", async () => {
    const fetchImpl = mockFetchOnce({ account: "0.0.42" });
    expect(await evmToAccountId("0xabc", { fetchImpl })).toBe("0.0.42");
  });

  it("resolves a contract id", async () => {
    const fetchImpl = mockFetchOnce({ contract_id: "0.0.43" });
    expect(await evmToContractId("0xabc", { fetchImpl })).toBe("0.0.43");
  });

  it("resolves a token id", async () => {
    const fetchImpl = mockFetchOnce({ token_id: "0.0.44" });
    expect(await evmToTokenId("0xabc", { fetchImpl })).toBe("0.0.44");
  });

  it("returns null on 404", async () => {
    const fetchImpl = mockFetchOnce({ _status: { messages: [] } }, 404);
    expect(await evmToAccountId("0xabc", { fetchImpl })).toBeNull();
  });

  it("tries account, contract and token in turn", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ _status: { messages: [] } }, 404))
      .mockResolvedValueOnce(jsonResponse({ contract_id: "0.0.43" }));
    expect(await evmToHederaId("0xabc", { fetchImpl })).toBe("0.0.43");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rethrows non-404 mirror errors", async () => {
    const fetchImpl = mockFetchOnce({}, 500);
    await expect(evmToAccountId("0xabc", { fetchImpl })).rejects.toBeInstanceOf(MirrorError);
  });
});

describe("toTransactionId", () => {
  it("builds a HashScan transaction id from an ISO timestamp", () => {
    expect(toTransactionId("0.0.7", "2026-10-09T16:00:00.000Z")).toMatch(/^0\.0\.7@\d+\.\d{9}$/);
  });

  it("pads a consensus timestamp fraction to nine digits", () => {
    expect(toTransactionId("0.0.7", "1790000000.12")).toBe("0.0.7@1790000000.120000000");
  });
});

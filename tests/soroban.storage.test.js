const request = require("supertest");
const cacheService = require("../src/services/cache");

jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    sorobanServer: {
      getLedgerEntries: jest.fn(),
    },
  };
});

jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...actual,
    scValToNative: jest.fn((scv) => {
      if (scv.switch && scv.switch().name === "scvSymbol" && scv.sym().toString() === "UNDECODABLE") {
        throw new Error("simulated decode failure");
      }
      return actual.scValToNative(scv);
    }),
  };
});

const { sorobanServer } = require("../src/config/stellar");
const { xdr, Contract, StrKey } = require("@stellar/stellar-sdk");
const app = require("../src/index");

function scEntry(keySymbol, val) {
  return new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(Buffer.from(keySymbol)), val });
}

function buildInstanceEntry({ contractId, storageEntries = [] }) {
  const address = new Contract(contractId).address().toScAddress();
  const executable = new xdr.ContractExecutable("contractExecutableWasm", Buffer.alloc(32, 1));
  const instance = new xdr.ScContractInstance({
    executable,
    storage: storageEntries.length ? storageEntries : null,
  });

  const contractData = new xdr.ContractDataEntry({
    ext: new xdr.ExtensionPoint(0),
    contract: address,
    key: xdr.ScVal.scvLedgerKeyContractInstance(),
    durability: xdr.ContractDataDurability.persistent(),
    val: xdr.ScVal.scvContractInstance(instance),
  });

  return {
    lastModifiedLedgerSeq: 42,
    liveUntilLedgerSeq: 999,
    val: xdr.LedgerEntryData.contractData(contractData),
  };
}

describe("GET /soroban/contract/:id/storage", () => {
  const contractId = StrKey.encodeContract(Buffer.alloc(32, 3));

  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  it("returns decoded storage entries with no raw Horizon/XDR fields", async () => {
    const entry = buildInstanceEntry({
      contractId,
      storageEntries: [scEntry("counter", xdr.ScVal.scvU32(7))],
    });
    sorobanServer.getLedgerEntries.mockResolvedValue({ entries: [entry] });

    const res = await request(app).get(`/soroban/contract/${contractId}/storage`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({
      contractId,
      entries: [{ key: "counter", value: 7, type: "decoded" }],
      lastModifiedLedger: 42,
      expiryLedger: 999,
    });
  });

  it("converts bigint (u64/i128) values to strings instead of raw XDR", async () => {
    const entry = buildInstanceEntry({
      contractId,
      storageEntries: [scEntry("total", xdr.ScVal.scvU64(new xdr.Uint64(123456789n)))],
    });
    sorobanServer.getLedgerEntries.mockResolvedValue({ entries: [entry] });

    const res = await request(app).get(`/soroban/contract/${contractId}/storage`);

    expect(res.body.data.entries).toEqual([{ key: "total", value: "123456789", type: "decoded" }]);
  });

  it("falls back to raw base64 XDR when a value can't be decoded", async () => {
    const entry = buildInstanceEntry({
      contractId,
      storageEntries: [scEntry("bad", xdr.ScVal.scvSymbol(Buffer.from("UNDECODABLE")))],
    });
    sorobanServer.getLedgerEntries.mockResolvedValue({ entries: [entry] });

    const res = await request(app).get(`/soroban/contract/${contractId}/storage`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.entries[0].type).toBe("raw");
    expect(typeof res.body.data.entries[0].value).toBe("string");
  });

  it("truncates entries to the ?limit= param", async () => {
    const entry = buildInstanceEntry({
      contractId,
      storageEntries: [
        scEntry("a", xdr.ScVal.scvU32(1)),
        scEntry("b", xdr.ScVal.scvU32(2)),
        scEntry("c", xdr.ScVal.scvU32(3)),
      ],
    });
    sorobanServer.getLedgerEntries.mockResolvedValue({ entries: [entry] });

    const res = await request(app).get(`/soroban/contract/${contractId}/storage?limit=1`);

    expect(res.body.data.entries).toHaveLength(1);
  });

  it("returns 404 when the contract is not found", async () => {
    sorobanServer.getLedgerEntries.mockResolvedValue({ entries: [] });

    const res = await request(app).get(`/soroban/contract/${contractId}/storage`);

    expect(res.statusCode).toBe(404);
    expect(res.body.error.type).toBe("ContractNotFound");
  });

  it("validates the contract ID", async () => {
    const res = await request(app).get("/soroban/contract/NOT_A_CONTRACT/storage");

    expect(res.statusCode).toBe(400);
    expect(res.body.error.type).toBe("ValidationError");
  });

  describe("caching", () => {
    beforeEach(() => {
      const entry = buildInstanceEntry({
        contractId,
        storageEntries: [scEntry("counter", xdr.ScVal.scvU32(7))],
      });
      sorobanServer.getLedgerEntries.mockResolvedValue({ entries: [entry] });
    });

    it("returns X-Cache: MISS on first request", async () => {
      const res = await request(app).get(`/soroban/contract/${contractId}/storage`);
      expect(res.headers["x-cache"]).toBe("MISS");
    });

    it("returns X-Cache: HIT on second request", async () => {
      await request(app).get(`/soroban/contract/${contractId}/storage`);
      const res = await request(app).get(`/soroban/contract/${contractId}/storage`);
      expect(res.headers["x-cache"]).toBe("HIT");
      expect(sorobanServer.getLedgerEntries).toHaveBeenCalledTimes(1);
    });

    it("returns X-Cache: MISS and refetches when ?fresh=true is used", async () => {
      await request(app).get(`/soroban/contract/${contractId}/storage`);
      const res = await request(app).get(`/soroban/contract/${contractId}/storage?fresh=true`);
      expect(res.headers["x-cache"]).toBe("MISS");
      expect(sorobanServer.getLedgerEntries).toHaveBeenCalledTimes(2);
    });
  });
});

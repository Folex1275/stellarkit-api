const request = require("supertest");
const { xdr, Contract, StrKey } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    sorobanServer: {
      getLedgerEntries: jest.fn(),
    },
  };
});

const { sorobanServer } = require("../src/config/stellar");
const app = require("../src/index");

function buildInstanceEntry({ contractId, executableType = "wasm", wasmHash, storageEntries = [] }) {
  const address = new Contract(contractId).address().toScAddress();
  const executable =
    executableType === "wasm"
      ? new xdr.ContractExecutable("contractExecutableWasm", wasmHash || Buffer.alloc(32, 1))
      : new xdr.ContractExecutable("contractExecutableStellarAsset", undefined);

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
    lastModifiedLedgerSeq: 100,
    liveUntilLedgerSeq: 200,
    val: xdr.LedgerEntryData.contractData(contractData),
  };
}

describe("GET /soroban/contract/:id", () => {
  const contractId = StrKey.encodeContract(Buffer.alloc(32, 2));

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns normalized wasm contract details", async () => {
    const wasmHash = Buffer.alloc(32, 7);
    sorobanServer.getLedgerEntries.mockResolvedValue({
      entries: [buildInstanceEntry({ contractId, executableType: "wasm", wasmHash })],
    });

    const res = await request(app).get(`/soroban/contract/${contractId}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({
      contractId,
      executable: { type: "wasm", wasmHash: wasmHash.toString("hex") },
      lastModifiedLedger: 100,
      expiryLedger: 200,
    });
  });

  it("returns normalized stellar_asset contract details", async () => {
    sorobanServer.getLedgerEntries.mockResolvedValue({
      entries: [buildInstanceEntry({ contractId, executableType: "stellar_asset" })],
    });

    const res = await request(app).get(`/soroban/contract/${contractId}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.executable).toEqual({ type: "stellar_asset", wasmHash: null });
  });

  it("returns 404 when the contract is not found", async () => {
    sorobanServer.getLedgerEntries.mockResolvedValue({ entries: [] });

    const res = await request(app).get(`/soroban/contract/${contractId}`);

    expect(res.statusCode).toBe(404);
    expect(res.body.error.type).toBe("ContractNotFound");
  });

  it("validates the contract ID", async () => {
    const res = await request(app).get("/soroban/contract/NOT_A_CONTRACT");

    expect(res.statusCode).toBe(400);
    expect(res.body.error.type).toBe("ValidationError");
    expect(sorobanServer.getLedgerEntries).not.toHaveBeenCalled();
  });
});

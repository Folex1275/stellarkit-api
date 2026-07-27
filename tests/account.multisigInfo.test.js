/**
 * Tests for GET /account/:id/multisig-info
 *
 * Covers:
 *   - Returns isMultisig, thresholds (low/med/high), masterWeight, signers list
 *   - isMultisig=true  when multiple signers exist
 *   - isMultisig=false when account has only the master key with default thresholds
 *   - isMultisig=true  when thresholds exceed the master key weight
 *   - Signer types are normalized (ed25519_public_key, hash_x, pre_auth_tx)
 *   - Returns 404 when account does not exist
 *   - Returns 400 for an invalid account address
 */
const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => ({
  ...jest.requireActual("../src/config/stellar"),
  server: {
    loadAccount: jest.fn(),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
});

const accountId = Keypair.random().publicKey();
const signer1 = Keypair.random().publicKey();
const signer2 = Keypair.random().publicKey();

// ── Happy path: multisig account ──────────────────────────────────────────

describe("GET /account/:id/multisig-info — multisig account", () => {
  beforeEach(() => {
    server.loadAccount.mockResolvedValue({
      id: accountId,
      signers: [
        { key: accountId, type: "ed25519_public_key", weight: 1 },
        { key: signer1, type: "ed25519_public_key", weight: 3 },
        { key: signer2, type: "sha256_hash", weight: 2 },
      ],
      thresholds: {
        low_threshold: 1,
        med_threshold: 3,
        high_threshold: 5,
      },
    });
  });

  it("returns HTTP 200", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    expect(res.statusCode).toBe(200);
  });

  it("success flag is true", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    expect(res.body.success).toBe(true);
  });

  it("isMultisig is true when there are multiple signers", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    expect(res.body.data.isMultisig).toBe(true);
  });

  it("returns the correct accountId", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    expect(res.body.data.accountId).toBe(accountId);
  });

  it("thresholds object contains low, med, high", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    const { thresholds } = res.body.data;
    expect(thresholds).toEqual({ low: 1, med: 3, high: 5 });
  });

  it("masterWeight equals the weight of the account's own key", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    expect(res.body.data.masterWeight).toBe(1);
  });

  it("signers array includes all registered signers", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    expect(res.body.data.signers).toHaveLength(3);
  });

  it("signerCount matches the length of signers array", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    expect(res.body.data.signerCount).toBe(res.body.data.signers.length);
  });

  it("each signer has key, weight, and type fields", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    for (const signer of res.body.data.signers) {
      expect(signer).toHaveProperty("key");
      expect(signer).toHaveProperty("weight");
      expect(signer).toHaveProperty("type");
    }
  });

  it("sha256_hash signer type is normalized correctly", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    const hashXSigner = res.body.data.signers.find((s) => s.key === signer2);
    expect(hashXSigner).toBeDefined();
    expect(hashXSigner.type).toBe("hash_x");
  });
});

// ── Single-signer account (not multisig) ─────────────────────────────────

describe("GET /account/:id/multisig-info — single signer account", () => {
  beforeEach(() => {
    server.loadAccount.mockResolvedValue({
      id: accountId,
      signers: [
        { key: accountId, type: "ed25519_public_key", weight: 1 },
      ],
      thresholds: {
        low_threshold: 1,
        med_threshold: 1,
        high_threshold: 1,
      },
    });
  });

  it("isMultisig is false for a single-signer account", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.isMultisig).toBe(false);
  });

  it("signerCount is 1", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    expect(res.body.data.signerCount).toBe(1);
  });
});

// ── isMultisig=true via threshold exceeding master weight ─────────────────

describe("GET /account/:id/multisig-info — high threshold exceeds master weight", () => {
  beforeEach(() => {
    server.loadAccount.mockResolvedValue({
      id: accountId,
      signers: [
        { key: accountId, type: "ed25519_public_key", weight: 1 },
        { key: signer1, type: "ed25519_public_key", weight: 5 },
      ],
      thresholds: {
        low_threshold: 1,
        med_threshold: 3,
        high_threshold: 6,
      },
    });
  });

  it("isMultisig is true because high threshold (6) exceeds master weight (1)", async () => {
    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    expect(res.body.data.isMultisig).toBe(true);
  });
});

// ── Error cases ───────────────────────────────────────────────────────────

describe("GET /account/:id/multisig-info — error cases", () => {
  it("returns 404 when account does not exist on Horizon", async () => {
    const horizonError = new Error("Not found");
    horizonError.response = { status: 404, data: { title: "Resource Missing" } };
    server.loadAccount.mockRejectedValue(horizonError);

    const res = await request(app).get(`/account/${accountId}/multisig-info`);
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 for an invalid account address", async () => {
    const res = await request(app).get("/account/NOTAVALIDKEY/multisig-info");
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

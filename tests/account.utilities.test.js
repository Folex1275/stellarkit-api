const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const { Keypair } = require("@stellar/stellar-sdk");
const cacheService = require("../src/services/cache");

// Mock Horizon server
jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      loadAccount: jest.fn(),
    },
  };
});

describe("Account Utility Endpoints", () => {
  const VALID_ACCOUNT_ID = "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";
  const INVALID_ACCOUNT_ID = "INVALID_KEY";
  const signer1 = Keypair.random().publicKey();
  const signer2 = Keypair.random().publicKey();

  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /account/:id/sequence
  // ═══════════════════════════════════════════════════════════════════════════
  describe("GET /account/:id/sequence", () => {
    describe("✓ Valid input", () => {
      it("returns accountId, sequence, and lastModifiedLedger", async () => {
        server.loadAccount.mockResolvedValue({
          id: VALID_ACCOUNT_ID,
          sequence: "123456789",
          last_modified_ledger: 42,
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/sequence`);

        expect(res.statusCode).toBe(200);
        expect(server.loadAccount).toHaveBeenCalledWith(VALID_ACCOUNT_ID);
        expect(res.body).toEqual({
          success: true,
          data: {
            accountId: VALID_ACCOUNT_ID,
            sequence: "123456789",
            lastModifiedLedger: 42,
          },
        });
        // First call should be a cache miss
        expect(res.headers["x-cache"]).toBe("MISS");
      });

      it("handles large sequence numbers", async () => {
        const largeSequence = "999999999999999999";
        server.loadAccount.mockResolvedValue({
          id: VALID_ACCOUNT_ID,
          sequence: largeSequence,
          last_modified_ledger: 1000000,
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/sequence`);

        expect(res.statusCode).toBe(200);
        expect(res.body.data.sequence).toBe(largeSequence);
      });

      it("returns X-Cache: HIT on repeated requests for the same account", async () => {
        server.loadAccount.mockResolvedValue({
          id: VALID_ACCOUNT_ID,
          sequence: "123456789",
          last_modified_ledger: 42,
        });

        const res1 = await request(app).get(`/account/${VALID_ACCOUNT_ID}/sequence`);
        expect(res1.statusCode).toBe(200);
        expect(res1.headers["x-cache"]).toBe("MISS");

        // Second call should hit cache
        const res2 = await request(app).get(`/account/${VALID_ACCOUNT_ID}/sequence`);
        expect(res2.statusCode).toBe(200);
        expect(res2.headers["x-cache"]).toBe("HIT");

        // loadAccount should only have been called once
        expect(server.loadAccount).toHaveBeenCalledTimes(1);
      });

      it("bypasses cache when fresh=true is specified", async () => {
        server.loadAccount.mockResolvedValue({
          id: VALID_ACCOUNT_ID,
          sequence: "123456789",
          last_modified_ledger: 42,
        });

        const res1 = await request(app).get(`/account/${VALID_ACCOUNT_ID}/sequence`);
        expect(res1.headers["x-cache"]).toBe("MISS");

        // fresh=true should bypass cache
        const res2 = await request(app).get(`/account/${VALID_ACCOUNT_ID}/sequence?fresh=true`);
        expect(res2.statusCode).toBe(200);
        expect(res2.headers["x-cache"]).toBe("MISS");

        // loadAccount should have been called twice (once for each miss)
        expect(server.loadAccount).toHaveBeenCalledTimes(2);
      });

      it("caches different account IDs independently", async () => {
        const account2 = Keypair.random().publicKey();

        server.loadAccount.mockImplementation((id) => {
          if (id === VALID_ACCOUNT_ID) {
            return Promise.resolve({
              id: VALID_ACCOUNT_ID,
              sequence: "111",
              last_modified_ledger: 1,
            });
          }
          return Promise.resolve({
            id: account2,
            sequence: "222",
            last_modified_ledger: 2,
          });
        });

        const res1 = await request(app).get(`/account/${VALID_ACCOUNT_ID}/sequence`);
        expect(res1.headers["x-cache"]).toBe("MISS");
        expect(res1.body.data.sequence).toBe("111");

        const res2 = await request(app).get(`/account/${account2}/sequence`);
        expect(res2.headers["x-cache"]).toBe("MISS");
        expect(res2.body.data.sequence).toBe("222");

        // Both IDs should now be cached
        const res3 = await request(app).get(`/account/${VALID_ACCOUNT_ID}/sequence`);
        expect(res3.headers["x-cache"]).toBe("HIT");
        expect(res3.body.data.sequence).toBe("111");

        const res4 = await request(app).get(`/account/${account2}/sequence`);
        expect(res4.headers["x-cache"]).toBe("HIT");
        expect(res4.body.data.sequence).toBe("222");
      });
    });

    describe("✗ Invalid input", () => {
      it("returns 400 for invalid account ID", async () => {
        const res = await request(app).get(`/account/${INVALID_ACCOUNT_ID}/sequence`);

        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.type).toBe("ValidationError");
        expect(res.body.error.message).toContain("Invalid Stellar account ID");
      });

      it("returns 404 for non-existent account", async () => {
        server.loadAccount.mockRejectedValue({
          response: { status: 404 },
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/sequence`);

        expect(res.statusCode).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error.message).toBe("Account not found.");
      });
    });

    describe("Response shape validation", () => {
      it("contains all required fields", async () => {
        server.loadAccount.mockResolvedValue({
          id: VALID_ACCOUNT_ID,
          sequence: "123456789",
          last_modified_ledger: 42,
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/sequence`);

        expect(res.body).toHaveProperty("success");
        expect(res.body).toHaveProperty("data");
        expect(res.body.data).toHaveProperty("accountId");
        expect(res.body.data).toHaveProperty("sequence");
        expect(res.body.data).toHaveProperty("lastModifiedLedger");
        expect(Object.keys(res.body.data)).toHaveLength(3);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /account/:id/home-domain
  // ═══════════════════════════════════════════════════════════════════════════
  describe("GET /account/:id/home-domain", () => {
    describe("✓ Valid input", () => {
      it("returns accountId, homeDomain, and lastModifiedLedger when home domain is set", async () => {
        server.loadAccount.mockResolvedValue({
          id: VALID_ACCOUNT_ID,
          home_domain: "example.com",
          last_modified_ledger: 42,
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/home-domain`);

        expect(res.statusCode).toBe(200);
        expect(server.loadAccount).toHaveBeenCalledWith(VALID_ACCOUNT_ID);
        expect(res.body).toEqual({
          success: true,
          data: {
            accountId: VALID_ACCOUNT_ID,
            homeDomain: "example.com",
            lastModifiedLedger: 42,
          },
        });
      });

      it("returns null homeDomain when not set", async () => {
        server.loadAccount.mockResolvedValue({
          id: VALID_ACCOUNT_ID,
          home_domain: null,
          last_modified_ledger: 42,
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/home-domain`);

        expect(res.statusCode).toBe(200);
        expect(res.body.data.homeDomain).toBe(null);
      });

      it("handles missing home_domain field", async () => {
        server.loadAccount.mockResolvedValue({
          id: VALID_ACCOUNT_ID,
          last_modified_ledger: 42,
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/home-domain`);

        expect(res.statusCode).toBe(200);
        expect(res.body.data.homeDomain).toBe(null);
      });
    });

    describe("✗ Invalid input", () => {
      it("returns 400 for invalid account ID", async () => {
        const res = await request(app).get(`/account/${INVALID_ACCOUNT_ID}/home-domain`);

        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.type).toBe("ValidationError");
      });

      it("returns 404 for non-existent account", async () => {
        server.loadAccount.mockRejectedValue({
          response: { status: 404 },
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/home-domain`);

        expect(res.statusCode).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error.message).toBe("Account not found.");
      });
    });

    describe("Response shape validation", () => {
      it("contains all required fields", async () => {
        server.loadAccount.mockResolvedValue({
          id: VALID_ACCOUNT_ID,
          home_domain: "stellar.org",
          last_modified_ledger: 100,
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/home-domain`);

        expect(res.body).toHaveProperty("success");
        expect(res.body).toHaveProperty("data");
        expect(res.body.data).toHaveProperty("accountId");
        expect(res.body.data).toHaveProperty("homeDomain");
        expect(res.body.data).toHaveProperty("lastModifiedLedger");
        expect(Object.keys(res.body.data)).toHaveLength(3);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /account/:id/min-balance
  // ═══════════════════════════════════════════════════════════════════════════
  describe("GET /account/:id/min-balance", () => {
    describe("✓ Valid input", () => {
      it("calculates minimum balance correctly for account with no subentries", async () => {
        server.loadAccount.mockResolvedValue({
          id: VALID_ACCOUNT_ID,
          subentry_count: 0,
          last_modified_ledger: 42,
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/min-balance`);

        expect(res.statusCode).toBe(200);
        expect(server.loadAccount).toHaveBeenCalledWith(VALID_ACCOUNT_ID);
        expect(res.body.data.accountId).toBe(VALID_ACCOUNT_ID);
        expect(res.body.data.subentryCount).toBe(0);
        expect(res.body.data.baseReserve.xlm).toBe("0.5000000");
        expect(res.body.data.baseReserve.stroops).toBe(5000000);
        expect(res.body.data.minimumBalance.xlm).toBe("1.0000000"); // 2 * 0.5
        expect(res.body.data.minimumBalance.stroops).toBe(10000000);
        expect(res.body.data.reserveBreakdown.accountReserve.xlm).toBe("1.0000000");
        expect(res.body.data.reserveBreakdown.subentryReserve.xlm).toBe("0.0000000");
      });

      it("calculates minimum balance correctly for account with subentries", async () => {
        server.loadAccount.mockResolvedValue({
          id: VALID_ACCOUNT_ID,
          subentry_count: 5,
          last_modified_ledger: 42,
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/min-balance`);

        expect(res.statusCode).toBe(200);
        expect(res.body.data.subentryCount).toBe(5);
        expect(res.body.data.minimumBalance.xlm).toBe("3.5000000"); // (2 + 5) * 0.5
        expect(res.body.data.minimumBalance.stroops).toBe(35000000);
        expect(res.body.data.reserveBreakdown.accountReserve.xlm).toBe("1.0000000");
        expect(res.body.data.reserveBreakdown.subentryReserve.xlm).toBe("2.5000000");
      });

      it("handles large number of subentries", async () => {
        server.loadAccount.mockResolvedValue({
          id: VALID_ACCOUNT_ID,
          subentry_count: 100,
          last_modified_ledger: 42,
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/min-balance`);

        expect(res.statusCode).toBe(200);
        expect(res.body.data.subentryCount).toBe(100);
        expect(res.body.data.minimumBalance.xlm).toBe("51.0000000"); // (2 + 100) * 0.5
        expect(res.body.data.minimumBalance.stroops).toBe(510000000);
      });
    });

    describe("✗ Invalid input", () => {
      it("returns 400 for invalid account ID", async () => {
        const res = await request(app).get(`/account/${INVALID_ACCOUNT_ID}/min-balance`);

        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.type).toBe("ValidationError");
      });

      it("returns 404 for non-existent account", async () => {
        server.loadAccount.mockRejectedValue({
          response: { status: 404 },
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/min-balance`);

        expect(res.statusCode).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error.message).toBe("Account not found.");
      });
    });

    describe("Response shape validation", () => {
      it("contains all required fields with correct structure", async () => {
        server.loadAccount.mockResolvedValue({
          id: VALID_ACCOUNT_ID,
          subentry_count: 3,
          last_modified_ledger: 100,
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/min-balance`);

        expect(res.body).toHaveProperty("success");
        expect(res.body).toHaveProperty("data");
        expect(res.body.data).toHaveProperty("accountId");
        expect(res.body.data).toHaveProperty("subentryCount");
        expect(res.body.data).toHaveProperty("baseReserve");
        expect(res.body.data).toHaveProperty("minimumBalance");
        expect(res.body.data).toHaveProperty("reserveBreakdown");
        expect(res.body.data).toHaveProperty("lastModifiedLedger");

        // Check nested structure
        expect(res.body.data.baseReserve).toHaveProperty("xlm");
        expect(res.body.data.baseReserve).toHaveProperty("stroops");
        expect(res.body.data.minimumBalance).toHaveProperty("xlm");
        expect(res.body.data.minimumBalance).toHaveProperty("stroops");
        expect(res.body.data.reserveBreakdown).toHaveProperty("accountReserve");
        expect(res.body.data.reserveBreakdown).toHaveProperty("subentryReserve");
      });

      it("returns values in correct format", async () => {
        server.loadAccount.mockResolvedValue({
          id: VALID_ACCOUNT_ID,
          subentry_count: 2,
          last_modified_ledger: 100,
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/min-balance`);

        // XLM values should be strings with 7 decimal places
        expect(res.body.data.baseReserve.xlm).toMatch(/^\d+\.\d{7}$/);
        expect(res.body.data.minimumBalance.xlm).toMatch(/^\d+\.\d{7}$/);
        
        // Stroops should be numbers
        expect(typeof res.body.data.baseReserve.stroops).toBe("number");
        expect(typeof res.body.data.minimumBalance.stroops).toBe("number");
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /account/:id/flags
  // ═══════════════════════════════════════════════════════════════════════════
  describe("GET /account/:id/flags", () => {
    describe("✓ Valid input", () => {
      it("returns all flags when set to true", async () => {
        server.loadAccount.mockResolvedValue({
          id: VALID_ACCOUNT_ID,
          flags: {
            auth_required: true,
            auth_revocable: true,
            auth_immutable: true,
            auth_clawback_enabled: true,
          },
          last_modified_ledger: 42,
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/flags`);

        expect(res.statusCode).toBe(200);
        expect(server.loadAccount).toHaveBeenCalledWith(VALID_ACCOUNT_ID);
        expect(res.body.data).toEqual({
          accountId: VALID_ACCOUNT_ID,
          flags: {
            authRequired: true,
            authRevocable: true,
            authImmutable: true,
            authClawbackEnabled: true,
          },
          lastModifiedLedger: 42,
        });
      });

      it("returns all flags as false when not set", async () => {
        server.loadAccount.mockResolvedValue({
          id: VALID_ACCOUNT_ID,
          flags: {},
          last_modified_ledger: 42,
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/flags`);

        expect(res.statusCode).toBe(200);
        expect(res.body.data.flags).toEqual({
          authRequired: false,
          authRevocable: false,
          authImmutable: false,
          authClawbackEnabled: false,
        });
      });

      it("returns mixed flag values correctly", async () => {
        server.loadAccount.mockResolvedValue({
          id: VALID_ACCOUNT_ID,
          flags: {
            auth_required: true,
            auth_revocable: false,
            auth_immutable: false,
            auth_clawback_enabled: true,
          },
          last_modified_ledger: 42,
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/flags`);

        expect(res.statusCode).toBe(200);
        expect(res.body.data.flags.authRequired).toBe(true);
        expect(res.body.data.flags.authRevocable).toBe(false);
        expect(res.body.data.flags.authImmutable).toBe(false);
        expect(res.body.data.flags.authClawbackEnabled).toBe(true);
      });
    });

    describe("✗ Invalid input", () => {
      it("returns 400 for invalid account ID", async () => {
        const res = await request(app).get(`/account/${INVALID_ACCOUNT_ID}/flags`);

        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.type).toBe("ValidationError");
      });

      it("returns 404 for non-existent account", async () => {
        server.loadAccount.mockRejectedValue({
          response: { status: 404 },
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/flags`);

        expect(res.statusCode).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error.message).toBe("Account not found.");
      });
    });

    describe("Response shape validation", () => {
      it("contains all required fields with correct structure", async () => {
        server.loadAccount.mockResolvedValue({
          id: VALID_ACCOUNT_ID,
          flags: {
            auth_required: true,
            auth_revocable: false,
          },
          last_modified_ledger: 100,
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/flags`);

        expect(res.body).toHaveProperty("success");
        expect(res.body).toHaveProperty("data");
        expect(res.body.data).toHaveProperty("accountId");
        expect(res.body.data).toHaveProperty("flags");
        expect(res.body.data).toHaveProperty("lastModifiedLedger");
        expect(Object.keys(res.body.data)).toHaveLength(3);

        // Check all flag fields exist
        expect(res.body.data.flags).toHaveProperty("authRequired");
        expect(res.body.data.flags).toHaveProperty("authRevocable");
        expect(res.body.data.flags).toHaveProperty("authImmutable");
        expect(res.body.data.flags).toHaveProperty("authClawbackEnabled");
        expect(Object.keys(res.body.data.flags)).toHaveLength(4);
      });

      it("returns boolean values for all flags", async () => {
        server.loadAccount.mockResolvedValue({
          id: VALID_ACCOUNT_ID,
          flags: {
            auth_required: true,
          },
          last_modified_ledger: 100,
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/flags`);

        expect(typeof res.body.data.flags.authRequired).toBe("boolean");
        expect(typeof res.body.data.flags.authRevocable).toBe("boolean");
        expect(typeof res.body.data.flags.authImmutable).toBe("boolean");
        expect(typeof res.body.data.flags.authClawbackEnabled).toBe("boolean");
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /account/:id/signers
  // ═══════════════════════════════════════════════════════════════════════════
  describe("GET /account/:id/signers", () => {
    describe("✓ Valid input", () => {
      it("returns signers and thresholds for single-sig account", async () => {
        server.loadAccount.mockResolvedValue({
          id: VALID_ACCOUNT_ID,
          signers: [
            {
              key: VALID_ACCOUNT_ID,
              weight: 1,
              type: "ed25519_public_key",
            },
          ],
          thresholds: {
            low_threshold: 0,
            med_threshold: 0,
            high_threshold: 0,
          },
          last_modified_ledger: 42,
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/signers`);

        expect(res.statusCode).toBe(200);
        expect(server.loadAccount).toHaveBeenCalledWith(VALID_ACCOUNT_ID);
        expect(res.body.data).toEqual({
          accountId: VALID_ACCOUNT_ID,
          signers: [
            {
              key: VALID_ACCOUNT_ID,
              weight: 1,
              type: "ed25519_public_key",
              sponsor: null,
            },
          ],
          thresholds: {
            lowThreshold: 0,
            medThreshold: 0,
            highThreshold: 0,
          },
          lastModifiedLedger: 42,
        });
      });

      it("returns multiple signers for multi-sig account", async () => {
        server.loadAccount.mockResolvedValue({
          id: VALID_ACCOUNT_ID,
          signers: [
            {
              key: VALID_ACCOUNT_ID,
              weight: 1,
              type: "ed25519_public_key",
            },
            {
              key: signer1,
              weight: 2,
              type: "ed25519_public_key",
            },
            {
              key: signer2,
              weight: 3,
              type: "sha256_hash",
            },
          ],
          thresholds: {
            low_threshold: 1,
            med_threshold: 3,
            high_threshold: 5,
          },
          last_modified_ledger: 42,
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/signers`);

        expect(res.statusCode).toBe(200);
        expect(res.body.data.signers).toHaveLength(3);
        expect(res.body.data.signers[0].weight).toBe(1);
        expect(res.body.data.signers[1].weight).toBe(2);
        expect(res.body.data.signers[2].weight).toBe(3);
        expect(res.body.data.signers[2].type).toBe("sha256_hash");
      });

      it("includes sponsor information when present", async () => {
        const sponsorAccount = Keypair.random().publicKey();
        server.loadAccount.mockResolvedValue({
          id: VALID_ACCOUNT_ID,
          signers: [
            {
              key: VALID_ACCOUNT_ID,
              weight: 1,
              type: "ed25519_public_key",
              sponsor: sponsorAccount,
            },
          ],
          thresholds: {
            low_threshold: 0,
            med_threshold: 0,
            high_threshold: 0,
          },
          last_modified_ledger: 42,
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/signers`);

        expect(res.statusCode).toBe(200);
        expect(res.body.data.signers[0].sponsor).toBe(sponsorAccount);
      });

      it("handles account with no additional signers", async () => {
        server.loadAccount.mockResolvedValue({
          id: VALID_ACCOUNT_ID,
          signers: [
            {
              key: VALID_ACCOUNT_ID,
              weight: 1,
              type: "ed25519_public_key",
            },
          ],
          thresholds: {
            low_threshold: 0,
            med_threshold: 0,
            high_threshold: 0,
          },
          last_modified_ledger: 42,
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/signers`);

        expect(res.statusCode).toBe(200);
        expect(res.body.data.signers).toHaveLength(1);
      });
    });

    describe("✗ Invalid input", () => {
      it("returns 400 for invalid account ID", async () => {
        const res = await request(app).get(`/account/${INVALID_ACCOUNT_ID}/signers`);

        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.type).toBe("ValidationError");
      });

      it("returns 404 for non-existent account", async () => {
        server.loadAccount.mockRejectedValue({
          response: { status: 404 },
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/signers`);

        expect(res.statusCode).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error.message).toBe("Account not found.");
      });
    });

    describe("Response shape validation", () => {
      it("contains all required fields with correct structure", async () => {
        server.loadAccount.mockResolvedValue({
          id: VALID_ACCOUNT_ID,
          signers: [
            {
              key: VALID_ACCOUNT_ID,
              weight: 1,
              type: "ed25519_public_key",
            },
            {
              key: signer1,
              weight: 2,
              type: "ed25519_public_key",
            },
          ],
          thresholds: {
            low_threshold: 1,
            med_threshold: 2,
            high_threshold: 3,
          },
          last_modified_ledger: 100,
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/signers`);

        expect(res.body).toHaveProperty("success");
        expect(res.body).toHaveProperty("data");
        expect(res.body.data).toHaveProperty("accountId");
        expect(res.body.data).toHaveProperty("signers");
        expect(res.body.data).toHaveProperty("thresholds");
        expect(res.body.data).toHaveProperty("lastModifiedLedger");
        expect(Object.keys(res.body.data)).toHaveLength(4);

        // Check thresholds structure
        expect(res.body.data.thresholds).toHaveProperty("lowThreshold");
        expect(res.body.data.thresholds).toHaveProperty("medThreshold");
        expect(res.body.data.thresholds).toHaveProperty("highThreshold");
        expect(Object.keys(res.body.data.thresholds)).toHaveLength(3);

        // Check signer structure
        expect(Array.isArray(res.body.data.signers)).toBe(true);
        res.body.data.signers.forEach((signer) => {
          expect(signer).toHaveProperty("key");
          expect(signer).toHaveProperty("weight");
          expect(signer).toHaveProperty("type");
          expect(signer).toHaveProperty("sponsor");
        });
      });

      it("returns correct data types for all fields", async () => {
        server.loadAccount.mockResolvedValue({
          id: VALID_ACCOUNT_ID,
          signers: [
            {
              key: VALID_ACCOUNT_ID,
              weight: 5,
              type: "ed25519_public_key",
            },
          ],
          thresholds: {
            low_threshold: 1,
            med_threshold: 2,
            high_threshold: 3,
          },
          last_modified_ledger: 100,
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/signers`);

        expect(typeof res.body.data.accountId).toBe("string");
        expect(Array.isArray(res.body.data.signers)).toBe(true);
        expect(typeof res.body.data.thresholds.lowThreshold).toBe("number");
        expect(typeof res.body.data.thresholds.medThreshold).toBe("number");
        expect(typeof res.body.data.thresholds.highThreshold).toBe("number");
        expect(typeof res.body.data.lastModifiedLedger).toBe("number");
        expect(typeof res.body.data.signers[0].weight).toBe("number");
        expect(typeof res.body.data.signers[0].key).toBe("string");
        expect(typeof res.body.data.signers[0].type).toBe("string");
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /account/:id/signing-keys
  // ═══════════════════════════════════════════════════════════════════════════
  describe("GET /account/:id/signing-keys", () => {
    it("returns a fully normalized camelCase signing-keys payload", async () => {
      server.loadAccount.mockResolvedValue({
        id: VALID_ACCOUNT_ID,
        signers: [
          { key: VALID_ACCOUNT_ID, weight: "1", type: "ed25519_public_key" },
          { key: signer1, weight: 2, type: "sha256_hash" },
          { key: signer2, weight: 3, type: "preauth_tx", sponsor: VALID_ACCOUNT_ID },
        ],
        thresholds: {
          low_threshold: 1,
          med_threshold: 2,
          high_threshold: 4,
        },
      });

      const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/signing-keys`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toEqual({
        signers: [
          {
            key: VALID_ACCOUNT_ID,
            weight: 1,
            type: "ed25519_public_key",
            sponsoredBy: null,
          },
          {
            key: signer1,
            weight: 2,
            type: "hash_x",
            sponsoredBy: null,
          },
          {
            key: signer2,
            weight: 3,
            type: "pre_auth_tx",
            sponsoredBy: VALID_ACCOUNT_ID,
          },
        ],
        masterWeight: 1,
        thresholds: {
          lowThreshold: 1,
          medThreshold: 2,
          highThreshold: 4,
        },
      });

      // Ensure no snake_case fields leaked into the normalized response.
      const json = JSON.stringify(res.body.data);
      expect(json).not.toContain("low_threshold");
      expect(json).not.toContain("med_threshold");
      expect(json).not.toContain("high_threshold");
      expect(json).not.toContain("sponsored_by");
    });

    it("always includes sponsoredBy and supports horizon enum style signer types", async () => {
      server.loadAccount.mockResolvedValue({
        id: VALID_ACCOUNT_ID,
        signers: [
          { key: VALID_ACCOUNT_ID, weight: 5, type: "signer_key_type_ed25519" },
          { key: signer1, weight: 3, type: "signer_key_type_hash_x" },
          { key: signer2, weight: 2, type: "signer_key_type_pre_auth_tx", sponsored_by: signer1 },
        ],
        thresholds: {
          low_threshold: 2,
          med_threshold: 4,
          high_threshold: 6,
        },
      });

      const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/signing-keys`);
      expect(res.statusCode).toBe(200);

      res.body.data.signers.forEach((signer) => {
        expect(signer).toHaveProperty("sponsoredBy");
      });
      expect(res.body.data.signers[0].type).toBe("ed25519_public_key");
      expect(res.body.data.signers[1].type).toBe("hash_x");
      expect(res.body.data.signers[2].type).toBe("pre_auth_tx");
      expect(res.body.data.signers[2].sponsoredBy).toBe(signer1);
      expect(res.body.data.masterWeight).toBe(5);
    });

    it("returns 404 for unknown account", async () => {
      server.loadAccount.mockRejectedValue({ response: { status: 404 } });

      const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/signing-keys`);

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe("Account not found.");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Edge Cases - All Endpoints
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Edge Cases - All Endpoints", () => {
    const endpoints = [
      "/sequence",
      "/home-domain",
      "/min-balance",
      "/flags",
      "/signers",
    ];

    describe("Missing parameters", () => {
      it("returns 404 when account ID is missing from URL", async () => {
        for (const endpoint of endpoints) {
          const res = await request(app).get(`/account${endpoint}`);
          expect(res.statusCode).toBe(404);
        }
      });
    });

    describe("Malformed account IDs", () => {
      const malformedIds = [
        "G",
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "XAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "!@#$%^&*()",
        "",
        " ",
      ];

      malformedIds.forEach((malformedId) => {
        it(`returns 400 for malformed ID: "${malformedId}"`, async () => {
          const res = await request(app).get(`/account/${encodeURIComponent(malformedId)}/sequence`);
          expect(res.statusCode).toBe(400);
          expect(res.body.success).toBe(false);
          // Blank/whitespace ids are rejected earlier as MissingParameter;
          // malformed-but-present ids fail validateAccountId as InvalidAccountId.
          expect(["InvalidAccountId", "MissingParameter"]).toContain(res.body.error.type);
        });
      });
    });

    describe("Network errors", () => {
      it("handles Horizon timeout errors gracefully", async () => {
        server.loadAccount.mockRejectedValue(new Error("Network timeout"));

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/sequence`);

        expect(res.statusCode).toBe(504);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toEqual({
          type: "HorizonTimeout",
          message: "The Stellar Horizon node did not respond in time.",
          suggestion:
            "Try again in a few seconds. If the issue persists check the Stellar network status at https://status.stellar.org.",
        });
      });

      it("handles generic server errors", async () => {
        server.loadAccount.mockRejectedValue({
          response: { status: 500 },
        });

        const res = await request(app).get(`/account/${VALID_ACCOUNT_ID}/flags`);

        expect(res.statusCode).toBe(500);
        expect(res.body.success).toBe(false);
      });
    });
  });
});

/**
 * Limit validation — standardised InvalidLimit error
 *
 * Acceptance criteria:
 *   Every paginated endpoint returns { type: "InvalidLimit", message: "limit must be a number
 *   between 1 and 100.", suggestion: "Provide a valid integer for the limit parameter, e.g. ?limit=20" }
 *   with HTTP 400 for invalid limit values.
 *
 * Covered endpoints:
 *   - GET /transactions/:id        (transactions.js)
 *   - GET /account/:id/effects     (account.js, via parsePaginationParams)
 *   - GET /account/:id/trades      (account.js, via parsePaginationParams)
 *   - GET /account/:id/offers      (account.js, via parsePaginationParams)
 *   - GET /account/:id/transaction-stats (account.js, via validateLimit directly)
 *
 * Invalid cases tested:
 *   - string value ("abc")
 *   - negative integer (-1)
 *   - zero (0)
 *   - over-max (101)
 */

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

// ─── Mocks must be hoisted before app is required ────────────────────────────

jest.mock("../src/config/stellar", () => ({
  ...jest.requireActual("../src/config/stellar"),
  server: {
    transactions: jest.fn(),
    effects: jest.fn(),
    trades: jest.fn(),
    offers: jest.fn(),
  },
  NETWORK: "testnet",
}));

const app = require("../src/index");
const { server } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_ACCOUNT = Keypair.random().publicKey();

/** Expected shape every invalid-limit response must match */
const INVALID_LIMIT_ERROR = {
  type: "InvalidLimit",
  message: "limit must be a number between 1 and 100.",
  suggestion: "Provide a valid integer for the limit parameter, e.g. ?limit=20",
};

/** Assert the response is a well-formed 400 InvalidLimit error */
function assertInvalidLimit(res) {
  expect(res.statusCode).toBe(400);
  expect(res.body.success).toBe(false);
  expect(res.body.error).toMatchObject(INVALID_LIMIT_ERROR);
}

function stubTransactions(records = []) {
  server.transactions.mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    includeFailed: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  });
}

function stubEffects(records = []) {
  server.effects.mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    type: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  });
}

function stubTrades(records = []) {
  server.trades.mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  });
}

function stubOffers(records = []) {
  server.offers.mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  });
}

// ─── Unit: validateLimit ──────────────────────────────────────────────────────

describe("validateLimit (unit)", () => {
  const { validateLimit } = require("../src/utils/validators");

  it("returns the parsed integer for a valid string number", () => {
    expect(validateLimit("20")).toBe(20);
  });

  it("returns the parsed integer for a valid number", () => {
    expect(validateLimit(50)).toBe(50);
  });

  it("throws isInvalidLimit for a string value", () => {
    expect(() => validateLimit("abc")).toThrow();
    try {
      validateLimit("abc");
    } catch (err) {
      expect(err.isInvalidLimit).toBe(true);
      expect(err.message).toBe("limit must be a number between 1 and 100.");
    }
  });

  it("throws isInvalidLimit for a negative value", () => {
    expect(() => validateLimit(-1)).toThrow();
    try {
      validateLimit(-1);
    } catch (err) {
      expect(err.isInvalidLimit).toBe(true);
    }
  });

  it("throws isInvalidLimit for zero", () => {
    expect(() => validateLimit(0)).toThrow();
    try {
      validateLimit(0);
    } catch (err) {
      expect(err.isInvalidLimit).toBe(true);
    }
  });

  it("throws isInvalidLimit when value exceeds max", () => {
    expect(() => validateLimit(101)).toThrow();
    try {
      validateLimit(101);
    } catch (err) {
      expect(err.isInvalidLimit).toBe(true);
    }
  });

  it("accepts exactly 1 (lower boundary)", () => {
    expect(validateLimit(1)).toBe(1);
  });

  it("accepts exactly 100 (upper boundary)", () => {
    expect(validateLimit(100)).toBe(100);
  });
});

// ─── GET /transactions/:id ────────────────────────────────────────────────────

describe("GET /transactions/:id — limit validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
    stubTransactions([]);
  });

  const url = (limit) => `/transactions/${VALID_ACCOUNT}?limit=${limit}`;

  it("returns 200 with valid limit", async () => {
    const res = await request(app).get(url(10));
    expect(res.statusCode).toBe(200);
  });

  it("returns InvalidLimit 400 for a string limit", async () => {
    const res = await request(app).get(url("abc"));
    assertInvalidLimit(res);
  });

  it("returns InvalidLimit 400 for a negative limit", async () => {
    const res = await request(app).get(url(-1));
    assertInvalidLimit(res);
  });

  it("returns InvalidLimit 400 for limit=0", async () => {
    const res = await request(app).get(url(0));
    assertInvalidLimit(res);
  });

  it("returns InvalidLimit 400 for limit=101 (over-max)", async () => {
    const res = await request(app).get(url(101));
    assertInvalidLimit(res);
  });

  it("does not call Horizon when limit is invalid", async () => {
    await request(app).get(url("bad"));
    expect(server.transactions).not.toHaveBeenCalled();
  });
});

// ─── GET /account/:id/effects ─────────────────────────────────────────────────

describe("GET /account/:id/effects — limit validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
    stubEffects([]);
  });

  const url = (limit) => `/account/${VALID_ACCOUNT}/effects?limit=${limit}`;

  it("returns 200 with valid limit", async () => {
    const res = await request(app).get(url(10));
    expect(res.statusCode).toBe(200);
  });

  it("returns InvalidLimit 400 for a string limit", async () => {
    const res = await request(app).get(url("xyz"));
    assertInvalidLimit(res);
  });

  it("returns InvalidLimit 400 for a negative limit", async () => {
    const res = await request(app).get(url(-5));
    assertInvalidLimit(res);
  });

  it("returns InvalidLimit 400 for limit=0", async () => {
    const res = await request(app).get(url(0));
    assertInvalidLimit(res);
  });

  it("returns InvalidLimit 400 for limit=101 (over-max)", async () => {
    const res = await request(app).get(url(101));
    assertInvalidLimit(res);
  });

  it("does not call Horizon when limit is invalid", async () => {
    await request(app).get(url("bad"));
    expect(server.effects).not.toHaveBeenCalled();
  });
});

// ─── GET /account/:id/trades ──────────────────────────────────────────────────

describe("GET /account/:id/trades — limit validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
    stubTrades([]);
  });

  const url = (limit) => `/account/${VALID_ACCOUNT}/trades?limit=${limit}`;

  it("returns 200 with valid limit", async () => {
    const res = await request(app).get(url(20));
    expect(res.statusCode).toBe(200);
  });

  it("returns InvalidLimit 400 for a string limit", async () => {
    const res = await request(app).get(url("notanumber"));
    assertInvalidLimit(res);
  });

  it("returns InvalidLimit 400 for a negative limit", async () => {
    const res = await request(app).get(url(-10));
    assertInvalidLimit(res);
  });

  it("returns InvalidLimit 400 for limit=0", async () => {
    const res = await request(app).get(url(0));
    assertInvalidLimit(res);
  });

  it("returns InvalidLimit 400 for limit=101 (over-max)", async () => {
    const res = await request(app).get(url(101));
    assertInvalidLimit(res);
  });

  it("does not call Horizon when limit is invalid", async () => {
    await request(app).get(url("bad"));
    expect(server.trades).not.toHaveBeenCalled();
  });
});

// ─── GET /account/:id/offers ──────────────────────────────────────────────────

describe("GET /account/:id/offers — limit validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
    stubOffers([]);
  });

  const url = (limit) => `/account/${VALID_ACCOUNT}/offers?limit=${limit}`;

  it("returns 200 with valid limit", async () => {
    const res = await request(app).get(url(10));
    expect(res.statusCode).toBe(200);
  });

  it("returns InvalidLimit 400 for a string limit", async () => {
    const res = await request(app).get(url("two"));
    assertInvalidLimit(res);
  });

  it("returns InvalidLimit 400 for a negative limit", async () => {
    const res = await request(app).get(url(-1));
    assertInvalidLimit(res);
  });

  it("returns InvalidLimit 400 for limit=0", async () => {
    const res = await request(app).get(url(0));
    assertInvalidLimit(res);
  });

  it("returns InvalidLimit 400 for limit=101 (over-max)", async () => {
    const res = await request(app).get(url(101));
    assertInvalidLimit(res);
  });

  it("does not call Horizon when limit is invalid", async () => {
    await request(app).get(url("bad"));
    expect(server.offers).not.toHaveBeenCalled();
  });
});

// ─── GET /account/:id/transaction-stats ──────────────────────────────────────

describe("GET /account/:id/transaction-stats — limit validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
    stubTransactions([]);
  });

  const url = (limit) =>
    `/account/${VALID_ACCOUNT}/transaction-stats?limit=${limit}`;

  it("returns 200 with valid limit", async () => {
    const res = await request(app).get(url(10));
    expect(res.statusCode).toBe(200);
  });

  it("returns InvalidLimit 400 for a string limit", async () => {
    const res = await request(app).get(url("bad"));
    assertInvalidLimit(res);
  });

  it("returns InvalidLimit 400 for a negative limit", async () => {
    const res = await request(app).get(url(-1));
    assertInvalidLimit(res);
  });

  it("returns InvalidLimit 400 for limit=0", async () => {
    const res = await request(app).get(url(0));
    assertInvalidLimit(res);
  });

  it("returns InvalidLimit 400 for limit=101 (over-max)", async () => {
    const res = await request(app).get(url(101));
    assertInvalidLimit(res);
  });
});

// ─── Cross-cutting: response shape is always consistent ──────────────────────

describe("InvalidLimit response shape — cross-endpoint consistency", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
    stubTransactions([]);
    stubEffects([]);
    stubTrades([]);
  });

  const endpoints = [
    `/transactions/${VALID_ACCOUNT}?limit=abc`,
    `/account/${VALID_ACCOUNT}/effects?limit=abc`,
    `/account/${VALID_ACCOUNT}/trades?limit=abc`,
    `/account/${VALID_ACCOUNT}/offers?limit=abc`,
  ];

  it.each(endpoints)(
    "GET %s — error body has exactly type, message, suggestion",
    async (path) => {
      stubOffers([]);
      const res = await request(app).get(path);
      expect(res.statusCode).toBe(400);
      expect(res.body).toMatchObject({
        success: false,
        error: INVALID_LIMIT_ERROR,
      });
    },
  );
});

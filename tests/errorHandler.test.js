const errorHandler = require("../src/middleware/errorHandler");

describe("ErrorHandler Middleware", () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      method: "GET",
      path: "/test",
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  describe("Horizon Errors", () => {
    it("should map transaction result code tx_bad_seq to 409 status code", () => {
      const err = {
        response: {
          status: 400,
          data: {
            title: "Transaction Failed",
            detail: "The transaction failed due to bad sequence.",
            extras: {
              result_codes: {
                transaction: "tx_bad_seq",
              },
            },
          },
        },
      };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "HorizonError",
          title: "Transaction Failed",
          detail: "The transaction failed due to bad sequence.",
          status: 400,
          extras: err.response.data.extras,
          code: "tx_bad_seq",
          message: "Transaction sequence number does not match the account's current sequence. Reload the account and rebuild the transaction.",
        },
      });
    });

    it("should map operation result code op_no_destination to 404 status code", () => {
      const err = {
        response: {
          status: 400,
          data: {
            title: "Transaction Failed",
            detail: "The destination account was not found.",
            extras: {
              result_codes: {
                operations: ["op_no_destination"],
              },
            },
          },
        },
      };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "HorizonError",
          title: "Transaction Failed",
          detail: "The destination account was not found.",
          status: 400,
          extras: err.response.data.extras,
          code: "op_no_destination",
          message: "The destination account does not exist. Create the account first with a createAccount operation.",
        },
      });
    });

    it("should fallback to err.response.status for unknown Horizon error codes", () => {
      const err = {
        response: {
          status: 418,
          data: {
            title: "Teapot",
            detail: "An unknown result code was returned.",
            extras: {
              result_codes: {
                transaction: "tx_unknown_code_example",
              },
            },
          },
        },
      };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(418);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "HorizonError",
          title: "Teapot",
          detail: "An unknown result code was returned.",
          status: 418,
          extras: err.response.data.extras,
          code: "tx_unknown_code_example",
        },
      });
    });

    it("should fallback to err.response.status when no result codes are present", () => {
      const err = {
        response: {
          status: 402,
          data: {
            title: "Payment Required",
            detail: "Horizon responded with payment required.",
          },
        },
      };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "HorizonError",
          title: "Payment Required",
          detail: "Horizon responded with payment required.",
          status: 402,
          extras: null,
        },
      });
    });
  });

  describe("Validation Errors", () => {
    it("should handle custom validation errors with a 400 status code", () => {
      const err = {
        isValidation: true,
        message: "Invalid Account ID format",
        field: "accountId",
        receivedValue: "G12345",
        expectedFormat: "G... public key",
      };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "ValidationError",
          message: "Invalid Account ID format",
          field: "accountId",
          receivedValue: "G12345",
          expectedFormat: "G... public key",
        },
      });
    });
  });

  describe("InsufficientXLMReserve Errors", () => {
    it("should handle custom insufficient XLM reserve errors with a 422 status code", () => {
      const err = {
        isInsufficientXLMReserve: true,
        message: "Account GABCDEF has insufficient XLM reserve on the Stellar testnet network. Available: 1.5 XLM, Required: 2.5 XLM, Shortfall: 1.0000000 XLM.",
        accountId: "GABCDEF",
        availableBalance: 1.5,
        requiredReserve: 2.5,
        shortfall: 1.0,
        suggestion: "Add more XLM to the account or remove unused subentries (e.g., trustlines, offers, data entries) to free up reserve.",
      };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "InsufficientXLMReserve",
          message: err.message,
          accountId: "GABCDEF",
          availableBalance: 1.5,
          requiredReserve: 2.5,
          shortfall: 1.0,
          suggestion: "Add more XLM to the account or remove unused subentries (e.g., trustlines, offers, data entries) to free up reserve.",
        },
      });
    });

    it("should handle insufficient reserve error with zero available balance", () => {
      const err = {
        isInsufficientXLMReserve: true,
        message: "Account GXYZ has insufficient XLM reserve on the Stellar mainnet network. Available: 0 XLM, Required: 1 XLM, Shortfall: 1.0000000 XLM.",
        accountId: "GXYZ",
        availableBalance: 0,
        requiredReserve: 1,
        shortfall: 1,
      };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "InsufficientXLMReserve",
          message: err.message,
          accountId: "GXYZ",
          availableBalance: 0,
          requiredReserve: 1,
          shortfall: 1,
          suggestion: "Add more XLM to the account or remove unused subentries (e.g., trustlines, offers, data entries) to free up reserve.",
        },
      });
    });
  });

  describe("Generic Errors", () => {
    it("should handle generic ServerError with a 500 status code", () => {
      const err = new Error("Database connection failed");

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "ServerError",
          message: "Database connection failed",
        },
      });
    });
  });
});

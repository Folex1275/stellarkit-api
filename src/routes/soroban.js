const express = require("express");
const router = express.Router();

const { Contract, scValToNative } = require("@stellar/stellar-sdk");
const { sorobanServer, NETWORK } = require("../config/stellar");
const { validateContractId, validateLimit } = require("../utils/validators");
const { success } = require("../utils/response");
const StellarKitError = require("../utils/StellarKitError");
const cacheService = require("../services/cache");

const EXECUTABLE_TYPES = {
  contractExecutableWasm: "wasm",
  contractExecutableStellarAsset: "stellar_asset",
};

/**
 * Recursively converts scValToNative() output into JSON-safe values:
 * BigInt (from u64/i128/u256 etc.) -> string, Buffer (from bytes) -> hex string.
 */
function toJsonSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value)) return value.toString("hex");
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJsonSafe(v)]));
  }
  return value;
}

/**
 * Decodes an ScVal to a clean native value where possible, falling back to
 * the raw base64 XDR (tagged as such) if decoding fails.
 */
function decodeScVal(scVal) {
  try {
    return { value: toJsonSafe(scValToNative(scVal)), type: "decoded" };
  } catch {
    return { value: scVal.toXDR("base64"), type: "raw" };
  }
}

function requireSorobanServer() {
  if (!sorobanServer) {
    throw new StellarKitError(
      "Soroban RPC is not configured for this network.",
      500,
      "ConfigError",
      null,
      "Set SOROBAN_RPC_URL to a reachable Soroban RPC endpoint."
    );
  }
  return sorobanServer;
}

async function loadContractInstanceEntry(contractId) {
  const rpcServer = requireSorobanServer();
  const footprint = new Contract(contractId).getFootprint();
  const response = await rpcServer.getLedgerEntries(footprint);

  if (!response.entries || response.entries.length === 0) {
    throw new StellarKitError(
      `Contract ${contractId} was not found on the Stellar ${NETWORK} network.`,
      404,
      "ContractNotFound",
      null,
      "Verify the contract ID is correct and that the contract has been deployed."
    );
  }

  return response.entries[0];
}

/**
 * GET /soroban/contract/:id
 * Returns contract instance details: executable type/wasm hash and ledger metadata.
 */
router.get("/contract/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateContractId(id);

    const entry = await loadContractInstanceEntry(id);
    const instance = entry.val.contractData().val().instance();
    const executable = instance.executable();
    const executableTypeName = executable.switch().name;
    const executableType = EXECUTABLE_TYPES[executableTypeName] || executableTypeName;

    return success(res, {
      contractId: id,
      executable: {
        type: executableType,
        wasmHash: executableType === "wasm" ? executable.wasmHash().toString("hex") : null,
      },
      lastModifiedLedger: entry.lastModifiedLedgerSeq,
      expiryLedger: entry.liveUntilLedgerSeq ?? null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /soroban/contract/:id/storage
 * Returns the contract's instance-storage entries (key/value map embedded in
 * the ContractInstance ledger entry) — the one form of contract storage that
 * is enumerable without a full ledger indexer. See docs/soroban.md.
 */
router.get("/contract/:id/storage", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateContractId(id);
    const limit = validateLimit(req.query.limit || 50, 200);
    const fresh = req.query.fresh === "true";

    const CACHE_TTL = parseInt(process.env.CACHE_TTL_CONTRACT_STORAGE_MS, 10) / 1000 || 15;
    const cacheKey = `contract-storage:${id}:${limit}`;

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    const entry = await loadContractInstanceEntry(id);
    const instance = entry.val.contractData().val().instance();
    const storageMap = instance.storage() || [];

    const entries = storageMap.slice(0, limit).map((mapEntry) => {
      const key = decodeScVal(mapEntry.key());
      const value = decodeScVal(mapEntry.val());
      return {
        key: key.value,
        value: value.value,
        type: value.type,
      };
    });

    const data = {
      contractId: id,
      entries,
      lastModifiedLedger: entry.lastModifiedLedgerSeq,
      expiryLedger: entry.liveUntilLedgerSeq ?? null,
    };

    cacheService.set(cacheKey, data, CACHE_TTL);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

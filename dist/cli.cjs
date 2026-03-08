#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/cli.ts
var import_path2 = __toESM(require("path"), 1);

// src/middleware.ts
var import_crypto = __toESM(require("crypto"), 1);
var import_module = require("module");
var import_path = __toESM(require("path"), 1);
function createSmartRequire() {
  const strategies = [];
  try {
    strategies.push((0, import_module.createRequire)(import_path.default.join(process.cwd(), "noop.js")));
  } catch {
  }
  const entryScript = require.main?.filename ?? process.argv[1];
  if (entryScript) {
    try {
      const baseDir = import_path.default.dirname(entryScript);
      if (baseDir !== process.cwd()) {
        strategies.push((0, import_module.createRequire)(import_path.default.join(baseDir, "noop.js")));
      }
    } catch {
    }
  }
  return (id) => {
    let lastErr;
    for (const req of strategies) {
      try {
        return req(id);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr ?? new Error(`Cannot find module '${id}'`);
  };
}
var smartRequire = createSmartRequire();
var challenges = /* @__PURE__ */ new Map();
var results = /* @__PURE__ */ new Map();
var verusId = null;
var primitives = null;
var bs58check = null;
var initialized = false;
function initVerus(config) {
  if (initialized) return !!verusId;
  try {
    const client = smartRequire("verusid-ts-client");
    primitives = client.primitives;
    bs58check = smartRequire("verusid-ts-client/node_modules/bs58check");
    const chain = config.chain ?? "VRSC";
    const api = config.apiUrl ?? "https://api.verus.services";
    const chainIAddress = config.chainIAddress ?? "i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV";
    verusId = new client.VerusIdInterface(chain, api, chainIAddress);
    initialized = true;
    return true;
  } catch (err) {
    console.error("[verus-connect] Failed to load verusid-ts-client:", err.message);
    console.error("[verus-connect] Install it: npm install verusid-ts-client");
    initialized = true;
    return false;
  }
}
function randomIAddress() {
  if (!bs58check) return import_crypto.default.randomBytes(16).toString("hex");
  const buf = Buffer.alloc(21);
  buf[0] = 102;
  import_crypto.default.randomBytes(20).copy(buf, 1);
  return bs58check.encode(buf);
}
function cleanup(ttl) {
  const cutoff = Date.now() - ttl;
  for (const [id, data] of challenges) {
    if (data.created < cutoff) {
      challenges.delete(id);
      results.delete(id);
    }
  }
}
function verusAuth(config) {
  if (!config.iAddress) throw new Error("verus-connect: iAddress is required");
  if (!config.privateKey) throw new Error("verus-connect: privateKey is required");
  if (!config.callbackUrl) throw new Error("verus-connect: callbackUrl is required");
  const ttl = config.challengeTtl ?? 5 * 60 * 1e3;
  const verusReady = initVerus(config);
  const cleanupTimer = setInterval(() => cleanup(ttl), 6e4);
  if (cleanupTimer.unref) cleanupTimer.unref();
  let Router;
  try {
    Router = smartRequire("express").Router;
  } catch {
    throw new Error("verus-connect: express is required for server middleware");
  }
  const router = Router();
  const jsonParser = smartRequire("express").json({ limit: "1mb" });
  const loginAttempts = /* @__PURE__ */ new Map();
  const MAX_CHALLENGES_PER_MIN = 10;
  function isRateLimited(ip) {
    const now = Date.now();
    const attempts = loginAttempts.get(ip) || [];
    const recent = attempts.filter((t) => now - t < 6e4);
    loginAttempts.set(ip, recent);
    return recent.length >= MAX_CHALLENGES_PER_MIN;
  }
  function recordAttempt(ip) {
    const attempts = loginAttempts.get(ip) || [];
    attempts.push(Date.now());
    loginAttempts.set(ip, attempts);
  }
  const rateLimitCleanup = setInterval(() => {
    const cutoff = Date.now() - 6e4;
    for (const [ip, attempts] of loginAttempts) {
      const recent = attempts.filter((t) => t > cutoff);
      if (recent.length === 0) loginAttempts.delete(ip);
      else loginAttempts.set(ip, recent);
    }
  }, 3e5);
  if (rateLimitCleanup.unref) rateLimitCleanup.unref();
  router.post("/login", async (_req, res) => {
    const clientIp = _req.ip || _req.connection?.remoteAddress || "unknown";
    if (isRateLimited(clientIp)) {
      return res.status(429).json({ error: "Too many login attempts. Try again in a minute." });
    }
    recordAttempt(clientIp);
    if (!verusId || !primitives) {
      return res.status(500).json({ error: "Verus libraries not loaded. Install verusid-ts-client." });
    }
    try {
      const challengeId = randomIAddress();
      const webhookKey = primitives.LOGIN_CONSENT_WEBHOOK_VDXF_KEY.vdxfid;
      const challenge = new primitives.LoginConsentChallenge({
        challenge_id: challengeId,
        requested_access: [
          new primitives.RequestedPermission(primitives.IDENTITY_VIEW.vdxfid)
        ],
        redirect_uris: [
          new primitives.RedirectUri(config.callbackUrl, webhookKey)
        ],
        subject: [],
        provisioning_info: [],
        created_at: Number((Date.now() / 1e3).toFixed(0)),
        salt: randomIAddress()
      });
      const chainIAddress = config.chainIAddress ?? "i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV";
      const request = await verusId.createLoginConsentRequest(
        config.iAddress,
        challenge,
        config.privateKey,
        null,
        null,
        chainIAddress
      );
      const deepLink = request.toWalletDeeplinkUri();
      const scheme = (deepLink || "").split("//")[0].toLowerCase();
      const safeSchemes = ["verus:", "vrsc:", "i5jtwbp6zymeay9llnraglgjqgdrffsau4:"];
      if (!safeSchemes.some((s) => scheme === s)) {
        console.error(`[verus-connect] Generated unsafe deep link scheme: ${scheme}`);
        return res.status(500).json({ error: "Generated deep link failed safety check" });
      }
      challenges.set(challengeId, { created: Date.now(), deepLink });
      return res.json({ challengeId, uri: deepLink, deepLink });
    } catch (err) {
      console.error("[verus-connect] Challenge creation failed:", err.message);
      return res.status(500).json({ error: "Failed to create login challenge" });
    }
  });
  router.post("/verusidlogin", jsonParser, async (req, res) => {
    try {
      if (!verusId || !primitives) {
        return res.status(500).json({ error: "Verus libraries not loaded" });
      }
      const response = new primitives.LoginConsentResponse(req.body);
      let verified = false;
      try {
        verified = await verusId.verifyLoginConsentResponse(response);
      } catch (verifyErr) {
        console.error("[verus-connect] Verification error:", verifyErr.message);
        return res.status(503).json({ error: "Signature verification unavailable. The Verus RPC may be down." });
      }
      if (!verified) {
        return res.status(401).json({ error: "Signature verification failed" });
      }
      const cId = response.decision?.request?.challenge?.challenge_id;
      if (!cId || !challenges.has(cId)) {
        return res.status(404).json({ error: "Challenge not found or expired" });
      }
      let friendlyName = response.signing_id;
      try {
        const idResult = await verusId.interface.getIdentity(response.signing_id);
        const idRes = idResult?.result;
        if (idRes?.friendlyname) {
          friendlyName = idRes.friendlyname;
        } else if (idRes?.fullyqualifiedname) {
          friendlyName = idRes.fullyqualifiedname;
        } else if (idRes?.identity?.name) {
          friendlyName = idRes.identity.name + "@";
        }
      } catch {
      }
      const loginResult = {
        iAddress: response.signing_id,
        friendlyName,
        challengeId: cId
      };
      let extra;
      if (config.onLogin) {
        try {
          const hookResult = await config.onLogin(loginResult);
          if (hookResult) extra = hookResult;
        } catch (hookErr) {
          console.error("[verus-connect] onLogin hook error:", hookErr.message);
        }
      }
      results.set(cId, { iAddress: response.signing_id, friendlyName, extra, consumed: false });
      return res.json({ status: "ok" });
    } catch (err) {
      console.error("[verus-connect] Webhook error:", err.message);
      return res.status(500).json({ error: "Verification error" });
    }
  });
  router.get("/result/:challengeId", (req, res) => {
    const { challengeId } = req.params;
    if (!challenges.has(challengeId)) {
      return res.status(404).json({ status: "error", error: "Challenge not found or expired" });
    }
    const result = results.get(challengeId);
    if (!result) {
      return res.json({ status: "pending" });
    }
    if (result.consumed) {
      challenges.delete(challengeId);
      results.delete(challengeId);
      return res.status(404).json({ status: "error", error: "Challenge already consumed" });
    }
    result.consumed = true;
    setTimeout(() => {
      challenges.delete(challengeId);
      results.delete(challengeId);
    }, 1e4);
    return res.json({
      status: "verified",
      iAddress: result.iAddress,
      friendlyName: result.friendlyName,
      data: result.extra
    });
  });
  router.post("/pay-deeplink", jsonParser, (req, res) => {
    const { address, amount, currency_id } = req.body;
    if (!address || amount === void 0 || amount === null) {
      return res.status(400).json({ error: "address and amount are required" });
    }
    if (typeof amount !== "number" || !isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }
    if (amount > 1e12) {
      return res.status(400).json({ error: "amount exceeds maximum" });
    }
    if (typeof address !== "string" || address.length < 20 || address.length > 100) {
      return res.status(400).json({ error: "invalid address format" });
    }
    if (!primitives || !bs58check) {
      return res.status(503).json({ error: "Verus libraries not loaded" });
    }
    try {
      const decoded = bs58check.decode(address);
      const pubKeyHash = decoded.slice(1);
      const sats = Math.round(amount * 1e8);
      const BN = smartRequire("verusid-ts-client/node_modules/bn.js");
      const chainId = currency_id || config.chainIAddress || "i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV";
      const VERSION_3 = new BN(3);
      const details = new primitives.VerusPayInvoiceDetails({
        amount: new BN(sats),
        destination: new primitives.TransferDestination({
          type: primitives.DEST_PKH,
          destination_bytes: pubKeyHash
        }),
        requestedcurrencyid: chainId
      }, VERSION_3);
      const invoice = new primitives.VerusPayInvoice({ details, version: VERSION_3 });
      const deepLink = invoice.toWalletDeeplinkUri();
      return res.json({ deep_link: deepLink });
    } catch (err) {
      console.error("[verus-connect] pay-deeplink error:", err.message);
      return res.status(500).json({ error: "Failed to generate payment deep link" });
    }
  });
  router.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      verusLoaded: !!verusId,
      activeChallenges: challenges.size
    });
  });
  return router;
}

// src/cli.ts
var args = process.argv.slice(2);
var command = args[0];
function getFlag(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return void 0;
}
function printUsage() {
  console.log(`
verus-connect \u2014 VerusID login server

Usage:
  verus-connect start [options]

Options:
  --port <number>     Override PORT (default: 8100)
  --host <address>    Override HOST (default: 127.0.0.1)
  --env <path>        Path to .env file (default: ./.env)
  --cors <origins>    Comma-separated CORS origins (default: *)

Environment variables (.env):
  SIGNING_IADDRESS    Your app's VerusID i-address (required)
  PRIVATE_KEY         WIF private key (required)
  CALLBACK_URL        Public callback URL (required)
  PORT                Server port (default: 8100)
  HOST                Bind address (default: 127.0.0.1)
  CHAIN               Chain name (default: VRSC)
  API_URL             Verus RPC endpoint
  CHAIN_IADDRESS      Chain i-address
  CORS_ORIGINS        Comma-separated allowed origins

Example:
  # Create .env with your credentials, then:
  verus-connect start

  # Or inline:
  SIGNING_IADDRESS=iYour... PRIVATE_KEY=UxYour... CALLBACK_URL=https://mysite.com/verusidlogin verus-connect start
`);
}
if (!command || command === "help" || command === "--help" || command === "-h") {
  printUsage();
  process.exit(0);
}
if (command !== "start") {
  console.error(`Unknown command: ${command}
`);
  printUsage();
  process.exit(1);
}
var envPath = getFlag("env") || import_path2.default.join(process.cwd(), ".env");
try {
  const dotenv = require("dotenv");
  dotenv.config({ path: envPath });
} catch {
}
var PORT = parseInt(getFlag("port") || process.env.PORT || "8100", 10);
var HOST = getFlag("host") || process.env.HOST || "127.0.0.1";
var SIGNING_IADDRESS = process.env.SIGNING_IADDRESS || "";
var PRIVATE_KEY = process.env.PRIVATE_KEY || "";
var CALLBACK_URL = process.env.CALLBACK_URL || (process.env.SERVER_URL ? `${process.env.SERVER_URL}/verusidlogin` : "");
var CHAIN = process.env.CHAIN || "VRSC";
var API_URL = process.env.API_URL || process.env.API || "https://api.verus.services";
var CHAIN_IADDRESS = process.env.CHAIN_IADDRESS || "i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV";
var CORS_ORIGINS = getFlag("cors") || process.env.CORS_ORIGINS || "*";
var missing = [];
if (!SIGNING_IADDRESS) missing.push("SIGNING_IADDRESS");
if (!PRIVATE_KEY) missing.push("PRIVATE_KEY");
if (!CALLBACK_URL) missing.push("CALLBACK_URL");
if (missing.length > 0) {
  console.error(`
Missing required config: ${missing.join(", ")}`);
  console.error(`Set them in ${envPath} or as environment variables.
`);
  console.error("Example .env:");
  console.error("  SIGNING_IADDRESS=iYourVerusID...");
  console.error("  PRIVATE_KEY=UxYourWIFKey...");
  console.error("  CALLBACK_URL=https://yoursite.com/verusidlogin\n");
  process.exit(1);
}
var express = require("express");
var cors = require("cors");
var app = express();
if (CORS_ORIGINS === "*") {
  app.use(cors());
} else {
  app.use(cors({ origin: CORS_ORIGINS.split(",").map((s) => s.trim()) }));
}
app.use(express.json({ limit: "1mb" }));
app.use("/", verusAuth({
  iAddress: SIGNING_IADDRESS,
  privateKey: PRIVATE_KEY,
  callbackUrl: CALLBACK_URL,
  chain: CHAIN,
  apiUrl: API_URL,
  chainIAddress: CHAIN_IADDRESS
}));
var server = app.listen(PORT, HOST, () => {
  console.log(`
  verus-connect server running on http://${HOST}:${PORT}
`);
  console.log(`  Chain:     ${CHAIN} (${CHAIN_IADDRESS})`);
  console.log(`  API:       ${API_URL}`);
  console.log(`  Signing:   ${SIGNING_IADDRESS}`);
  console.log(`  Callback:  ${CALLBACK_URL}`);
  console.log(`  CORS:      ${CORS_ORIGINS}`);
  console.log();
  console.log("  Endpoints:");
  console.log("    POST /login              Create login challenge");
  console.log("    POST /verusidlogin       Wallet callback (auto)");
  console.log("    GET  /result/:id         Poll challenge status");
  console.log("    POST /pay-deeplink       Generate payment deep link");
  console.log("    GET  /health             Health check");
  console.log();
});
function shutdown() {
  console.log("\nShutting down...");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5e3);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
//# sourceMappingURL=cli.cjs.map
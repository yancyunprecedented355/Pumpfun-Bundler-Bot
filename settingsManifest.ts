import fs from "fs";
import path from "path";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import type { UserToken } from "./src/types";

/** Root `id.json`: paths + runtime settings (not a Solana keypair array). */
export interface SettingsManifest {
  paths: {
    /** File path (bs58 text or JSON keypair), or raw base58 secret inline. */
    mintKeypairBs58: string;
    /** File path (JSON keypair or bs58 text file), or raw base58 secret inline. */
    lpWalletPrivateKeyBs58: string;
    /** File path (JSON keypair or bs58 text file), or raw base58 secret inline. */
    bundlerProviderPrivateKeyBs58: string;
  };
  /** Mint secret as base58 (64-byte keypair or 32-byte seed). */
  mintPrivateKeyBs58: string;
  token: Partial<UserToken>;
  /** LP wallet secret as base58 (optional; overrides `paths.lpWalletPrivateKeyBs58` when set). */
  lpWalletPrivateKeyBs58: string;
  /** Bundler provider secret as base58 (optional; overrides `paths.bundlerProviderPrivateKeyBs58` when set). */
  bundlerProviderPrivateKeyBs58: string;
  batchSize: number;
  bundleWalletNum?: number;
  bundlerHoldingPercent: number;
  walletCreateInterval: number;
  walletTransferInterval: number;
  holderTokenTransferInterval: number;
  holderTokenAmountMax: number;
  holderTokenAmountMin: number;
  distNum: number;
  remaining_token_percent: number;
  bundlerWalletName: string;
  holderWalletName: string;
  extra_sol_amount: number;
  PRIORITY_FEE: number;
  holderCreateInterval: number;
}

/** Legacy `id.json` keys still accepted in `mergeManifest`. */
export type LegacySettingsManifestFields = {
  paths?: Partial<SettingsManifest["paths"]> & {
    lpWalletKeypairJson?: string;
    bundlerProviderKeypairJson?: string;
  };
  configuredMintPk?: string;
  mint_private_key?: string;
  LP_wallet_private_key?: string;
  Bundler_provider_private_key?: string;
};

const MANIFEST_FILE = path.join(process.cwd(), "id.json");

export const DEFAULT_TOKEN_BASE: Omit<UserToken, "mintPk"> = {
  name: "",
  symbol: "",
  description: "",
  showName: "",
  createOn: "Pump.fun",
  twitter: "https://x.com",
  telegram: "https://t.me",
  website: "https://",
  image: "./src/image/2.jpg",
};

export function keypairFromBs58String(secret: string): Keypair | null {
  const t = secret.trim();
  if (!t) return null;
  try {
    const bytes = new Uint8Array(bs58.decode(t));
    if (bytes.byteLength === 64) return Keypair.fromSecretKey(bytes);
    if (bytes.byteLength === 32) return Keypair.fromSeed(bytes);
  } catch {
    return null;
  }
  return null;
}

function keypairFromJsonKeypairFile(filePath: string): Keypair | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
  if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((n) => typeof n === "number")) {
    return Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { secretKey?: unknown }).secretKey) &&
    (parsed as { secretKey: unknown[] }).secretKey.every((n) => typeof n === "number")
  ) {
    return Keypair.fromSecretKey(Uint8Array.from((parsed as { secretKey: number[] }).secretKey));
  }
  return null;
}

/** Existing file → JSON keypair, else file contents as bs58, else treat `pathOrBs58` as raw bs58. */
export function resolvePathOrBs58ToKeypair(pathOrBs58: string): Keypair | null {
  const t = pathOrBs58.trim();
  if (!t) return null;
  const abs = resolveManifestPath(t);
  if (fs.existsSync(abs)) {
    const fromJson = keypairFromJsonKeypairFile(abs);
    if (fromJson) return fromJson;
    try {
      return keypairFromBs58String(fs.readFileSync(abs, "utf8"));
    } catch {
      return null;
    }
  }
  return keypairFromBs58String(t);
}

export function keypairOrPlaceholder(label: string, inlineBs58: string, pathOrBs58: string): Keypair {
  const direct = keypairFromBs58String(inlineBs58);
  if (direct) return direct;
  const resolved = resolvePathOrBs58ToKeypair(pathOrBs58);
  if (resolved) return resolved;
  console.warn(
    `[settings] ${label}: set base58 in id.json, or a valid paths.* file / raw bs58 — using a random placeholder keypair.`
  );
  return Keypair.generate();
}

/** Resolves `token.mintPk` (bs58 secret used across this repo). */
export function resolveMintPkBs58(manifest: SettingsManifest): string {
  const fromExplicit =
    manifest.mintPrivateKeyBs58.trim() ||
    manifest.token.mintPk?.trim() ||
    "";
  if (fromExplicit) return fromExplicit;
  const ref = manifest.paths.mintKeypairBs58.trim();
  if (!ref) return "";
  const abs = resolveManifestPath(ref);
  if (fs.existsSync(abs)) {
    try {
      return fs.readFileSync(abs, "utf8").trim();
    } catch {
      return "";
    }
  }
  return keypairFromBs58String(ref) ? ref : "";
}

export function defaultManifest(): SettingsManifest {
  return {
    paths: {
      mintKeypairBs58: "wallets/mintKeypair.bs58",
      lpWalletPrivateKeyBs58: "wallets/id.json",
      bundlerProviderPrivateKeyBs58: "wallets/bundler-id.json",
    },
    mintPrivateKeyBs58: "",
    token: {},
    lpWalletPrivateKeyBs58: "",
    bundlerProviderPrivateKeyBs58: "",
    batchSize: 4,
    bundlerHoldingPercent: 0.1,
    walletCreateInterval: 3,
    walletTransferInterval: 4,
    holderTokenTransferInterval: 5,
    holderTokenAmountMax: 1.1,
    holderTokenAmountMin: 0.4,
    distNum: 1,
    remaining_token_percent: 19,
    bundlerWalletName: "bundlers",
    holderWalletName: "holders",
    extra_sol_amount: 0.002,
    PRIORITY_FEE: 0.00002,
    holderCreateInterval: 2,
  };
}

function mergeManifest(over: Partial<SettingsManifest> & LegacySettingsManifestFields): SettingsManifest {
  const d = defaultManifest();
  const pIn = (over.paths ?? {}) as Partial<SettingsManifest["paths"]> & {
    lpWalletKeypairJson?: string;
    bundlerProviderKeypairJson?: string;
  };
  const paths: SettingsManifest["paths"] = {
    mintKeypairBs58: pIn.mintKeypairBs58 ?? d.paths.mintKeypairBs58,
    lpWalletPrivateKeyBs58:
      pIn.lpWalletPrivateKeyBs58 ?? pIn.lpWalletKeypairJson ?? d.paths.lpWalletPrivateKeyBs58,
    bundlerProviderPrivateKeyBs58:
      pIn.bundlerProviderPrivateKeyBs58 ??
      pIn.bundlerProviderKeypairJson ??
      d.paths.bundlerProviderPrivateKeyBs58,
  };
  const base: SettingsManifest = {
    ...d,
    paths,
    token: { ...d.token, ...(over.token ?? {}) },
    mintPrivateKeyBs58:
      over.mintPrivateKeyBs58 ??
      over.mint_private_key ??
      over.configuredMintPk ??
      d.mintPrivateKeyBs58,
    lpWalletPrivateKeyBs58:
      over.lpWalletPrivateKeyBs58 ?? over.LP_wallet_private_key ?? d.lpWalletPrivateKeyBs58,
    bundlerProviderPrivateKeyBs58:
      over.bundlerProviderPrivateKeyBs58 ??
      over.Bundler_provider_private_key ??
      d.bundlerProviderPrivateKeyBs58,
  };
  const skip = new Set([
    "paths",
    "token",
    "mintPrivateKeyBs58",
    "lpWalletPrivateKeyBs58",
    "bundlerProviderPrivateKeyBs58",
    "mint_private_key",
    "configuredMintPk",
    "LP_wallet_private_key",
    "Bundler_provider_private_key",
  ]);
  for (const [k, v] of Object.entries(over)) {
    if (skip.has(k) || v === undefined) continue;
    (base as unknown as Record<string, unknown>)[k] = v;
  }
  return base;
}

export function loadSettingsManifest(): SettingsManifest {
  if (!fs.existsSync(MANIFEST_FILE)) return defaultManifest();
  try {
    const parsed = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.warn(
        "[settings] id.json must be a JSON object (settings manifest). Use base58 fields or paths.* (file path or inline bs58)."
      );
      return defaultManifest();
    }
    return mergeManifest(parsed as Partial<SettingsManifest> & LegacySettingsManifestFields);
  } catch {
    console.warn("[settings] failed to parse id.json, using defaults");
    return defaultManifest();
  }
}

export function resolveManifestPath(relOrAbs: string): string {
  const p = relOrAbs.trim();
  if (!p) return path.join(process.cwd(), "wallets", "invalid-empty-path");
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

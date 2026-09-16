#!/usr/bin/env node
// Encrypt the friend discount rule so it is not readable in the published site.
//
//   node scripts/encrypt-discounts.mjs "the friend code"
//
// Reads   ./discounts.plain.json   { "type": "percentage", "percentOff": 50 } (gitignored)
// Writes  ./data/discounts.enc.json { v, salt, iv, data }                (safe to commit)
//
// The browser (assets/app.js) reverses this with the same code via crypto.subtle.

import { readFile, writeFile } from "node:fs/promises";
import { webcrypto as crypto } from "node:crypto";

const PBKDF2_ITERATIONS = 150_000;
const b64 = (buf) => Buffer.from(buf).toString("base64");

const code = process.argv[2];
if (!code) {
  console.error('Usage: node scripts/encrypt-discounts.mjs "the friend code"');
  process.exit(1);
}

const plainRaw = await readFile(new URL("../discounts.plain.json", import.meta.url), "utf8");
const plain = JSON.parse(plainRaw); // validate it parses

if (plain?.type === "percentage") {
  const percentOff = Number(plain.percentOff);
  if (!Number.isFinite(percentOff) || percentOff <= 0 || percentOff >= 100) {
    throw new Error("percentOff must be a number greater than 0 and less than 100");
  }
} else if (!plain || Array.isArray(plain) || typeof plain !== "object") {
  throw new Error("discounts.plain.json must contain a percentage rule or an item-price map");
}

const plaintext = new TextEncoder().encode(JSON.stringify(plain));

const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));

const baseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveKey"]);
const key = await crypto.subtle.deriveKey(
  { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
  baseKey,
  { name: "AES-GCM", length: 256 },
  false,
  ["encrypt"]
);

const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);

const out = {
  v: 1,
  iterations: PBKDF2_ITERATIONS,
  salt: b64(salt),
  iv: b64(iv),
  data: b64(ciphertext),
};

await writeFile(new URL("../data/discounts.enc.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
const summary = plain.type === "percentage"
  ? `${plain.percentOff}% friend discount rule`
  : `${Object.keys(plain).length} friend price(s)`;
console.log(`Encrypted ${summary} -> data/discounts.enc.json`);

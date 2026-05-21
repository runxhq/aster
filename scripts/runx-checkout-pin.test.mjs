import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  assertRunxCheckoutHead,
  resolveExpectedHead,
  resolveRunxCheckout,
} from "./runx-checkout-pin.mjs";

const SHA_A = "0123456789abcdef0123456789abcdef01234567";
const SHA_B = "89abcdef0123456789abcdef0123456789abcdef";
const CUTOVER_SHA = "1c9b3078f59ad73b1741c199870dfb472d097c00";

test("default checked-in pin resolves to the clean Rust cutover SHA", async () => {
  const resolved = await resolveRunxCheckout({ env: {} });

  assert.equal(resolved.repository, "runxhq/runx");
  assert.equal(resolved.ref, CUTOVER_SHA);
  assert.equal(resolved.expected_head, CUTOVER_SHA);
  assert.equal(resolved.ref_source, "state/runx-oss-pin.json");
});

test("resolveRunxCheckout uses the checked-in pin when RUNX_REF is unset", async () => {
  const pinPath = await writePin({ ref: SHA_A, expected_head: "" });

  const resolved = await resolveRunxCheckout({
    pinPath,
    env: {},
  });

  assert.equal(resolved.repository, "runxhq/runx");
  assert.equal(resolved.ref, SHA_A);
  assert.equal(resolved.expected_head, SHA_A);
  assert.equal(resolved.ref_source, pinPath);
});

test("resolveRunxCheckout lets RUNX_REF override the checked-in default", async () => {
  const pinPath = await writePin({ ref: "main", expected_head: SHA_A });

  const resolved = await resolveRunxCheckout({
    pinPath,
    env: {
      RUNX_REPOSITORY: "runxhq/runx",
      RUNX_REF: SHA_B,
    },
  });

  assert.equal(resolved.ref, SHA_B);
  assert.equal(resolved.expected_head, SHA_B);
  assert.equal(resolved.ref_source, "RUNX_REF");
});

test("resolveRunxCheckout rejects floating refs", async () => {
  const pinPath = await writePin({ ref: "main", expected_head: "" });

  await assert.rejects(() => resolveRunxCheckout({
    pinPath,
    env: {},
  }), /runx ref must be a 40-character git SHA/);
});

test("resolveExpectedHead accepts an explicit expected_head pin", () => {
  assert.equal(resolveExpectedHead({ ref: "main", expectedHead: SHA_A }), SHA_A);
  assert.equal(resolveExpectedHead({ ref: SHA_B, expectedHead: "" }), SHA_B);
  assert.equal(resolveExpectedHead({ ref: "main", expectedHead: "" }), "");
});

test("assertRunxCheckoutHead fails closed when an exact pin does not match", () => {
  assert.doesNotThrow(() => assertRunxCheckoutHead({
    actualHead: SHA_A,
    expectedHead: SHA_A,
    checkoutPath: "runx",
  }));
  assert.throws(() => assertRunxCheckoutHead({
    actualHead: SHA_B,
    expectedHead: SHA_A,
    checkoutPath: "runx",
  }), /expected 0123456789abcdef0123456789abcdef01234567/);
});

test("assertRunxCheckoutHead still validates branch checkouts are real commits", () => {
  assert.doesNotThrow(() => assertRunxCheckoutHead({
    actualHead: SHA_A,
    expectedRef: "main",
  }));
  assert.throws(() => assertRunxCheckoutHead({
    actualHead: "main",
    expectedRef: "main",
  }), /actual runx HEAD must be a 40-character git SHA/);
});

async function writePin(overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aster-runx-pin-"));
  const pinPath = path.join(root, "pin.json");
  await writeFile(pinPath, `${JSON.stringify({
    schema: "runx.aster_runx_oss_pin.v1",
    repository: "runxhq/runx",
    ref: "main",
    expected_head: "",
    ...overrides,
  }, null, 2)}\n`);
  return pinPath;
}

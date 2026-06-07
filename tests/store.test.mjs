import test from "node:test";
import assert from "node:assert/strict";
import { createLocalRepository, createStore } from "../src/data/store.js";

test("local repositories keep user workspaces isolated", async () => {
  installMemoryStorage();

  const alice = createStore(createLocalRepository("alice"));
  await alice.hydrate();
  assert.equal(alice.getState().tasks.length, 3);
  alice.clearWorkspace();
  await flushPromises();
  assert.equal(alice.getState().tasks.length, 0);

  const bob = createStore(createLocalRepository("bob"));
  await bob.hydrate();
  assert.equal(bob.getState().tasks.length, 3);

  const aliceAgain = createStore(createLocalRepository("alice"));
  await aliceAgain.hydrate();
  assert.equal(aliceAgain.getState().tasks.length, 0);
});

function installMemoryStorage() {
  const values = new Map();
  globalThis.localStorage = {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    }
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

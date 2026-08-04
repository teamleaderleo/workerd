function classify(label, callback) {
  try {
    callback();
    return "success";
  } catch (error) {
    if (error instanceof TypeError && String(error).includes("Illegal invocation")) {
      return "illegal-invocation";
    }
    throw new Error(`${label} produced an unexpected failure: ${error?.stack ?? error}`);
  }
}

function expectOutcome(matrix, label, expected) {
  const actual = matrix[label];
  if (actual !== expected) {
    throw new Error(`${label} expected ${expected}, got ${actual}`);
  }
}

export const inheritedGlobalReceivers = {
  test() {
    const matrix = {};
    const target = new EventTarget();
    const fromSelf = self.addEventListener;
    const fromTarget = target.addEventListener;

    function probe(label, invoke) {
      const type = `unit-10-${label}`;
      const handler = () => {};
      matrix[label] = classify(label, () => invoke(type, handler));
      self.removeEventListener(type, handler);
      target.removeEventListener(type, handler);
    }

    probe("self.bare", (type, handler) => fromSelf(type, handler));
    probe("self.undefined", (type, handler) => fromSelf.call(undefined, type, handler));
    probe("self.null", (type, handler) => fromSelf.call(null, type, handler));
    probe("self.globalThis", (type, handler) => fromSelf.call(globalThis, type, handler));
    probe("self.self", (type, handler) => fromSelf.call(self, type, handler));
    probe("self.unrelated", (type, handler) => fromSelf.call({}, type, handler));

    probe("target.bare", (type, handler) => fromTarget(type, handler));
    probe("target.undefined", (type, handler) => fromTarget.call(undefined, type, handler));
    probe("target.null", (type, handler) => fromTarget.call(null, type, handler));
    probe("target.globalThis", (type, handler) => fromTarget.call(globalThis, type, handler));
    probe("target.self", (type, handler) => fromTarget.call(self, type, handler));
    probe("target.owner", (type, handler) => fromTarget.call(target, type, handler));
    probe("target.unrelated", (type, handler) => fromTarget.call({}, type, handler));

    console.log(`UNIT10_RECEIVER_MATRIX=${JSON.stringify(matrix)}`);

    expectOutcome(matrix, "self.bare", "success");
    expectOutcome(matrix, "self.undefined", "success");
    expectOutcome(matrix, "self.null", "success");
    expectOutcome(matrix, "self.globalThis", "success");
    expectOutcome(matrix, "self.self", "success");
    expectOutcome(matrix, "self.unrelated", "illegal-invocation");

    expectOutcome(matrix, "target.bare", "illegal-invocation");
    expectOutcome(matrix, "target.undefined", "illegal-invocation");
    expectOutcome(matrix, "target.null", "illegal-invocation");
    expectOutcome(matrix, "target.globalThis", "illegal-invocation");
    expectOutcome(matrix, "target.self", "illegal-invocation");
    expectOutcome(matrix, "target.owner", "success");
    expectOutcome(matrix, "target.unrelated", "illegal-invocation");
  },
};

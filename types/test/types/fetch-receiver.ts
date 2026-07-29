const url = "data:text/plain,receiver-ok";

fetch(url);
globalThis.fetch(url);
self.fetch(url);

const fromGlobal = globalThis.fetch;
const fromSelf = self.fetch;
const detached = fetch;

const sameAsGlobal: typeof fetch = fromGlobal;
const sameAsSelf: typeof fetch = fromSelf;
const globalAsSelfMember: typeof self.fetch = fetch;
void sameAsGlobal;
void sameAsSelf;
void globalAsSelfMember;

for (const operation of [detached, fromGlobal, fromSelf]) {
  operation(url);
  operation.call(undefined, url);
  operation.call(null, url);
  operation.call(globalThis, url);
  operation.call(self, url);

  operation.apply(undefined, [url]);
  operation.apply(null, [url]);
  operation.apply(globalThis, [url]);
  operation.apply(self, [url]);

  Reflect.apply(operation, undefined, [url]);
  Reflect.apply(operation, null, [url]);
  Reflect.apply(operation, globalThis, [url]);
  Reflect.apply(operation, self, [url]);

  const boundUndefined = operation.bind(undefined);
  const boundNull = operation.bind(null);
  const boundGlobal = operation.bind(globalThis);
  const boundSelf = operation.bind(self);
  boundUndefined(url);
  boundNull(url);
  boundGlobal(url);
  boundSelf(url);

  // Valid binding erases the native receiver requirement from the bound value.
  ({ fetch: boundGlobal }).fetch(url);

  for (const invalidReceiver of [{}, 0, "", true, Symbol("receiver")]) {
    // @ts-expect-error Unrelated objects and boxed primitives are illegal.
    operation.call(invalidReceiver, url);

    // @ts-expect-error Unrelated objects and boxed primitives are illegal.
    operation.apply(invalidReceiver, [url]);

    // @ts-expect-error Unrelated objects and boxed primitives are illegal.
    Reflect.apply(operation, invalidReceiver, [url]);

    // @ts-expect-error Unrelated objects and boxed primitives are illegal.
    operation.bind(invalidReceiver);
  }

  const holder = { fetch: operation };
  // @ts-expect-error Property-call syntax supplies holder as the receiver.
  holder.fetch(url);
}

class Client {
  fetchImpl = fetch;

  run() {
    // @ts-expect-error The client instance is not a legal Worker receiver.
    return this.fetchImpl(url);
  }
}

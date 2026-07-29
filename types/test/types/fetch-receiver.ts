const url = "data:text/plain,receiver-ok";

fetch(url);
globalThis.fetch(url);
self.fetch(url);

const fromGlobal = globalThis.fetch;
const fromSelf = self.fetch;
const detached = fetch;

const sameAsGlobal: typeof fetch = fromGlobal;
const sameAsSelf: typeof fetch = fromSelf;
void sameAsGlobal;
void sameAsSelf;

for (const operation of [detached, fromGlobal, fromSelf]) {
  operation(url);
  operation.call(undefined, url);
  operation.call(null, url);
  operation.call(globalThis, url);
  operation.call(self, url);

  // @ts-expect-error An unrelated object is not a legal Worker receiver.
  operation.call({}, url);

  operation.apply(undefined, [url]);
  operation.apply(null, [url]);
  operation.apply(globalThis, [url]);
  operation.apply(self, [url]);

  // @ts-expect-error An unrelated object is not a legal Worker receiver.
  operation.apply({}, [url]);

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

  // @ts-expect-error An unrelated object cannot be bound as the receiver.
  operation.bind({});

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

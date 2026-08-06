const globalAddEventListener = self.addEventListener;

globalAddEventListener('fetch', () => {});
globalAddEventListener.call(undefined, 'fetch', () => {});
globalAddEventListener.call(null, 'fetch', () => {});
globalAddEventListener.call(globalThis, 'fetch', () => {});
globalAddEventListener.call(self, 'fetch', () => {});

const eventTarget = new EventTarget();
const ownedAddEventListener = eventTarget.addEventListener;

ownedAddEventListener.call(eventTarget, 'message', () => {});

// @ts-expect-error Ordinary EventTarget methods remain owner-bound.
ownedAddEventListener('message', () => {});

// @ts-expect-error Ordinary EventTarget methods reject undefined receivers.
ownedAddEventListener.call(undefined, 'message', () => {});

// @ts-expect-error Ordinary EventTarget methods reject null receivers.
ownedAddEventListener.call(null, 'message', () => {});

// @ts-expect-error Ordinary EventTarget methods reject unrelated receivers.
ownedAddEventListener.call({}, 'message', () => {});

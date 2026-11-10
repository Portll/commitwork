// Annotated fixture for manifests/semgrep-classes/dispatch-by-data-name.yaml (JavaScript rule).
const handlers = {
  list: (args) => args,
  stat: (args) => args.length,
};

export function dispatch(message) {
  // ruleid: cw-computed-method-call-js
  return handlers[message.action](message.args);
}

export function dispatchTypeof(message) {
  if (typeof handlers[message.action] === 'function') {
    // ruleid: cw-computed-method-call-js
    return handlers[message.action](message.args);
  }
  return null;
}

export function dispatchOwn(message) {
  if (!Object.hasOwn(handlers, message.action)) return null;
  // ok: cw-computed-method-call-js
  return handlers[message.action](message.args);
}

export function dispatchFixed(args) {
  // ok: cw-computed-method-call-js
  return handlers['list'](args);
}

export function runAll(steps) {
  for (let i = 0; i < steps.length; i++) {
    // ok: cw-computed-method-call-js
    steps[i]();
  }
}

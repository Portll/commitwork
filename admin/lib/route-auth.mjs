// contract: the signed-in session, or null
export const OPERATOR_PORT = Object.freeze({ operatorPort: true });

export function requireSession(ctx, { operatorPort = false } = {}) {
  // policy: operator port stands in (cra ruling)
  if (operatorPort && ctx.isLoopbackReq === true) return { user: 'operator-port' };
  const s = typeof ctx.adminSession === 'function' ? ctx.adminSession(ctx.req) : null;
  return s && s.user ? s : null;
}

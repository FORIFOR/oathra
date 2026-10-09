import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { assert, Fault, equal, hash, random } from './security.mjs';

const SCOPES = ['oathra:read', 'oathra:draft'];
const AUTH_METHODS = ['none', 'client_secret_post', 'client_secret_basic'];
const CODE_TTL = 5 * 60_000, CONSENT_TTL = 10 * 60_000, ACCESS_TTL = 15 * 60_000;
const FAMILY_TTL = 30 * 86400_000, CLIENT_TTL = 90 * 86400_000;
const CLIENT_PENDING_TTL = 30 * 60_000;
const CONNECTION = 'mcp-oauth-connection';
const loopback = hostname => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
const tokenText = value => typeof value === 'string' && /^[A-Za-z0-9_-]{32,160}$/.test(value);

function originConfiguration(config) {
  try {
    const input = config.publicUrl;
    if (typeof input !== 'string' || /[\s\\]/.test(input)) return null;
    const u = new URL(input);
    if (u.username || u.password || u.search || u.hash || u.pathname !== '/') return null;
    if (u.protocol === 'http:' && loopback(u.hostname)) return { origin: u.origin, localOnly: true };
    if (u.protocol !== 'https:' || config.deployment !== 'managed' || isIP(u.hostname.replace(/^\[|\]$/g, '')) || loopback(u.hostname)) return null;
    if (!u.hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|example|invalid)$/.test(u.hostname) || /(?:^|\.)(?:trycloudflare\.com|ngrok-free\.app|ngrok\.io)$/.test(u.hostname)) return null;
    return { origin: u.origin, localOnly: false };
  } catch { return null; }
}

function fields(input) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'invalid_request');
  const out = Object.create(null), entries = input instanceof URLSearchParams ? [...input.entries()] : Object.entries(input);
  assert(entries.length <= 32, 'invalid_request');
  for (const [key, value] of entries) {
    assert(!Object.hasOwn(out, key) && typeof value === 'string' && value.length <= 4096, 'invalid_request');
    out[key] = value;
  }
  return out;
}

function scopes(value, allowed = SCOPES, fallback = ['oathra:read']) {
  if (value === undefined) { assert(fallback.every(s => allowed.includes(s)), 'invalid_scope'); return [...fallback]; }
  assert(typeof value === 'string' && value.length > 0 && value.length <= 100 && /^[\x21-\x7e]+(?: [\x21-\x7e]+)*$/.test(value), 'invalid_scope');
  const result = value.split(' ');
  assert(new Set(result).size === result.length && result.every(s => allowed.includes(s)), 'invalid_scope');
  return result;
}

function redirectUri(value) {
  assert(typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\s\\]/.test(value), 'invalid_redirect_uri');
  let u; try { u = new URL(value); } catch { throw new Fault(400, 'invalid_redirect_uri'); }
  assert(!u.username && !u.password && !u.hash && !value.includes('#') && (u.protocol === 'https:' || (u.protocol === 'http:' && loopback(u.hostname))), 'invalid_redirect_uri');
  for (const name of ['code', 'state', 'error', 'error_description', 'error_uri', 'iss']) assert(!u.searchParams.has(name), 'invalid_redirect_uri');
  // No normalization is used for matching at authorization or token exchange.
  return value;
}

/** OAuth for the remote MCP resource only. It cannot approve or start a call. */
export class McpOAuth {
  constructor(service, env = process.env) {
    this.service = service; this.store = service.store; this.config = service.config;
    this.configured = env.OATHRA_MCP_ENABLED === 'true';
    this.origin = originConfiguration(this.config);
    this.resource = this.origin ? this.origin.origin + '/mcp' : null;
  }
  status() {
    const enabled = this.configured && !!this.origin;
    return { enabled, publicReady: enabled && !this.origin.localOnly, localOnly: !!this.origin?.localOnly,
      reason: !this.configured ? 'mcp_oauth_disabled' : !this.origin ? 'mcp_requires_fixed_public_origin' : null,
      resource: this.resource, scopes: [...SCOPES] };
  }
  requireEnabled() { assert(this.status().enabled, 'mcp_oauth_disabled', 404); }
  metadata() {
    this.requireEnabled(); const issuer = this.origin.origin;
    return { issuer, authorization_endpoint: issuer + '/oauth/authorize', token_endpoint: issuer + '/oauth/token',
      registration_endpoint: issuer + '/oauth/register', revocation_endpoint: issuer + '/oauth/revoke',
      response_types_supported: ['code'], response_modes_supported: ['query'], grant_types_supported: ['authorization_code', 'refresh_token'],
      scopes_supported: [...SCOPES], token_endpoint_auth_methods_supported: [...AUTH_METHODS], revocation_endpoint_auth_methods_supported: [...AUTH_METHODS],
      code_challenge_methods_supported: ['S256'], authorization_response_iss_parameter_supported: true,
      client_id_metadata_document_supported: false };
  }
  protectedMetadata() {
    this.requireEnabled();
    return { resource: this.resource, authorization_servers: [this.origin.origin], scopes_supported: [...SCOPES], bearer_methods_supported: ['header'], resource_name: 'Oathra' };
  }
  readKey(scope, key) { const value = this.store.key(scope, hash(key)); return value ? this.store.open(value) : null; }
  writeKey(scope, key, value, expiresAt) { this.store.setKey(scope, hash(key), this.store.seal(value), expiresAt - this.store.now()); }
  client(id) {
    if (!tokenText(id)) return null;
    const c = this.readKey('mcp-oauth-client', id) ?? this.readKey('mcp-oauth-client-pending', id);
    return c && c.expiresAt > this.store.now() && c.issuer === this.origin?.origin ? c : null;
  }
  currentUser(binding) {
    const u = this.config.users.find(x => x.id === binding?.owner);
    return u && ['admin', 'operator', 'viewer'].includes(u.role) && equal(u.tokenHash, binding.tokenHash) && u.role === binding.role &&
      u.team === binding.team && this.service.passwords.version(u.id) === binding.passwordVersion ? u : null;
  }
  binding(owner) {
    const u = this.config.users.find(x => x.id === owner?.id);
    assert(u && ['admin', 'operator', 'viewer'].includes(u.role) && equal(u.tokenHash, owner.tokenHash), 'access_denied', 403);
    return { owner: u.id, tokenHash: u.tokenHash, passwordVersion: this.service.passwords.version(u.id), role: u.role, team: u.team };
  }
  register(body) {
    this.requireEnabled();
    assert(body && typeof body === 'object' && !Array.isArray(body), 'invalid_client_metadata');
    assert(Array.isArray(body.redirect_uris) && body.redirect_uris.length > 0 && body.redirect_uris.length <= 8, 'invalid_redirect_uri');
    const redirects = body.redirect_uris.map(redirectUri);
    assert(new Set(redirects).size === redirects.length, 'invalid_redirect_uri');
    const name = body.client_name ?? 'MCP client';
    assert(typeof name === 'string' && name.trim().length > 0 && name.length <= 80 && !/[\x00-\x1f\x7f]/.test(name), 'invalid_client_metadata');
    const method = body.token_endpoint_auth_method ?? 'client_secret_basic';
    assert(AUTH_METHODS.includes(method), 'invalid_client_metadata');
    const grants = body.grant_types ?? ['authorization_code', 'refresh_token'];
    assert(Array.isArray(grants) && grants.includes('authorization_code') && grants.length <= 2 && new Set(grants).size === grants.length && grants.every(g => ['authorization_code', 'refresh_token'].includes(g)), 'invalid_client_metadata');
    assert(body.response_types === undefined || (Array.isArray(body.response_types) && body.response_types.length === 1 && body.response_types[0] === 'code'), 'invalid_client_metadata');
    const permitted = scopes(body.scope, SCOPES, SCOPES), id = random(), secret = method === 'none' ? null : random();
    const now = this.store.now(), expiresAt = now + CLIENT_PENDING_TTL, secretExpiresAt = now + CLIENT_TTL;
    this.store.tx(() => {
      const count = this.store.db.prepare('SELECT COUNT(*) AS n FROM keys WHERE scope=? AND expires>?').get('mcp-oauth-client-pending', now).n;
      assert(count < 128, 'registration_capacity_reached', 429);
      this.writeKey('mcp-oauth-client-pending', id, { id, issuer: this.origin.origin, name: name.trim(), redirects, method, grants, scopes: permitted,
        secretHash: secret ? hash(secret) : null, createdAt: now, expiresAt, secretExpiresAt, approvedAt: null }, expiresAt);
    });
    return { client_id: id, client_id_issued_at: Math.floor(now / 1000), client_name: name.trim(), redirect_uris: redirects,
      token_endpoint_auth_method: method, grant_types: grants, response_types: ['code'], scope: permitted.join(' '),
      registration_expires_at: Math.floor(expiresAt / 1000),
      ...(secret ? { client_secret: secret, client_secret_expires_at: Math.floor(secretExpiresAt / 1000) } : {}) };
  }
  begin(params, owner) {
    this.requireEnabled(); const p = fields(params), binding = this.binding(owner), c = this.client(p.client_id);
    assert(c, 'invalid_client');
    assert(p.response_type === 'code' && (p.response_mode === undefined || p.response_mode === 'query'), 'unsupported_response_type');
    assert(c.redirects.includes(p.redirect_uri), 'invalid_redirect_uri');
    assert(p.resource === this.resource, 'invalid_target');
    assert(p.code_challenge_method === 'S256' && /^[A-Za-z0-9_-]{43}$/.test(p.code_challenge ?? ''), 'invalid_request');
    assert(typeof p.state === 'string' && p.state.length >= 1 && p.state.length <= 512 && /^[\x21-\x7e]+$/.test(p.state), 'invalid_request');
    const permitted = scopes(p.scope, c.scopes);
    assert(permitted.includes('oathra:read'), 'invalid_scope');
    assert(!permitted.includes('oathra:draft') || ['admin', 'operator'].includes(binding.role), 'invalid_scope');
    const requestId = random(), csrf = random(), now = this.store.now(), expiresAt = now + CONSENT_TTL;
    this.store.tx(() => {
      const pending = this.store.db.prepare('SELECT COUNT(*) AS n FROM keys WHERE scope=? AND expires>?').get('mcp-oauth-consent:' + owner.id, now).n;
      assert(pending < 10, 'consent_capacity_reached', 429);
      this.writeKey('mcp-oauth-consent:' + owner.id, requestId, { ...binding, clientId: c.id, redirectUri: p.redirect_uri, resource: this.resource,
        scopes: permitted, challenge: p.code_challenge, state: p.state, csrfHash: hash(csrf), expiresAt }, expiresAt);
    });
    return { requestId, csrf, clientName: c.name, redirectUri: p.redirect_uri, scopes: permitted };
  }
  approve(owner, input) {
    this.requireEnabled(); this.binding(owner);
    assert(input && tokenText(input.requestId) && tokenText(input.csrf) && typeof input.approved === 'boolean', 'invalid_request');
    return this.store.tx(() => {
      const r = this.readKey('mcp-oauth-consent:' + owner.id, input.requestId);
      assert(r && r.owner === owner.id && this.currentUser(r) && r.expiresAt > this.store.now() && equal(r.csrfHash, hash(input.csrf)), 'invalid_request');
      const c = this.client(r.clientId);
      assert(c && c.redirects.includes(r.redirectUri) && r.resource === this.resource, 'invalid_client');
      this.store.delKey('mcp-oauth-consent:' + owner.id, hash(input.requestId));
      const target = new URL(r.redirectUri);
      target.searchParams.set('state', r.state); target.searchParams.set('iss', this.origin.origin);
      if (input.approved) {
        if (c.approvedAt === null) {
          const count = this.store.db.prepare('SELECT COUNT(*) AS n FROM keys WHERE scope=? AND expires>?').get('mcp-oauth-client', this.store.now()).n;
          assert(count < 256, 'registration_capacity_reached', 429);
          // Unapproved public registrations occupy short-lived capacity only. Approval never evicts another client.
          this.writeKey('mcp-oauth-client', c.id, { ...c, approvedAt: this.store.now(), expiresAt: c.secretExpiresAt }, c.secretExpiresAt);
          this.store.delKey('mcp-oauth-client-pending', hash(c.id));
        }
        const code = random(), expiresAt = this.store.now() + CODE_TTL;
        const { csrfHash, state, ...grant } = r;
        this.writeKey('mcp-oauth-code', code, { ...grant, expiresAt, usedAt: null }, expiresAt);
        target.searchParams.set('code', code);
      } else target.searchParams.set('error', 'access_denied');
      return { redirectUrl: target.href };
    });
  }
  authenticatedClient(p, authHeader) {
    let id = p.client_id, secret = p.client_secret, basic = false;
    if (authHeader !== undefined && authHeader !== null) {
      assert(typeof authHeader === 'string' && /^Basic [A-Za-z0-9+/]+={0,2}$/.test(authHeader) && authHeader.length <= 2048 && secret === undefined, 'invalid_client', 401);
      const encoded = authHeader.slice(6), decoded = Buffer.from(encoded, 'base64').toString('utf8'), colon = decoded.indexOf(':');
      assert(colon >= 1 && Buffer.from(decoded).toString('base64') === encoded, 'invalid_client', 401);
      try {
        const basicId = decodeURIComponent(decoded.slice(0, colon).replace(/\+/g, ' '));
        secret = decodeURIComponent(decoded.slice(colon + 1).replace(/\+/g, ' '));
        assert(id === undefined || id === basicId, 'invalid_client', 401); id = basicId;
      } catch { throw new Fault(401, 'invalid_client'); }
      basic = true;
    }
    const c = this.client(id); assert(c, 'invalid_client', 401);
    if (c.method === 'none') assert(!basic && secret === undefined, 'invalid_client', 401);
    else {
      assert((c.method === 'client_secret_basic') === basic && typeof secret === 'string' && tokenText(secret) && equal(c.secretHash, hash(secret)), 'invalid_client', 401);
    }
    return c;
  }
  revokeFamily(connection, reason) {
    if (!connection || connection.status === 'REVOKED') return;
    this.store.put(CONNECTION, { ...connection, status: 'REVOKED', revokedAt: this.store.now(), revocationReason: reason });
    this.store.audit(connection.owner, 'mcp.connection_revoked', connection.id, { reason });
  }
  family(id, clientId) {
    const f = this.store.get(CONNECTION, id);
    return f && f.status === 'ACTIVE' && f.expiresAt > this.store.now() && f.clientId === clientId && f.resource === this.resource && this.currentUser(f) ? f : null;
  }
  issueTokens(f, c, permitted) {
    const now = this.store.now(), access = random(), refresh = c.grants.includes('refresh_token') ? random() : null;
    const accessExpiry = Math.min(now + ACCESS_TTL, f.expiresAt), base = { connectionId: f.id, clientId: c.id, resource: this.resource, scopes: permitted };
    this.writeKey('mcp-oauth-access', access, { ...base, expiresAt: accessExpiry }, accessExpiry);
    if (refresh) this.writeKey('mcp-oauth-refresh', refresh, { ...base, expiresAt: f.expiresAt, usedAt: null }, f.expiresAt);
    this.store.put(CONNECTION, { ...f, lastUsedAt: now });
    return { access_token: access, token_type: 'Bearer', expires_in: Math.floor((accessExpiry - now) / 1000), scope: permitted.join(' '), ...(refresh ? { refresh_token: refresh } : {}) };
  }
  token(form, authHeader) {
    this.requireEnabled(); const p = fields(form), c = this.authenticatedClient(p, authHeader);
    assert(['authorization_code', 'refresh_token'].includes(p.grant_type) && c.grants.includes(p.grant_type), 'unsupported_grant_type');
    assert(p.resource === this.resource, 'invalid_target');
    const result = this.store.tx(() => {
      if (p.grant_type === 'authorization_code') {
        assert(tokenText(p.code) && typeof p.code_verifier === 'string' && /^[A-Za-z0-9._~-]{43,128}$/.test(p.code_verifier), 'invalid_grant');
        const r = this.readKey('mcp-oauth-code', p.code);
        assert(r && r.clientId === c.id && r.redirectUri === p.redirect_uri && r.resource === this.resource && r.expiresAt > this.store.now(), 'invalid_grant');
        assert(equal(r.challenge, createHash('sha256').update(p.code_verifier).digest('base64url')), 'invalid_grant');
        if (r.usedAt !== null) {
          this.revokeFamily(this.store.get(CONNECTION, r.connectionId), 'authorization_code_reuse');
          return { error: 'invalid_grant' }; // Commit revocation before returning the OAuth error.
        }
        assert(this.currentUser(r) && r.scopes.every(s => c.scopes.includes(s)), 'invalid_grant');
        const count = this.store.all(CONNECTION, r.owner).filter(x => x.status === 'ACTIVE' && x.expiresAt > this.store.now()).length;
        assert(count < 30, 'connection_capacity_reached', 429);
        const now = this.store.now(), expiresAt = Math.min(now + (c.grants.includes('refresh_token') ? FAMILY_TTL : ACCESS_TTL), c.expiresAt);
        const f = { id: randomUUID(), owner: r.owner, tokenHash: r.tokenHash, passwordVersion: r.passwordVersion, role: r.role, team: r.team,
          clientId: c.id, clientName: c.name, resource: this.resource, scopes: r.scopes, status: 'ACTIVE', createdAt: now, expiresAt };
        this.writeKey('mcp-oauth-code', p.code, { ...r, usedAt: now, connectionId: f.id }, r.expiresAt);
        this.store.put(CONNECTION, f);
        this.store.audit(r.owner, 'mcp.connection_created', f.id, { scopes: r.scopes });
        return this.issueTokens(f, c, r.scopes);
      }
      assert(tokenText(p.refresh_token), 'invalid_grant');
      const r = this.readKey('mcp-oauth-refresh', p.refresh_token);
      assert(r && r.clientId === c.id && r.resource === this.resource && r.expiresAt > this.store.now(), 'invalid_grant');
      const f = this.family(r.connectionId, c.id); assert(f, 'invalid_grant');
      if (r.usedAt !== null) {
        this.revokeFamily(f, 'refresh_token_reuse');
        return { error: 'invalid_grant' };
      }
      const permitted = scopes(p.scope, r.scopes, r.scopes);
      assert(permitted.includes('oathra:read'), 'invalid_scope');
      this.writeKey('mcp-oauth-refresh', p.refresh_token, { ...r, usedAt: this.store.now() }, r.expiresAt);
      return this.issueTokens(f, c, permitted);
    });
    if (result.error) throw new Fault(400, result.error);
    return result;
  }
  authenticate(token) {
    this.requireEnabled(); assert(tokenText(token), 'invalid_token', 401);
    return this.store.tx(() => {
      const a = this.readKey('mcp-oauth-access', token), c = a && this.client(a.clientId), f = a && this.family(a.connectionId, a.clientId);
      assert(a && c && f && a.resource === this.resource && a.expiresAt > this.store.now() && a.scopes.every(s => f.scopes.includes(s) && c.scopes.includes(s)), 'invalid_token', 401);
      // Serialize with revocation so the last-use update cannot restore an older ACTIVE record.
      if (!f.lastUsedAt || f.lastUsedAt < this.store.now() - 60_000) this.store.put(CONNECTION, { ...f, lastUsedAt: this.store.now() });
      return { user: this.currentUser(f), scopes: [...a.scopes], connectionId: f.id };
    });
  }
  connections(owner) {
    this.binding(owner);
    return this.store.all(CONNECTION, owner.id).sort((a, b) => b.createdAt - a.createdAt).map(f => ({
      id: f.id, clientName: f.clientName, scopes: [...f.scopes], createdAt: f.createdAt, lastUsedAt: f.lastUsedAt ?? null,
      revokedAt: f.revokedAt ?? null, expiresAt: f.expiresAt,
      status: f.status === 'REVOKED' ? 'REVOKED' : f.expiresAt <= this.store.now() ? 'EXPIRED' : !this.currentUser(f) || !this.client(f.clientId) || f.resource !== this.resource ? 'INVALIDATED' : 'ACTIVE'
    }));
  }
  revokeConnection(owner, id) {
    this.binding(owner); assert(typeof id === 'string' && id.length <= 80, 'invalid_request');
    this.store.tx(() => {
      const f = this.store.get(CONNECTION, id); assert(f && f.owner === owner.id, 'not_found', 404);
      this.revokeFamily(f, 'owner_revoked');
    });
    return { revoked: true };
  }
  revoke(form, authHeader) {
    this.requireEnabled(); const p = fields(form), c = this.authenticatedClient(p, authHeader);
    assert(typeof p.token === 'string' && p.token.length > 0 && p.token.length <= 4096, 'invalid_request');
    if (p.resource !== undefined) assert(p.resource === this.resource, 'invalid_target');
    if (!tokenText(p.token)) return {}; // RFC 7009: an unknown token is already revoked.
    this.store.tx(() => {
      const r = this.readKey('mcp-oauth-refresh', p.token) ?? this.readKey('mcp-oauth-access', p.token);
      if (r?.clientId === c.id) {
        const f = this.store.get(CONNECTION, r.connectionId);
        if (f?.clientId === c.id) this.revokeFamily(f, 'client_revoked');
      }
    });
    return {};
  }
}

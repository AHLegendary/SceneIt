import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import loginHandler from '../../api/login.js';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

const INVALID = { error: 'invalid_credentials' };

function mockRes() {
  const res = {};
  res.status = vi.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body) => {
    res.body = body;
    return res;
  });
  res.setHeader = vi.fn();
  return res;
}

function post(body) {
  return { method: 'POST', body };
}

let profileQuery;
let admin;
let anon;

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'publishable-key');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
  vi.spyOn(console, 'error').mockImplementation(() => {});

  profileQuery = {
    select: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'user-1' }, error: null }),
  };
  admin = {
    from: vi.fn(() => profileQuery),
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue({
          data: { user: { email: 'reil@example.com' } },
          error: null,
        }),
      },
    },
  };
  anon = {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'access', refresh_token: 'refresh', user: { email: 'reil@example.com' } } },
        error: null,
      }),
    },
  };
  createClient.mockImplementation((_url, key) => (key === 'service-key' ? admin : anon));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  createClient.mockReset();
});

describe('POST /api/login', () => {
  it('returns 405 for non-POST requests', async () => {
    const res = mockRes();
    await loginHandler({ method: 'GET' }, res);

    expect(res.statusCode).toBe(405);
    expect(res.setHeader).toHaveBeenCalledWith('Allow', 'POST');
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    ['missing body', undefined],
    ['missing username', { password: 'secret123' }],
    ['missing password', { username: 'reil_99' }],
    ['empty password', { username: 'reil_99', password: '' }],
    ['non-string username', { username: ['reil_99'], password: 'secret123' }],
    ['non-string password', { username: 'reil_99', password: 12345678 }],
    ['username too short', { username: 'ab', password: 'secret123' }],
    ['username too long', { username: 'a'.repeat(21), password: 'secret123' }],
    ['username with invalid characters', { username: 'bad name!', password: 'secret123' }],
    ['email passed as username', { username: 'reil@example.com', password: 'secret123' }],
  ])('returns 401 for %s without touching Supabase', async (_label, body) => {
    const res = mockRes();
    await loginHandler(post(body), res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(INVALID);
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    ['VITE_SUPABASE_URL'],
    ['VITE_SUPABASE_PUBLISHABLE_KEY'],
    ['SUPABASE_SERVICE_ROLE_KEY'],
  ])('returns 500 when %s is not set', async (name) => {
    vi.stubEnv(name, '');

    const res = mockRes();
    await loginHandler(post({ username: 'reil_99', password: 'secret123' }), res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'server_not_configured' });
    expect(admin.from).not.toHaveBeenCalled();
  });

  it('returns only the session tokens on success', async () => {
    const res = mockRes();
    await loginHandler(post({ username: 'reil_99', password: 'secret123' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ session: { access_token: 'access', refresh_token: 'refresh' } });
    expect(JSON.stringify(res.body)).not.toContain('reil@example.com');
  });

  it('resolves the username through profiles and signs in with the matching email', async () => {
    await loginHandler(post({ username: 'reil_99', password: 'secret123' }), mockRes());

    expect(admin.from).toHaveBeenCalledWith('profiles');
    expect(admin.auth.admin.getUserById).toHaveBeenCalledWith('user-1');
    expect(anon.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'reil@example.com',
      password: 'secret123',
    });
  });

  it('escapes underscores so they do not act as LIKE wildcards', async () => {
    await loginHandler(post({ username: 'a_b_c', password: 'secret123' }), mockRes());

    expect(profileQuery.ilike).toHaveBeenCalledWith('username', 'a\\_b\\_c');
  });

  it('uses the service role key only for lookups and the publishable key for sign-in', async () => {
    await loginHandler(post({ username: 'reil_99', password: 'secret123' }), mockRes());

    const keys = createClient.mock.calls.map(([, key]) => key);
    expect(keys).toEqual(['service-key', 'publishable-key']);
    expect(createClient.mock.calls[1][2]).toMatchObject({ auth: { persistSession: false } });
  });

  it('returns 401 for an unknown username without attempting sign-in', async () => {
    profileQuery.maybeSingle.mockResolvedValue({ data: null, error: null });

    const res = mockRes();
    await loginHandler(post({ username: 'nobody', password: 'secret123' }), res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(INVALID);
    expect(anon.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('gives the same response for a wrong password as for an unknown username', async () => {
    anon.auth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { status: 400, message: 'Invalid login credentials' },
    });
    const wrongPassword = mockRes();
    await loginHandler(post({ username: 'reil_99', password: 'wrong-pass' }), wrongPassword);

    profileQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
    const unknownUser = mockRes();
    await loginHandler(post({ username: 'nobody', password: 'wrong-pass' }), unknownUser);

    expect(wrongPassword.statusCode).toBe(401);
    expect(wrongPassword.statusCode).toBe(unknownUser.statusCode);
    expect(wrongPassword.body).toEqual(unknownUser.body);
  });

  it('returns 500 when the profile lookup fails', async () => {
    profileQuery.maybeSingle.mockResolvedValue({ data: null, error: { message: 'db down' } });

    const res = mockRes();
    await loginHandler(post({ username: 'reil_99', password: 'secret123' }), res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'lookup_failed' });
    expect(anon.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it.each([
    ['an error', { data: { user: null }, error: { message: 'not found' } }],
    ['no user', { data: { user: null }, error: null }],
    ['a user with no email', { data: { user: { email: null } }, error: null }],
  ])('returns 401 when the auth lookup returns %s', async (_label, result) => {
    admin.auth.admin.getUserById.mockResolvedValue(result);

    const res = mockRes();
    await loginHandler(post({ username: 'reil_99', password: 'secret123' }), res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(INVALID);
    expect(anon.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('returns 502 when sign-in fails for a reason other than bad credentials', async () => {
    anon.auth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { status: 500, message: 'Auth unavailable' },
    });

    const res = mockRes();
    await loginHandler(post({ username: 'reil_99', password: 'secret123' }), res);

    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'auth_unavailable' });
  });

  it('returns 502 when a Supabase call throws', async () => {
    admin.auth.admin.getUserById.mockRejectedValue(new Error('Network error'));

    const res = mockRes();
    await loginHandler(post({ username: 'reil_99', password: 'secret123' }), res);

    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'auth_unavailable' });
  });
});

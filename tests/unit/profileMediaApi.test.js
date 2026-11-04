import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = {
  getBucket: vi.fn(),
  createBucket: vi.fn(),
  from: vi.fn(),
};
const auth = { getUser: vi.fn() };
vi.mock('../../api/_lib/supabaseAdmin.js', () => ({
  getAdminClient: () => ({ storage, auth }),
  getUserFromRequest: async (req) => (req.headers?.authorization === 'Bearer good' ? { id: 'user-1' } : null),
}));

const { default: handler } = await import('../../api/profile/media.js');

function mockRes() {
  const res = {};
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((body) => { res.body = body; return res; });
  return res;
}
const PNG_DATA = `data:image/jpeg;base64,${Buffer.from('jpegbytes').toString('base64')}`;

beforeEach(() => {
  storage.getBucket.mockResolvedValue({ data: { id: 'profile-media' } });
  storage.from.mockReturnValue({
    upload: vi.fn().mockResolvedValue({ error: null }),
    remove: vi.fn().mockResolvedValue({ error: null }),
    getPublicUrl: () => ({ data: { publicUrl: 'https://x.supabase.co/storage/v1/object/public/profile-media/user-1/avatar.jpg' } }),
  });
});
afterEach(() => vi.clearAllMocks());

describe('PUT /api/profile/media', () => {
  it('needs a logged-in user', async () => {
    const res = mockRes();
    await handler({ method: 'PUT', headers: {}, body: { kind: 'avatar', image: PNG_DATA } }, res);
    expect(res.statusCode).toBe(401);
  });
  it('rejects unknown kinds and non-JPEG payloads', async () => {
    let res = mockRes();
    await handler({ method: 'PUT', headers: { authorization: 'Bearer good' }, body: { kind: 'cover', image: PNG_DATA } }, res);
    expect(res.statusCode).toBe(400);
    res = mockRes();
    await handler({ method: 'PUT', headers: { authorization: 'Bearer good' }, body: { kind: 'avatar', image: 'data:image/png;base64,AAAA' } }, res);
    expect(res.statusCode).toBe(400);
  });
  it("stores the image under the user's folder and returns a cache-busted URL", async () => {
    const res = mockRes();
    await handler({ method: 'PUT', headers: { authorization: 'Bearer good' }, body: { kind: 'avatar', image: PNG_DATA } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.url).toMatch(/user-1\/avatar\.jpg\?v=\d+$/);
    expect(storage.from().upload).toHaveBeenCalledWith('user-1/avatar.jpg', expect.any(Buffer), expect.objectContaining({ upsert: true }));
  });
  it('removes the image on DELETE', async () => {
    const res = mockRes();
    await handler({ method: 'DELETE', headers: { authorization: 'Bearer good' }, query: { kind: 'banner' } }, res);
    expect(res.statusCode).toBe(200);
    expect(storage.from().remove).toHaveBeenCalledWith(['user-1/banner.jpg']);
  });
});

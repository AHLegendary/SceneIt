
import { describe, it, expect, vi, afterEach } from "vitest";
import handler from "../../api/health.js";

describe("TMDb health check API", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns true when the TMDb token is configured", () => {
    vi.stubEnv("TMDB_READ_TOKEN", "test-token");

    const req = {};
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      tmdbConfigured: true,
    });
  });

  it("returns false when the TMDb token is missing", () => {
    vi.stubEnv("TMDB_READ_TOKEN", "");

    const req = {};
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      tmdbConfigured: false,
    });
  });
});

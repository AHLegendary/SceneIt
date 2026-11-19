import { describe, it, expect } from "vitest";
import { envProblems } from "../../src/lib/missingEnv.js";

const ok = { VITE_SUPABASE_URL: "https://x.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "k" };

describe("envProblems", () => {
  it("is empty when both variables are set", () => {
    expect(envProblems(ok)).toEqual([]);
  });
  it("names each missing variable", () => {
    expect(envProblems({})).toEqual([
      "VITE_SUPABASE_URL is missing",
      "VITE_SUPABASE_PUBLISHABLE_KEY is missing",
    ]);
  });
  it("flags a URL that does not parse", () => {
    expect(envProblems({ ...ok, VITE_SUPABASE_URL: "your-supabase-project-url" })).toEqual([
      "VITE_SUPABASE_URL is not a valid URL",
    ]);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import { chatCompletionDetailed } from "@/services/llm/llm";
import {
  containsForbiddenStorage,
  extractHtml,
  looksTruncatedHtml,
} from "@/services/generation/app";
import { chatWithTruncationRetry } from "@/services/generation/shared";
import { slugify } from "@/services/apps/apps";

vi.mock("@/services/llm/llm", () => ({
  chatCompletion: vi.fn(),
  chatCompletionDetailed: vi.fn(),
  chatCompletionStream: vi.fn(),
  defaultModels: { planner: "planner-test", coder: "coder-test" },
  LlmError: class LlmError extends Error {},
}));

const mockedDetailed = vi.mocked(chatCompletionDetailed);

describe("generate.extractHtml", () => {
  it("extracts the content of a ```html``` block", () => {
    const text = "Here is the code:\n```html\n<div>Hello</div>\n```\nEnd.";
    expect(extractHtml(text)).toBe("<div>Hello</div>");
  });

  it("returns the whole text when there is no marked block", () => {
    const text = "<div>Direct</div>";
    expect(extractHtml(text)).toBe("<div>Direct</div>");
  });

  it("strips surrounding whitespace", () => {
    expect(extractHtml("  <p>ok</p>\n")).toBe("<p>ok</p>");
  });

  it("strips a leading ```html marker left behind (unclosed block)", () => {
    expect(extractHtml("```html\n<div>Rendered</div>")).toBe("<div>Rendered</div>");
  });

  it("strips a leading and trailing ``` marker", () => {
    expect(extractHtml("```\n<div>Rendered</div>\n```")).toBe("<div>Rendered</div>");
  });
});

describe("generate.containsForbiddenStorage", () => {
  it("detects localStorage", () => {
    expect(containsForbiddenStorage("localStorage.setItem('a', 'b')")).toBe(true);
  });
  it("detects sessionStorage / IndexedDB / document.cookie", () => {
    expect(containsForbiddenStorage("sessionStorage.getItem('x')")).toBe(true);
    expect(containsForbiddenStorage("indexedDB.open('db')")).toBe(true);
    expect(containsForbiddenStorage("document.cookie = 'a=b'")).toBe(true);
  });
  it("accepts code that only uses homeSDK.storage", () => {
    const html = "<script>await homeSDK.storage.set('tasks', [])</script>";
    expect(containsForbiddenStorage(html)).toBe(false);
  });
});

describe("generate.looksTruncatedHtml", () => {
  it("detects truncation through finish_reason length", () => {
    expect(looksTruncatedHtml("<div>ok</div>", "length")).toBe(true);
  });

  // Deliberately inverted expectation: the stored format is a fragment (see the
  // repo templates, which end with </script>), so requiring </html> flagged
  // every correct template-installed app as truncated.
  it("accepts a well-formed fragment with no </html>", () => {
    expect(looksTruncatedHtml("<div>ok</div>", "stop")).toBe(false);
    expect(looksTruncatedHtml("<div>ok</div>", null)).toBe(false);
  });

  it("accepts a complete HTML document", () => {
    const full = "<html><body><p>ok</p></body></html>";
    expect(looksTruncatedHtml(full, "stop")).toBe(false);
    expect(looksTruncatedHtml(`${full}\n`, null)).toBe(false);
  });
});

describe("generate.chatWithTruncationRetry", () => {
  afterEach(() => {
    mockedDetailed.mockReset();
  });

  it("returns an untruncated response directly", async () => {
    mockedDetailed.mockResolvedValueOnce({ text: "<html></html>", finishReason: "stop" });
    const r = await chatWithTruncationRetry(
      [{ role: "user", content: "x" }],
      { maxTokens: 16384 },
      (t, f) => looksTruncatedHtml(t, f),
    );
    expect(r).toEqual({ text: "<html></html>", finishReason: "stop" });
    expect(mockedDetailed).toHaveBeenCalledTimes(1);
  });

  it("retries once with a doubled budget when truncated, then succeeds", async () => {
    mockedDetailed
      .mockResolvedValueOnce({ text: "<div>incomplete", finishReason: "length" })
      .mockResolvedValueOnce({ text: "<html></html>", finishReason: "stop" });
    const r = await chatWithTruncationRetry(
      [{ role: "user", content: "x" }],
      { maxTokens: 16384 },
      (t, f) => looksTruncatedHtml(t, f),
    );
    expect(r).toEqual({ text: "<html></html>", finishReason: "stop" });
    expect(mockedDetailed).toHaveBeenCalledTimes(2);
    expect(mockedDetailed.mock.calls[1][1]?.maxTokens).toBe(32768);
  });

  it("throws an LlmError when still truncated after the retry", async () => {
    mockedDetailed.mockResolvedValue({ text: "<div>incomplete", finishReason: "length" });
    await expect(
      chatWithTruncationRetry(
        [{ role: "user", content: "x" }],
        { maxTokens: 16384 },
        (t, f) => looksTruncatedHtml(t, f),
      ),
    ).rejects.toThrow("truncated");
    expect(mockedDetailed).toHaveBeenCalledTimes(2);
  });
});

describe("apps.slugify", () => {
  it("normalises a name into a slug", () => {
    expect(slugify("Weekly Recap")).toBe("weekly-recap");
  });
  it("falls back to a default slug when empty", () => {
    expect(slugify("!!!" )).toBe("app");
  });
});

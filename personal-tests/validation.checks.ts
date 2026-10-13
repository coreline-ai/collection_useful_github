import test from "node:test";
import assert from "node:assert/strict";
import {
  classify,
  validateItem,
  validateBackup,
  importBatches,
} from "../personal/shared.ts";
const item = {
  url: "coreline-ai/collection_useful_github",
  title: "자료",
  tags: ["개발", "개발", "  메모 "],
  notes: "테스트",
};
test("GitHub shorthand/case/query canonicalization", () => {
  assert.deepEqual(
    classify("HTTP://www.GitHub.com/Coreline-AI/Repo.git?x=1#x"),
    { provider: "github", url: "https://github.com/coreline-ai/repo" },
  );
  assert.equal(classify(item.url).provider, "github");
});
test("YouTube canonicalization", () => {
  for (const url of [
    "https://youtu.be/dQw4w9WgXcQ?t=2",
    "https://youtube.com/shorts/dQw4w9WgXcQ",
    "https://youtube.com/watch?v=dQw4w9WgXcQ",
  ])
    assert.equal(
      classify(url).url,
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
});
test("unsafe schemes, local IPs, credentials, malformed providers rejected", () => {
  for (const url of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://user:pass@example.com",
    "http://127.0.0.1",
    "http://2130706433",
    "http://10.0.0.1",
    "http://[::1]",
    "http://x.internal",
    "https://github.com/a",
    "https://youtube.com/watch?v=no",
  ])
    assert.throws(() => classify(url), url);
});
test("normalizes tags, derives provider and supplies defaults", () => {
  const i = validateItem({ ...item, provider: "youtube" });
  assert.equal(i.provider, "github");
  assert.deepEqual(i.tags, ["개발", "메모"]);
  assert.equal(i.category, "기본");
  assert.equal(i.pinned, false);
});
test("validates types and all size boundaries", () => {
  for (const patch of [
    { title: "" },
    { title: "x".repeat(181) },
    { description: "x".repeat(2001) },
    { notes: "x".repeat(12001) },
    { category: "x".repeat(41) },
    { tags: Array(11).fill("tag") },
    { tags: ["x".repeat(31)] },
    { tags: [3] },
    { pinned: "true" },
  ])
    assert.throws(() => validateItem({ ...item, ...patch }));
  assert.equal(
    validateItem({ ...item, notes: "x".repeat(12000) }).notes.length,
    12000,
  );
});
test("backup validates whole batch and duplicates before mutation", () => {
  assert.equal(
    validateBackup({ format: "coreline-personal-v1", items: [item] }).length,
    1,
  );
  for (const x of [
    { items: [item] },
    { format: "coreline-personal-v1", items: [item, item] },
    {
      format: "coreline-personal-v1",
      items: [item, { ...item, url: "javascript:1" }],
    },
  ])
    assert.throws(() => validateBackup(x));
});

test("large Unicode backups split below server byte and row limits", () => {
  const items = Array.from({ length: 500 }, (_, i) =>
    validateItem({
      ...item,
      url: `https://example.com/${i}`,
      notes: "한".repeat(12000),
      description: "설".repeat(2000),
    }),
  );
  const batches = importBatches(items);
  assert.equal(batches.flat().length, 500);
  for (const batch of batches) {
    assert.ok(batch.length <= 20);
    assert.ok(
      new TextEncoder().encode(
        JSON.stringify({ format: "coreline-personal-v1", items: batch }),
      ).length <=
        512 * 1024,
    );
  }
});

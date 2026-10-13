export type Provider = "github" | "youtube" | "bookmark";
export type ItemInput = {
  provider: Provider;
  url: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  notes: string;
  pinned: boolean;
};
export type Item = ItemInput & {
  id: string;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
export const labels: Record<Provider, string> = {
  github: "GitHub",
  youtube: "YouTube",
  bookmark: "북마크",
};
export class AppError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const fail = (message: string): never => {
  throw new AppError(400, message);
};
export function safeUrl(value: unknown): URL {
  if (typeof value !== "string" || value.length > 2048)
    return fail("URL은 2,048자 이내로 입력해 주세요.");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return fail("올바른 http 또는 https 주소를 입력해 주세요.");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    return fail("인증정보가 없는 http 또는 https 주소만 저장할 수 있습니다.");
  if (
    !url.hostname.includes(".") ||
    /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(
      url.hostname,
    ) ||
    url.hostname.includes(":") ||
    /\.(local|internal)$/i.test(url.hostname)
  )
    return fail("공개 웹사이트 주소를 입력해 주세요.");
  return url;
}
export function classify(raw: string): { provider: Provider; url: string } {
  if (/^[\w.-]+\/[\w.-]+$/.test(raw.trim()))
    raw = `https://github.com/${raw.trim()}`;
  const url = safeUrl(raw);
  url.hash = "";
  if (
    url.hostname.toLowerCase() === "github.com" ||
    url.hostname.toLowerCase() === "www.github.com"
  ) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 2 || !parts.every((v) => /^[\w.-]+$/.test(v)))
      return fail("GitHub 저장소 주소(owner/repo)를 입력해 주세요.");
    return {
      provider: "github",
      url: `https://github.com/${parts[0].toLowerCase()}/${parts[1].replace(/\.git$/i, "").toLowerCase()}`,
    };
  }
  if (
    ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(
      url.hostname,
    )
  ) {
    const id =
      url.hostname === "youtu.be"
        ? url.pathname.slice(1)
        : url.pathname.startsWith("/shorts/")
          ? url.pathname.split("/")[2]
          : url.searchParams.get("v");
    if (!id || !/^[\w-]{11}$/.test(id))
      return fail("YouTube 동영상 주소를 입력해 주세요.");
    return {
      provider: "youtube",
      url: `https://www.youtube.com/watch?v=${id}`,
    };
  }
  return { provider: "bookmark", url: url.href };
}
const string = (
  obj: Record<string, unknown>,
  key: string,
  max: number,
  fallback = "",
) => {
  const v = obj[key] ?? fallback;
  if (typeof v !== "string" || v.length > max)
    return fail(
      `${key}: 최대 ${max.toLocaleString()}자까지 입력할 수 있습니다.`,
    );
  return v.trim();
};
export function validateItem(value: unknown): ItemInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail("자료 형식이 올바르지 않습니다.");
  const obj = value as Record<string, unknown>;
  const source = classify(string(obj, "url", 2048));
  const title = string(obj, "title", 180);
  if (!title) return fail("제목을 입력해 주세요.");
  const tags = obj.tags ?? [];
  if (
    !Array.isArray(tags) ||
    tags.length > 10 ||
    tags.some((t) => typeof t !== "string" || t.length > 30)
  )
    return fail("태그는 30자 이내로 최대 10개까지 입력할 수 있습니다.");
  if (obj.pinned !== undefined && typeof obj.pinned !== "boolean")
    return fail("고정 값이 올바르지 않습니다.");
  return {
    ...source,
    title,
    description: string(obj, "description", 2000),
    category: string(obj, "category", 40, "기본") || "기본",
    tags: [...new Set(tags.map((t) => t.trim()).filter(Boolean))],
    notes: string(obj, "notes", 12000),
    pinned: obj.pinned === true,
  };
}
export function validateBackup(value: unknown): ItemInput[] {
  if (!value || typeof value !== "object")
    return fail("백업 JSON 형식이 올바르지 않습니다.");
  const v = value as Record<string, unknown>;
  if (
    v.format !== "coreline-personal-v1" ||
    !Array.isArray(v.items) ||
    v.items.length > 500
  )
    return fail("개인 자료함 백업(최대 500개)만 가져올 수 있습니다.");
  const items = v.items.map(validateItem);
  if (new Set(items.map((i) => i.url)).size !== items.length)
    return fail("백업에 중복 URL이 있습니다.");
  return items;
}

// Bound both row count and UTF-8 bytes so even Korean notes round-trip safely.
export function importBatches(items: ItemInput[]): ItemInput[][] {
  const batches: ItemInput[][] = [];
  let batch: ItemInput[] = [];
  const bytes = (value: ItemInput[]) =>
    new TextEncoder().encode(
      JSON.stringify({ format: "coreline-personal-v1", items: value }),
    ).length;
  for (const item of items) {
    if (
      batch.length &&
      (batch.length === 20 || bytes([...batch, item]) > 500 * 1024)
    ) {
      batches.push(batch);
      batch = [];
    }
    batch.push(item);
  }
  if (batch.length) batches.push(batch);
  return batches;
}

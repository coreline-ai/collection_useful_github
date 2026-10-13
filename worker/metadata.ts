import { AppError, classify } from "../personal/shared";
export async function metadata(raw: string) {
  const item = classify(raw);
  // No arbitrary URL fetches: bookmark registration cannot reach a private network.
  if (item.provider === "bookmark")
    return { ...item, title: new URL(item.url).hostname, description: "" };
  const endpoint =
    item.provider === "github"
      ? `https://api.github.com/repos/${new URL(item.url).pathname.slice(1)}`
      : `https://www.youtube.com/oembed?${new URLSearchParams({ url: item.url, format: "json" })}`;
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Coreline-Personal-Library",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok)
    throw new AppError(
      422,
      "공개 정보를 가져오지 못했습니다. 제목을 직접 입력해 저장할 수 있습니다.",
    );
  const data = (await response.json()) as Record<string, unknown>;
  return {
    ...item,
    title: String(data.full_name || data.title || item.url).slice(0, 180),
    description: String(data.description || data.author_name || "").slice(
      0,
      2000,
    ),
  };
}

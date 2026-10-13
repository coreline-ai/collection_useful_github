import { StrictMode, useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  classify,
  labels,
  validateBackup,
  importBatches,
  type Item,
  type ItemInput,
  type Provider,
} from "./shared";
import "./style.css";

type Listing = {
  items: Item[];
  total: number;
  categories: string[];
  stats: { provider: Provider; count: number }[];
  page: number;
};
type Me = { login: string; csrf: string; aiEnabled: false; maxItems: number };
const empty: ItemInput = {
  provider: "github",
  url: "",
  title: "",
  description: "",
  category: "기본",
  tags: [],
  notes: "",
  pinned: false,
};
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  if (response.status === 401) {
    location.href = "/";
    throw new Error("로그인이 만료되었습니다.");
  }
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(result.error || "요청을 처리하지 못했습니다.");
  return result;
}
const message = (e: unknown) =>
  e instanceof Error ? e.message : "처리하지 못했습니다.";
function App() {
  const [me, setMe] = useState<Me | null>(null),
    [listing, setListing] = useState<Listing | null>(null);
  const [provider, setProvider] = useState<Provider | "">(""),
    [category, setCategory] = useState(""),
    [trash, setTrash] = useState(false),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<{ item: Item | null } | null>(null),
    [draft, setDraft] = useState<ItemInput>(empty),
    [tags, setTags] = useState(""),
    [formError, setFormError] = useState("");
  const [theme, setTheme] = useState(
    () => localStorage.getItem("coreline-personal-theme") || "light",
  );
  const modal = useRef<HTMLDialogElement>(null),
    file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("coreline-personal-theme", theme);
  }, [theme]);
  useEffect(() => {
    api<Me>("/api/me")
      .then(setMe)
      .catch((e) => {
        setError(message(e));
        setLoading(false);
      });
  }, []);
  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(query);
      setPage(1);
    }, 250);
    return () => clearTimeout(timeout);
  }, [query]);
  useEffect(() => {
    if (!me) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      provider,
      category,
      q: search,
      page: String(page),
      trash: trash ? "1" : "0",
    });
    api<Listing>(`/api/items?${params}`, { signal: controller.signal })
      .then((data) => {
        setListing(data);
        if (data.total > 0 && page > Math.ceil(data.total / 12)) setPage(1);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [me, provider, category, search, page, trash, revision]);
  useEffect(() => {
    if (editor && !modal.current?.open) modal.current?.showModal();
    if (!editor) modal.current?.close();
  }, [editor]);
  const mutation = <T,>(path: string, method: string, data: unknown) =>
    api<T>(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": me?.csrf || "",
      },
      body: JSON.stringify(data),
    });
  const refresh = () => setRevision((v) => v + 1);
  function edit(item: Item | null) {
    setDraft(item ? { ...item } : { ...empty });
    setTags(item?.tags.join(", ") || "");
    setFormError("");
    setEditor({ item });
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      const data = {
        ...draft,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };
      await mutation(
        editor?.item ? `/api/items/${editor.item.id}` : "/api/items",
        editor?.item ? "PUT" : "POST",
        { ...data, version: editor?.item?.version },
      );
      setEditor(null);
      setNotice("DB에 저장했습니다.");
      refresh();
    } catch (e) {
      setFormError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function getMetadata() {
    setBusy(true);
    setFormError("");
    try {
      const normalized = classify(draft.url);
      setDraft((d) => ({ ...d, ...normalized }));
      const result = await api<
        Pick<ItemInput, "provider" | "url" | "title" | "description">
      >(`/api/metadata?${new URLSearchParams({ url: normalized.url })}`);
      setDraft((d) => ({ ...d, ...result }));
    } catch (e) {
      setFormError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function move(item: Item, restore = false) {
    setBusy(true);
    setError("");
    try {
      await mutation(
        `/api/items/${item.id}${restore ? "/restore" : ""}`,
        restore ? "POST" : "DELETE",
        { version: item.version },
      );
      setNotice(
        restore
          ? "자료를 복원했습니다."
          : "휴지통으로 이동했습니다. 언제든 복원할 수 있습니다.",
      );
      refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function exportItems() {
    setBusy(true);
    try {
      const data = await api("/api/export");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `coreline-library-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("백업 파일을 내보냈습니다. 휴지통 자료는 포함하지 않습니다.");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function importItems(selected: File | undefined) {
    if (!selected) return;
    setError("");
    setBusy(true);
    try {
      if (selected.size > 30 * 1024 * 1024)
        throw new Error("백업 파일은 30MB 이내로 선택해 주세요.");
      const parsed = JSON.parse(await selected.text());
      const items = validateBackup(parsed);
      if (
        !window.confirm(
          `${items.length}개 자료를 가져올까요? 기존 자료와 동일한 URL은 덮어쓰지 않습니다.`,
        )
      )
        return;
      let inserted = 0,
        skipped = 0;
      for (const batch of importBatches(items)) {
        const result = await mutation<{ inserted: number; skipped: number }>(
          "/api/import",
          "POST",
          { format: "coreline-personal-v1", items: batch },
        );
        inserted += result.inserted;
        skipped += result.skipped;
      }
      setNotice(
        `${inserted}개 가져옴 · ${skipped}개 중복 또는 저장 한도로 건너뜀`,
      );
    } catch (e) {
      setError(
        `${message(e)} 이미 가져온 항목은 유지되며, 다시 시도하면 중복 항목은 건너뜁니다.`,
      );
    } finally {
      setBusy(false);
      refresh();
      if (file.current) file.current.value = "";
    }
  }
  async function signOut() {
    try {
      await mutation("/auth/logout", "POST", {});
      location.href = "/";
    } catch (e) {
      setError(message(e));
    }
  }
  const count = (p: Provider) =>
    listing?.stats.find((s) => s.provider === p)?.count || 0;
  const total = listing?.stats.reduce((sum, s) => sum + s.count, 0) || 0;
  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Coreline 개인 자료함 홈">
          <span className="brand-mark">
            C<span>↗</span>
          </span>
          <span>
            Coreline<small>PERSONAL LIBRARY</small>
          </span>
        </a>
        <div className="header-actions">
          <span className="private-label">● 나만의 자료함</span>
          <button
            className="icon-button"
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            aria-label={theme === "light" ? "어두운 테마" : "밝은 테마"}
          >
            {theme === "light" ? "◐" : "☀"}
          </button>
          <button className="quiet" onClick={signOut}>
            로그아웃
          </button>
        </div>
      </header>
      <main>
        <div className="intro">
          <div>
            <div className="eyebrow">저장하고, 연결하고, 다시 발견하세요</div>
            <h1>나의 발견 모음</h1>
            <p>유용한 코드부터 다시 볼 영상까지. 좋은 자료를 한곳에.</p>
          </div>
          <button
            className="primary add-top"
            onClick={() => edit(null)}
            disabled={!me || busy}
          >
            ＋ 자료 등록
          </button>
        </div>
        <nav className="source-tabs" aria-label="자료 종류">
          {(
            [
              ["", "전체 자료"],
              ["github", "GitHub"],
              ["youtube", "YouTube"],
              ["bookmark", "북마크"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={!trash && provider === key ? "selected" : ""}
              onClick={() => {
                setProvider(key);
                setTrash(false);
                setPage(1);
              }}
            >
              {label}
              <span>{key ? count(key) : total}</span>
            </button>
          ))}
          <button
            className={`trash-tab ${trash ? "selected" : ""}`}
            onClick={() => {
              setTrash(true);
              setProvider("");
              setCategory("");
              setPage(1);
            }}
          >
            휴지통
          </button>
        </nav>
        <section className="toolbar" aria-label="자료 검색 및 백업">
          <div className="search">
            <span aria-hidden="true">⌕</span>
            <input
              aria-label="자료 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={80}
              placeholder="제목, 태그, 메모로 검색"
            />
            {query && (
              <button aria-label="검색 지우기" onClick={() => setQuery("")}>
                ×
              </button>
            )}
          </div>
          <select
            aria-label="카테고리 필터"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
          >
            <option value="">모든 카테고리</option>
            {listing?.categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <div className="backup-actions">
            <button onClick={exportItems} disabled={busy || !me}>
              ↓ 백업
            </button>
            <button
              onClick={() => file.current?.click()}
              disabled={busy || !me}
            >
              ↑ 가져오기
            </button>
            <input
              ref={file}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => void importItems(e.target.files?.[0])}
            />
          </div>
        </section>
        <div className="list-heading">
          <span>
            {trash ? "휴지통" : category || "모든 카테고리"}{" "}
            <strong>{listing?.total ?? 0}</strong>
            <small> {search && `“${search}” 검색 결과`}</small>
          </span>
          <button className="quiet" onClick={refresh} disabled={loading}>
            ↻ 새로고침
          </button>
        </div>
        {error && (
          <div className="alert error" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label="오류 닫기">
              ×
            </button>
          </div>
        )}
        {notice && (
          <div className="alert notice" role="status">
            {notice}
            <button onClick={() => setNotice("")} aria-label="알림 닫기">
              ×
            </button>
          </div>
        )}
        {loading ? (
          <div className="empty" role="status">
            <div className="empty-symbol">⋯</div>
            <h2>자료를 불러오는 중입니다</h2>
            <p>잠시만 기다려 주세요.</p>
          </div>
        ) : listing?.items.length ? (
          <section className="card-grid" aria-label="저장한 자료">
            {listing.items.map((item) => (
              <article className={`card ${item.provider}`} key={item.id}>
                <div className="card-top">
                  <span className="provider">
                    <span>
                      {item.provider === "github"
                        ? "⌘"
                        : item.provider === "youtube"
                          ? "▶"
                          : "↗"}
                    </span>
                    {labels[item.provider]}
                  </span>
                  <span className="category">{item.category}</span>
                </div>
                <h2>
                  <a href={item.url} target="_blank" rel="noopener noreferrer">
                    {item.title}
                  </a>
                </h2>
                <p className="description">
                  {item.description ||
                    "설명을 추가해 나중에 더 쉽게 찾아보세요."}
                </p>
                {item.notes && <p className="note-preview">✎ {item.notes}</p>}
                <div className="tags">
                  {item.tags.map((tag) => (
                    <button key={tag} onClick={() => setQuery(tag)}>
                      #{tag}
                    </button>
                  ))}
                </div>
                <div className="card-footer">
                  <span className="saved-date">
                    {item.pinned ? "◆ 고정 · " : ""}
                    {new Date(item.updated_at).toLocaleDateString("ko-KR")}
                  </span>
                  <div>
                    {trash ? (
                      <button onClick={() => move(item, true)} disabled={busy}>
                        복원
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => edit(item)}
                          disabled={busy}
                          aria-label={`${item.title} 수정`}
                        >
                          수정
                        </button>
                        <button
                          onClick={() => move(item)}
                          disabled={busy}
                          aria-label={`${item.title} 휴지통으로 이동`}
                        >
                          휴지통
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </section>
        ) : (
          !error && (
            <div className="empty">
              <div className="empty-symbol">{trash ? "↶" : "＋"}</div>
              <h2>
                {trash
                  ? "휴지통이 비어 있습니다"
                  : search
                    ? "검색 결과가 없습니다"
                    : "첫 번째 발견을 저장해 보세요"}
              </h2>
              <p>
                {trash
                  ? "삭제한 자료는 이곳에서 다시 복원할 수 있습니다."
                  : search
                    ? "다른 검색어나 카테고리로 찾아보세요."
                    : "GitHub 저장소, YouTube 영상, 웹사이트 주소를 등록할 수 있습니다."}
              </p>
              {!trash && !search && (
                <button className="primary" onClick={() => edit(null)}>
                  자료 등록하기
                </button>
              )}
            </div>
          )
        )}
        {listing && listing.total > 12 && (
          <nav className="pagination" aria-label="페이지">
            <button
              disabled={page === 1 || loading}
              onClick={() => setPage((p) => p - 1)}
            >
              이전
            </button>
            <span>
              {page} / {Math.ceil(listing.total / 12)}
            </span>
            <button
              disabled={page >= Math.ceil(listing.total / 12) || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              다음
            </button>
          </nav>
        )}
      </main>
      <footer className="footer">
        <span>
          <i /> {me ? `${me.login} 전용` : "인증 확인 중"} · Cloudflare D1 저장
        </span>
        <span>AI 기능 꺼짐 · 자료는 브라우저에 별도 보관하지 않습니다</span>
      </footer>
      <dialog
        ref={modal}
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else setEditor(null);
        }}
        aria-labelledby="editor-title"
      >
        <form onSubmit={save}>
          <div className="dialog-heading">
            <div>
              <small>PERSONAL COLLECTION</small>
              <h2 id="editor-title">
                {editor?.item ? "자료 수정" : "새 자료 등록"}
              </h2>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => setEditor(null)}
              disabled={busy}
              aria-label="창 닫기"
            >
              ×
            </button>
          </div>
          <p className="form-hint">
            공개 정보를 가져오거나 제목과 설명을 직접 입력하세요.
          </p>
          <label>
            주소
            <div className="url-input">
              <input
                autoFocus
                type="text"
                required
                maxLength={2048}
                value={draft.url}
                placeholder="https://github.com/owner/repo"
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              />
              <button
                type="button"
                onClick={getMetadata}
                disabled={busy || !draft.url}
              >
                정보 가져오기
              </button>
            </div>
          </label>
          <label>
            제목
            <input
              required
              maxLength={180}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label>
            설명
            <textarea
              rows={2}
              maxLength={2000}
              value={draft.description}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
            />
          </label>
          <div className="form-columns">
            <label>
              카테고리
              <input
                list="category-options"
                maxLength={40}
                value={draft.category}
                onChange={(e) =>
                  setDraft({ ...draft, category: e.target.value })
                }
              />
              <datalist id="category-options">
                <option value="기본" />
                {listing?.categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <label>
              태그 <small>쉼표로 구분 · 최대 10개</small>
              <input
                value={tags}
                maxLength={310}
                placeholder="개발, AI, 참고자료"
                onChange={(e) => setTags(e.target.value)}
              />
            </label>
          </div>
          <label>
            나만의 메모
            <textarea
              rows={4}
              maxLength={12000}
              placeholder="어떤 점이 유용했나요?"
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.pinned}
              onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })}
            />
            목록 상단에 고정
          </label>
          {formError && (
            <div className="alert error" role="alert">
              {formError}
            </div>
          )}
          <div className="dialog-footer">
            <button
              type="button"
              onClick={() => setEditor(null)}
              disabled={busy}
            >
              취소
            </button>
            <button className="primary" disabled={busy}>
              {busy ? "처리 중…" : "저장하기"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

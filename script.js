// DM UI (Instagram-ish) — data-driven renderer.
// Place `dm_messages.rich.json` next to index.html to render your real conversation.

const state = {
  me: "나",
  other: "상대",
  otherAvatar: "",
  meAvatar: "",
};

// Performance: render windowing
const INITIAL_RENDER = 600;
const LOAD_STEP = 600;
const CHUNK_SIZE = 120;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function nextFrame() {
  return new Promise(r => requestAnimationFrame(r));
}

function formatDay(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}년 ${m}월 ${day}일`;
}

function sameDay(a, b) {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

function renderDaySeparator(thread, label) {
  const sep = el("div", "day-sep");
  const sp = el("span", "", label);
  sep.appendChild(sp);
  thread.appendChild(sep);
}

function computeGroupFlags(msgs, i) {
  const cur = msgs[i];
  const prev = msgs[i - 1];
  const next = msgs[i + 1];

  // Instagram-like grouping: same sender, close in time, AND same calendar day
  const within = (a, b) => Math.abs(a - b) < 1000 * 60 * 30; // 30 minutes
  const samePrev = !!(prev && prev.sender === cur.sender && within(cur.ts, prev.ts) && sameDay(cur.ts, prev.ts));
  const sameNext = !!(next && next.sender === cur.sender && within(next.ts, cur.ts) && sameDay(next.ts, cur.ts));

  return { samePrev, sameNext };
}

// Fix Instagram-export mojibake (UTF-8 bytes that were saved as latin1 text)
function fixMojibakeText(s) {
  if (s == null) return s;
  if (typeof s !== "string") return s;

  // Heuristic: common mojibake markers for Korean exports
  if (!/[ÃÂìëêð�]/.test(s) && !/[\u0080-\u009f]/.test(s)) return s;

  try {
    // Convert the current codepoints to bytes (latin1), then decode as UTF-8
    const bytes = Uint8Array.from(s, ch => ch.charCodeAt(0) & 0xff);
    const fixed = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return fixed || s;
  } catch {
    return s;
  }
}

// Matches "Sent an attachment" style texts even when they include names/prefixes
function isGenericAttachmentText(t) {
  if (!t) return false;
  const s = String(t).trim();

  // Korean variants (with/without name)
  if (s.includes("첨부 파일") && s.includes("보냈")) return true;
  if (s.includes("사진") && s.includes("보냈")) return true;
  if (s.includes("동영상") && s.includes("보냈")) return true;

  // English variants
  const low = s.toLowerCase();
  if (low.includes("sent an attachment")) return true;
  if (low.includes("sent a photo")) return true;
  if (low.includes("sent a video")) return true;

  return (
    s === "동영상" ||
    s === "사진"
  );
}

// Filters out system/event noise messages that should NOT render as bubbles
function isSystemNoiseMessage(m) {
  const text = (fixMojibakeText(m.text) || "").trim();
  if (!text) return false;

  // If it contains real media/share, keep it
  const hasRich = (Array.isArray(m.attachments) && m.attachments.length) || (m.share && m.share.link);
  if (hasRich) return false;

  // Robust "reacted ... to your message" (emoji can be in-between)
  // Examples: "Reacted 😡 to your message", "reacted ❤️ to your message"
  if (/\breacted\b[\s\S]{0,40}\bto\b[\s\S]{0,60}\bmessage\b/i.test(text)) return true;

  const low = text.toLowerCase();

  // Common Instagram export events
  if (low.includes("liked a message")) return true;
  if (low.includes("unsent a message")) return true;

  // Korean-ish patterns
  if (text.includes("메시지에 반응")) return true;
  if (text.includes("메시지에 좋아요")) return true;
  if (text.includes("메시지를 취소")) return true;

  // Pure attachment placeholder should be hidden (we render media separately)
  if (isGenericAttachmentText(text)) return true;

  return false;
}

function normalizeLink(link) {
  if (!link) return link;
  let s = String(link).trim();
  if (!s) return s;
  if (s.startsWith("www.")) s = "https://" + s;
  return s;
}

function unwrapInstagramRedirect(link) {
  try {
    const u = new URL(link);
    // Instagram commonly uses l.instagram.com/?u=<encoded>&e=...
    if (u.hostname === "l.instagram.com" && u.searchParams.get("u")) {
      return decodeURIComponent(u.searchParams.get("u"));
    }
  } catch { }
  return link;
}

function guessShareKind(link) {
  if (!link) return "링크";
  const raw = normalizeLink(link);
  const unwrapped = unwrapInstagramRedirect(raw);
  const s = String(unwrapped);
  if (s.includes("/reel/")) return "릴스";
  if (s.includes("/p/")) return "게시물";
  if (s.includes("/stories/")) return "스토리";
  return "링크";
}

function renderAttachments(stack, senderClass, m) {
  const atts = Array.isArray(m.attachments) ? m.attachments : [];
  for (const a of atts) {
    if (!a || !a.type || !a.uri) continue;

    const bub = el("div", `bubble media ${senderClass}`);

    if (a.type === "photo") {
      const img = document.createElement("img");
      img.className = "mediaImg";
      img.loading = "lazy";
      img.alt = "";
      img.src = a.uri;
      bub.appendChild(img);
    } else if (a.type === "video") {
      const v = document.createElement("video");
      v.className = "mediaVideo";
      v.src = a.uri;
      v.controls = true;
      v.preload = "metadata";
      v.playsInline = true;
      bub.appendChild(v);
    } else if (a.type === "audio") {
      const au = document.createElement("audio");
      au.className = "mediaAudio";
      au.src = a.uri;
      au.controls = true;
      au.preload = "metadata";
      bub.appendChild(au);
    }

    const wrap = document.createElement("a");
    wrap.className = "mediaLink";
    wrap.href = a.uri;
    wrap.target = "_blank";
    wrap.rel = "noopener";
    wrap.appendChild(bub);

    stack.appendChild(wrap);
  }
}

function renderShareCard(stack, senderClass, m) {
  if (!m.share || !m.share.link) return;

  const rawLink = normalizeLink(m.share.link);
  const displayLink = unwrapInstagramRedirect(rawLink);
  const kind = guessShareKind(rawLink);
  const owner = (fixMojibakeText(m.share.owner) || "").trim();
  const txt = (fixMojibakeText(m.share.text) || "").trim();

  const a = document.createElement("a");
  a.className = `linkCard ${senderClass}`;
  a.href = rawLink;
  a.target = "_blank";
  a.rel = "noopener";

  // Minimal inline styling so it never looks like a transparent blank block
  // (your style.css can still override these)
  a.style.display = "block";
  a.style.textDecoration = "none";
  a.style.borderRadius = "18px";
  a.style.padding = "10px 12px";
  a.style.border = "1px solid rgba(0,0,0,.10)";
  a.style.background = "rgba(0,0,0,.04)";
  a.style.color = "#111";

  const top = el("div", "lcTop");
  top.appendChild(el("span", "lcKind", kind));
  if (owner) top.appendChild(el("span", "lcOwner", owner));

  const body = el("div", "lcBody");
  body.appendChild(el("div", "lcTitle", kind + (owner ? ` · ${owner}` : "")));
  body.appendChild(el("div", "lcDesc", txt || displayLink || rawLink));

  a.appendChild(top);
  a.appendChild(body);

  const wrap = el("div", `bubble card ${senderClass}`);
  // Ensure wrapper doesn't force white text on outgoing
  if (senderClass === "out") wrap.style.color = "#111";
  wrap.appendChild(a);
  stack.appendChild(wrap);
}

function fallbackAvatar(seed) {
  const bg = "#e9e9ee";
  const fg = "#6b6b74";
  const txt = (seed || "U").trim().slice(0, 1).toUpperCase();
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'>
    <rect width='64' height='64' rx='32' fill='${bg}'/>
    <text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle'
      font-family='-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial' font-size='28' fill='${fg}'>${txt}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// Render visible messages (chunked to avoid UI freezes)
// Render visible messages (chunked to avoid UI freezes)
async function renderThread(threadEl, msgsVisible, opts) {
  threadEl.innerHTML = "";

  let lastTs = null;
  for (let i = 0; i < msgsVisible.length; i += CHUNK_SIZE) {
    const frag = document.createDocumentFragment();
    const end = Math.min(msgsVisible.length, i + CHUNK_SIZE);

    for (let j = i; j < end; j++) {
      const m = msgsVisible[j];

      if (!lastTs || !sameDay(lastTs, m.ts)) {
        const sep = el("div", "day-sep");
        sep.appendChild(el("span", "", formatDay(m.ts)));
        frag.appendChild(sep);
      }
      lastTs = m.ts;

      const row = el("div", `row ${m.sender === "me" ? "out" : "in"}`);

      // avatar for incoming
      if (m.sender !== "me") {
        const av = el("div", "side-avatar");
        const img = document.createElement("img");
        img.alt = "";
        img.src = state.otherAvatar || fallbackAvatar(state.other);
        img.onerror = () => (img.src = fallbackAvatar(state.other));
        av.appendChild(img);

        const { sameNext } = computeGroupFlags(msgsVisible, j);
        if (sameNext) av.classList.add("hidden");
        row.appendChild(av);
      }

      const stack = el("div", "bubbleStack");

      // reply preview
      if (m.reply) {
        stack.appendChild(el("div", "replyLabel", fixMojibakeText(m.reply.fromLabel) || "회원님이 보낸 답장"));
        stack.appendChild(el("div", "replyPreview", fixMojibakeText(m.reply.text) || ""));
      }

      const senderClass = (m.sender === "me") ? "out" : "in";

      // 1) Media
      renderAttachments(stack, senderClass, m);

      // 2) Share card
      renderShareCard(stack, senderClass, m);

      // 3) Text bubble
      const hasRich = (Array.isArray(m.attachments) && m.attachments.length) || (m.share && m.share.link);
      const text = (fixMojibakeText(m.text) ?? "");
      if (text && !(hasRich && isGenericAttachmentText(text)) && !isSystemNoiseMessage(m)) {
        const bubble = el("div", `bubble ${senderClass}`);
        bubble.textContent = text;

        const { samePrev, sameNext } = computeGroupFlags(msgsVisible, j);
        if (senderClass === "out") {
          if (samePrev) bubble.classList.add("tight-top-out");
          if (sameNext) bubble.classList.add("tight-bottom-out");
        } else {
          if (samePrev) bubble.classList.add("tight-top-in");
          if (sameNext) bubble.classList.add("tight-bottom-in");
        }

        stack.appendChild(bubble);
      }

      // reactions pill (keep if it exists in data)
      if (Array.isArray(m.reactions) && m.reactions.length) {
        const rx = el("div", "reaction");

        const normalizeReactionEmoji = (e) => {
          const s = (e == null) ? "" : String(e);
          if (
            s === "♥" || s === "❤" || s === "🖤" || s === "💙" || s === "💚" ||
            s === "💛" || s === "💜" || s === "🤍" || s === "🤎" || s === "🩵" ||
            s === "🩶" || s === "🩷"
          ) return "❤️";
          if (/^❤\uFE0F?$/.test(s) || /^♥\uFE0F?$/.test(s)) return "❤️";
          return s;
        };

        const emojis = m.reactions
          .map(r => (r && r.emoji) ? normalizeReactionEmoji(r.emoji) : "")
          .filter(Boolean)
          .slice(0, 2);

        if (!emojis.length) emojis.push("❤️");
        rx.appendChild(document.createTextNode(emojis.join("")));

        const maxCount = m.reactions.reduce((acc, r) => {
          const c = (r && typeof r.count === "number") ? r.count : 1;
          return Math.max(acc, c);
        }, 1);
        if (maxCount > 1) {
          rx.appendChild(el("span", "cnt", String(maxCount)));
        }

        stack.appendChild(rx);
        stack.classList.add("has-reaction");
        row.classList.add("has-reaction");
      }

      row.appendChild(stack);
      frag.appendChild(row);

      const { sameNext: sn } = computeGroupFlags(msgsVisible, j);
      if (!sn) frag.appendChild(el("div", "spacer"));
    }

    threadEl.appendChild(frag);
    await nextFrame();
  }

  // ✅ 버튼을 "맨 아래"에 붙임 (다음 메시지)
  if (opts && opts.hasNext) {
    const wrap = el("div", "loadOlderWrap");
    const btn = el("button", "loadOlderBtn", "다음 메시지 불러오기");
    btn.type = "button";
    btn.addEventListener("click", () => {
      if (typeof opts.onLoadNext === "function") opts.onLoadNext();
    });
    wrap.appendChild(btn);
    threadEl.appendChild(wrap);
  }
}

/**
 * Message shape (rich normalized):
 * {
 *  sender: "설빈"|"이규민"|"me"|"other",
 *  ts: number (ms),
 *  text?: string,
 *  reply?: { fromLabel: string, text: string },
 *  attachments?: Array<{type:"photo"|"video"|"audio", uri:string}>,
 *  share?: { link:string, text?:string, owner?:string },
 *  reactions?: Array<{emoji:string, count?:number}>
 * }
 */
async function setConversation(messages, opts = {}) {
  const thread = document.getElementById("thread");

  state.me = opts.me ?? state.me;
  state.other = opts.other ?? state.other;
  state.otherAvatar = opts.otherAvatar ?? state.otherAvatar;
  state.meAvatar = opts.meAvatar ?? state.meAvatar;

  // header
  document.getElementById("chatName").textContent = opts.headerName ?? state.other;
  document.getElementById("chatStatus").textContent = opts.headerStatus ?? "";
  const chatAvatar = document.getElementById("chatAvatar");
  chatAvatar.src = state.otherAvatar || fallbackAvatar(state.other);
  chatAvatar.onerror = () => (chatAvatar.src = fallbackAvatar(state.other));

  // Normalize + fix mojibake + sort
  const all = (Array.isArray(messages) ? messages : []).map(m => {
    const sender = (m.sender === "me" || m.sender === state.me) ? "me" : "other";

    const text = fixMojibakeText(m.text);
    const reply = m.reply ? {
      fromLabel: fixMojibakeText(m.reply.fromLabel),
      text: fixMojibakeText(m.reply.text),
    } : undefined;

    const share = m.share ? {
      link: m.share.link,
      text: fixMojibakeText(m.share.text),
      owner: fixMojibakeText(m.share.owner),
    } : undefined;

    return { ...m, sender, text, reply, share };
  }).sort((a, b) => a.ts - b.ts);

  // Filter out noise rows entirely (reaction events etc.)
  const filtered = all.filter(m => !isSystemNoiseMessage(m));

  // Windowing state
  // Windowing state (✅ oldest-first + load NEXT/newer)
  const total = filtered.length;
  let end = Math.min(total, (opts.initialRender ?? INITIAL_RENDER));

  async function doRender(keepScroll = false) {
    const prevScrollTop = thread.scrollTop;

    const visible = filtered.slice(0, end);

    await renderThread(thread, visible, {
      hasNext: end < total,
      onLoadNext: async () => {
        const step = (opts.loadStep ?? LOAD_STEP);
        end = Math.min(total, end + step);
        await doRender(true);
      }
    });

    if (!keepScroll) {
      // ✅ 처음은 맨 위(가장 예전)에서 시작
      requestAnimationFrame(() => { thread.scrollTop = 0; });
    } else {
      // ✅ 다음 메시지 추가 시 화면 점프 최소화 (지금 위치 유지)
      requestAnimationFrame(() => { thread.scrollTop = prevScrollTop; });
    }
  }

  await doRender(false);
}

// Load DM JSON
async function loadNormalizedConversation() {
  try {
    const res = await fetch("./dm_messages.rich.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const msgs = (data && Array.isArray(data.messages)) ? data.messages : data;

    await setConversation(msgs, {
      me: "설빈",          // 우측(보낸 사람)
      other: "이규민",      // 좌측(받는 사람)
      headerName: "이규민",
      headerStatus: "최근 활동: 3시간 전",
      initialRender: INITIAL_RENDER,
      loadStep: LOAD_STEP,
      // otherAvatar: "profile.jpg"
    });
    return;
  } catch (e) {
    console.warn("Failed to load dm_messages.rich.json; falling back to demo.", e);
  }

  // Fallback demo conversation
  const demo = [
    { sender: "me", ts: Date.now() - 1000 * 60 * 60 * 5, text: "(데모) dm_messages.rich.json 파일을 index.html 옆에 두면 실제 대화가 로드돼요." },
    { sender: "other", ts: Date.now() - 1000 * 60 * 60 * 5 + 120000, text: "(데모) media/ 폴더도 같이 두면 사진/영상이 카드로 떠요." },
    { sender: "me", ts: Date.now() - 1000 * 60 * 60 * 5 + 240000, text: "(데모) 새로고침하면 끝!", reactions: [{ emoji: "👍" }] },
  ];

  await setConversation(demo, {
    me: "설빈",
    other: "이규민",
    headerName: "이규민",
    headerStatus: "최근 활동: 3시간 전",
  });
}

loadNormalizedConversation();

// Jump to latest button behavior
const thread = document.getElementById("thread");
const jumpBtn = document.getElementById("jumpBtn");

function updateJump() {
  const nearBottom = (thread.scrollHeight - thread.scrollTop - thread.clientHeight) < 80;
  jumpBtn.classList.toggle("show", !nearBottom);
}
thread.addEventListener("scroll", updateJump);
jumpBtn.addEventListener("click", () => { thread.scrollTop = thread.scrollHeight; });
updateJump();

// Expose for later JSON injection
window.setConversation = setConversation;

// MILA JEWELRY — Cloudflare Pages Functions uchun umumiy kod (bot va buyurtmalar).
//
// Cloudflare'da sozlanadigan narsalar (Workers & Pages → loyiha → Settings):
//   Variables and Secrets:
//     TG_TOKEN    — bot tokeni (Secret)
//     TG_CHAT_ID  — buyurtmalar guruhi ID, masalan -5530756719
//     PAY_CARD    — kartaga o'tkazma uchun karta raqami (ixtiyoriy)
//     PAY_NAME    — karta egasining ismi (ixtiyoriy)
//     SUPPORT     — yordam uchun Telegram username (ixtiyoriy, standart: milajewelry_kh)
//     PAY_ADMINS  — to'lovni tasdiqlay oladiganlar: username yoki ID, vergul bilan (ixtiyoriy;
//                   bo'sh bo'lsa guruhdagi har kim tasdiqlay oladi)
//   Bindings → D1 database:  nomi DB  (jadvallar avtomatik yaratiladi)

const clean = (v) => String(v || "").replace(/["'`\s]/g, "").replace(/^bot(?=\d)/i, "");

export function cfg(env) {
  return {
    token: clean(env.TG_TOKEN),
    chatId: clean(env.TG_CHAT_ID),
    card: String(env.PAY_CARD || "").trim(),
    cardName: String(env.PAY_NAME || "").trim(),
    support: String(env.SUPPORT || "milajewelry_kh").trim().replace(/^@/, ""),
    payAdmins: String(env.PAY_ADMINS || "").split(",").map((x) => x.trim().replace(/^@/, "").toLowerCase()).filter(Boolean),
  };
}

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 1), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

export async function tg(token, method, payload) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
    return await r.json();
  } catch (e) {
    return { ok: false, description: String(e) };
  }
}

/* ---------- kripto (Web Crypto) ---------- */
const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = (data) => crypto.subtle.digest("SHA-256", typeof data === "string" ? enc.encode(data) : data);
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey("raw", typeof key === "string" ? enc.encode(key) : key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(msg));
}
function safeEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
export const webhookSecret = async (token) => toHex(await sha256("mila-webhook:" + token)).slice(0, 48);

// Mijozning Telegram akkauntini tekshirish: Login Widget yoki Mini App imzosi
export async function verifyAuth(auth, token) {
  if (!auth || typeof auth !== "object") return null;
  const DAY = 86400;
  const now = Math.floor(Date.now() / 1000);
  if (auth.type === "widget" && auth.data && typeof auth.data === "object") {
    const { hash, ...rest } = auth.data;
    if (typeof hash !== "string") return null;
    const dcs = Object.keys(rest).sort().map((k) => `${k}=${rest[k]}`).join("\n");
    const check = toHex(await hmac(await sha256(token), dcs));
    if (!safeEq(check, hash) || now - Number(rest.auth_date) > DAY) return null;
    return { id: Number(rest.id), username: rest.username, first_name: rest.first_name, lang: "", via: "Login" };
  }
  if (auth.type === "webapp" && typeof auth.initData === "string" && auth.initData.length < 4096) {
    const params = new URLSearchParams(auth.initData);
    const hash = params.get("hash");
    if (!hash) return null;
    params.delete("hash");
    const dcs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("\n");
    const check = toHex(await hmac(await hmac("WebAppData", token), dcs));
    if (!safeEq(check, hash) || now - Number(params.get("auth_date")) > DAY) return null;
    let u = null;
    try { u = JSON.parse(params.get("user") || "null"); } catch {}
    if (!u?.id) return null;
    return { id: Number(u.id), username: u.username, first_name: u.first_name, lang: u.language_code || "", via: "Mini App" };
  }
  return null;
}

/* ---------- saqlash (Cloudflare D1) ---------- */
let ready = false;
async function db(env) {
  if (!env.DB) throw new Error("D1 bazasi ulanmagan (binding nomi: DB)");
  if (!ready) {
    await env.DB.batch([
      env.DB.prepare("CREATE TABLE IF NOT EXISTS orders (no INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, status TEXT, created INTEGER, data TEXT)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, lang TEXT)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, cat TEXT, name TEXT, price INTEGER, descr TEXT, file_id TEXT, fuid TEXT, created INTEGER, live INTEGER DEFAULT 0)"),
    ]);
    ready = true;
  }
  return env.DB;
}
export const pad = (n) => String(n).padStart(5, "0");
const unpack = (row) => (row ? { ...JSON.parse(row.data), no: pad(row.no), status: row.status } : null);

export async function createOrder(env, o) {
  const d = await db(env);
  const row = await d.prepare("INSERT INTO orders (user_id, status, created, data) VALUES (?, ?, ?, ?) RETURNING no")
    .bind(o.user?.id ?? null, o.status, Date.now(), JSON.stringify(o)).first();
  return pad(row.no);
}
export async function saveOrder(env, o) {
  const d = await db(env);
  const { no, ...rest } = o;
  await d.prepare("UPDATE orders SET status = ?, data = ? WHERE no = ?").bind(o.status, JSON.stringify(rest), Number(no)).run();
}
export async function getOrder(env, no) {
  const d = await db(env);
  return unpack(await d.prepare("SELECT * FROM orders WHERE no = ?").bind(Number(no)).first());
}
export async function userOrders(env, uid) {
  const d = await db(env);
  const { results } = await d.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY no DESC LIMIT 10").bind(Number(uid)).all();
  return (results || []).map(unpack);
}
export async function getLang(env, uid, fallback) {
  const d = await db(env);
  const row = await d.prepare("SELECT lang FROM users WHERE id = ?").bind(Number(uid)).first();
  if (row?.lang === "uz" || row?.lang === "ru") return row.lang;
  return fallback === "ru" ? "ru" : "uz";
}
export async function setLang(env, uid, l) {
  const d = await db(env);
  await d.prepare("INSERT INTO users (id, lang) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET lang = excluded.lang").bind(Number(uid), l).run();
}

/* ---------- holatlar va matnlar ---------- */
export const STATUSES = ["new", "confirmed", "shipped", "delivered", "cancelled"];
const ST = {
  uz: { new: "🆕 Yangi", confirmed: "✅ Tasdiqlandi", shipped: "🚚 Yoʻlda", delivered: "📦 Yetkazildi", cancelled: "❌ Bekor qilindi" },
  ru: { new: "🆕 Новый", confirmed: "✅ Подтверждён", shipped: "🚚 В пути", delivered: "📦 Доставлен", cancelled: "❌ Отменён" },
};
export const stLabel = (s, l = "uz") => (ST[l] || ST.uz)[s] || s;

const NOTIFY = {
  uz: {
    confirmed: "✅ Buyurtma №{no} tasdiqlandi! Tez orada yoʻlga chiqadi.",
    shipped: "🚚 Buyurtma №{no} yoʻlga chiqdi. Tez orada yetib boradi!",
    delivered: "📦 Buyurtma №{no} yetkazildi. Xaridingiz uchun rahmat! 💍\nFikringizni yozib qoldirsangiz, juda xursand boʻlamiz.",
    cancelled: "❌ Buyurtma №{no} bekor qilindi. Savollar boʻlsa, «💬 Yordam» tugmasini bosing.",
  },
  ru: {
    confirmed: "✅ Заказ №{no} подтверждён! Скоро отправим.",
    shipped: "🚚 Заказ №{no} в пути. Скоро будет у вас!",
    delivered: "📦 Заказ №{no} доставлен. Спасибо за покупку! 💍\nБудем рады вашему отзыву.",
    cancelled: "❌ Заказ №{no} отменён. Если есть вопросы, нажмите «💬 Помощь».",
  },
};
export const notifyText = (s, no, l = "uz") => ((NOTIFY[l] || NOTIFY.uz)[s] || "").replace("{no}", no);

export const PAY = {
  cod: { uz: "Qabul qilganda (naqd yoki karta)", ru: "При получении (наличные или карта)" },
  card: { uz: "Kartaga oʻtkazma", ru: "Перевод на карту" },
};

export function payInfo(c, l = "uz") {
  if (!c.card) return l === "ru" ? "💳 Оплата при получении — наличными или картой курьеру." : "💳 Toʻlov mahsulotni qabul qilganda — kuryerga naqd yoki karta orqali.";
  return l === "ru"
    ? `💳 Способы оплаты:\n• При получении — наличными или картой\n• Перевод на карту: ${c.card}${c.cardName ? "\n  Получатель: " + c.cardName : ""}\n\n🧾 После перевода отправьте фото чека прямо сюда, в этот чат.`
    : `💳 Toʻlov usullari:\n• Qabul qilganda — naqd yoki karta\n• Kartaga oʻtkazma: ${c.card}${c.cardName ? "\n  Qabul qiluvchi: " + c.cardName : ""}\n\n🧾 Oʻtkazmadan soʻng chek rasmini shu chatga yuboring.`;
}

export function customerText(o, c, l = "uz") {
  const ru = l === "ru";
  const lines = [ru ? `✅ Заказ №${o.no} принят — MILA JEWELRY` : `✅ Buyurtma №${o.no} qabul qilindi — MILA JEWELRY`, ""];
  (o.items || []).forEach((it, i) => lines.push(`${i + 1}. ${it.name}${it.variant ? " (" + it.variant + ")" : ""} — ${it.q} ${ru ? "шт." : "dona"}`));
  lines.push("");
  if (o.dl) lines.push(`🚚 ${o.dl}`);
  if (o.addr) lines.push(`📍 ${o.addr}`);
  lines.push(`💳 ${(PAY[o.pay] || PAY.cod)[ru ? "ru" : "uz"]}`);
  if (o.pay === "card" && c.card) {
    lines.push("", ru ? `Карта для перевода: ${c.card}${c.cardName ? " (" + c.cardName + ")" : ""}` : `Oʻtkazma uchun karta: ${c.card}${c.cardName ? " (" + c.cardName + ")" : ""}`);
    lines.push(ru ? "🧾 После оплаты отправьте фото чека прямо в этот чат." : "🧾 Toʻlovdan soʻng chek rasmini shu chatga yuboring.");
  }
  lines.push("", ru ? "Статус заказа: «🚚 Статус доставки»." : "Buyurtma holati: «🚚 Yetkazish holati» tugmasi.");
  return lines.join("\n");
}

/* ---------- guruh xabari ---------- */
export function groupText(o) {
  const hist = o.history?.length > 1 ? "\n🕓 " + o.history.map((h) => `${stLabel(h.s).split(" ")[0]} ${h.at}`).join(" → ") : "";
  const last = o.history?.[o.history.length - 1]?.by ? `\n👤 Oxirgi oʻzgarish: ${o.history[o.history.length - 1].by}` : "";
  const pay = o.paid === true ? `\n💳 Toʻlov: ✅ Tushdi${o.paidBy ? " (" + o.paidBy + ")" : ""}` : o.receipt ? "\n💳 Toʻlov: 🧾 Chek keldi, tekshirilmoqda" : "";
  return `${o.text}\n\n📌 Holat: ${stLabel(o.status)}${pay}${hist}${last}`;
}
export function groupKeyboard(o) {
  if (o.status === "delivered" || o.status === "cancelled") return { inline_keyboard: [] };
  const b = (s, t) => ({ text: t, callback_data: `st|${o.no}|${s}` });
  return {
    inline_keyboard: [
      [b("confirmed", "✅ Tasdiqlash"), b("shipped", "🚚 Yuborildi")],
      [b("delivered", "📦 Yetkazildi"), b("cancelled", "❌ Bekor qilish")],
    ],
  };
}
export const nowTash = () =>
  new Date().toLocaleString("ru-RU", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", "");

/* ---------- bot menyusi ---------- */
export const MENU = {
  uz: { orders: "🛒 Buyurtmalarim", status: "🚚 Yetkazish holati", pay: "💳 Toʻlov", help: "💬 Yordam", lang: "🌐 Til" },
  ru: { orders: "🛒 Мои заказы", status: "🚚 Статус доставки", pay: "💳 Оплата", help: "💬 Помощь", lang: "🌐 Язык" },
};
export function menuKeyboard(l = "uz") {
  const m = MENU[l] || MENU.uz;
  return { keyboard: [[{ text: m.orders }, { text: m.status }], [{ text: m.pay }, { text: m.help }], [{ text: m.lang }]], resize_keyboard: true, is_persistent: true };
}
export function menuAction(text) {
  for (const l of ["uz", "ru"]) for (const [k, v] of Object.entries(MENU[l])) if (text === v) return k;
  return null;
}

/* ---------- chek (to'lov) ---------- */
export function receiptKeyboard(no) {
  return { inline_keyboard: [[
    { text: "✅ Toʻlov tushdi", callback_data: `pay|${no}|ok` },
    { text: "❌ Tushmadi", callback_data: `pay|${no}|bad` },
  ]] };
}
export const canConfirmPay = (c, from) =>
  !c.payAdmins.length || c.payAdmins.includes(String(from.id)) || (from.username && c.payAdmins.includes(from.username.toLowerCase()));

/* ---------- mahsulotlar (mijoz o'zi bot orqali qo'shadi) ---------- */
export const CATS = { sirga: "Sirgʻalar", marjon: "Marjonlar", bilak: "Bilakuzuklar", uzuk: "Uzuklar" };
export const fmtPrice = (n) => String(Math.max(0, Math.round(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " soʻm";
export async function addProduct(env, p) {
  const d = await db(env);
  const row = await d.prepare("INSERT INTO products (cat, name, price, descr, file_id, fuid, created, live) VALUES (?, ?, ?, ?, ?, ?, ?, 0) RETURNING id")
    .bind(p.cat || "", p.name, p.price, p.descr || "", p.file_id, p.fuid || "", Date.now()).first();
  return row.id;
}
export async function getProduct(env, id) {
  const d = await db(env);
  return d.prepare("SELECT * FROM products WHERE id = ?").bind(Number(id)).first();
}
export async function updateProduct(env, id, f) {
  const d = await db(env);
  const keys = Object.keys(f).filter((k) => ["cat", "name", "price", "descr", "live"].includes(k));
  if (!keys.length) return;
  await d.prepare(`UPDATE products SET ${keys.map((k) => k + " = ?").join(", ")} WHERE id = ?`).bind(...keys.map((k) => f[k]), Number(id)).run();
}
export async function deleteProduct(env, id) {
  const d = await db(env);
  await d.prepare("DELETE FROM products WHERE id = ?").bind(Number(id)).run();
}
export async function listProducts(env, limit = 300) {
  const d = await db(env);
  const { results } = await d.prepare("SELECT * FROM products WHERE live = 1 ORDER BY id DESC LIMIT ?").bind(limit).all();
  return results || [];
}

// Mahsulot qo'sha oladiganlar: buyurtmalar guruhi (TG_CHAT_ID) a'zolari
const adminCache = new Map();
export async function isAdmin(c, uid) {
  if (!c.chatId || !uid) return false;
  const hit = adminCache.get(uid);
  if (hit && Date.now() - hit.t < 5 * 60 * 1000) return hit.ok;
  const r = await tg(c.token, "getChatMember", { chat_id: c.chatId, user_id: uid });
  const st = r.result?.status;
  const ok = !!r.ok && (st === "creator" || st === "administrator" || st === "member" || (st === "restricted" && r.result.is_member));
  adminCache.set(uid, { ok, t: Date.now() });
  return ok;
}
export const ADMIN_MENU = { list: "📦 Mahsulotlar", add: "➕ Mahsulot qoʻshish" };
export function adminKeyboard(l = "uz") {
  const k = menuKeyboard(l);
  return { ...k, keyboard: [[{ text: ADMIN_MENU.list }, { text: ADMIN_MENU.add }], ...k.keyboard] };
}

// MILA JEWELRY — bot va buyurtmalar uchun umumiy kod.
// Netlify o'zgaruvchilari (Project configuration → Environment variables):
//   TG_TOKEN    — bot tokeni (majburiy)
//   TG_CHAT_ID  — buyurtmalar tushadigan guruh ID (majburiy)
//   PAY_CARD    — kartaga o'tkazma uchun karta raqami (ixtiyoriy)
//   PAY_NAME    — karta egasining ismi (ixtiyoriy)
//   SUPPORT     — yordam uchun Telegram username, masalan milajewelry_kh (ixtiyoriy)

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

const clean = (v) => (v || "").replace(/["'`\s]/g, "").replace(/^bot(?=\d)/i, "");

export function env() {
  return {
    token: clean(process.env.TG_TOKEN),
    chatId: clean(process.env.TG_CHAT_ID),
    card: (process.env.PAY_CARD || "").trim(),
    cardName: (process.env.PAY_NAME || "").trim(),
    support: (process.env.SUPPORT || "milajewelry_kh").trim().replace(/^@/, ""),
  };
}

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

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

// webhook so'rovlari haqiqatan Telegram'dan kelganini tekshirish uchun maxfiy kalit
export const webhookSecret = (token) => createHash("sha256").update("mila-webhook:" + token).digest("hex").slice(0, 48);

/* ---------- Telegram akkauntini tekshirish ---------- */
const eqHex = (a, b) => {
  try { return a.length === b.length && timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); } catch { return false; }
};
export function verifyAuth(auth, token) {
  if (!auth || typeof auth !== "object") return null;
  const DAY = 86400;
  const now = Math.floor(Date.now() / 1000);
  if (auth.type === "widget" && auth.data && typeof auth.data === "object") {
    const { hash, ...rest } = auth.data;
    if (typeof hash !== "string") return null;
    const dcs = Object.keys(rest).sort().map((k) => `${k}=${rest[k]}`).join("\n");
    const secret = createHash("sha256").update(token).digest();
    const check = createHmac("sha256", secret).update(dcs).digest("hex");
    if (!eqHex(check, hash) || now - Number(rest.auth_date) > DAY) return null;
    return { id: Number(rest.id), username: rest.username, first_name: rest.first_name, lang: "", via: "Login" };
  }
  if (auth.type === "webapp" && typeof auth.initData === "string" && auth.initData.length < 4096) {
    const params = new URLSearchParams(auth.initData);
    const hash = params.get("hash");
    if (!hash) return null;
    params.delete("hash");
    const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
    const secret = createHmac("sha256", "WebAppData").update(token).digest();
    const check = createHmac("sha256", secret).update(dcs).digest("hex");
    if (!eqHex(check, hash) || now - Number(params.get("auth_date")) > DAY) return null;
    let u = null;
    try { u = JSON.parse(params.get("user") || "null"); } catch {}
    if (!u?.id) return null;
    return { id: Number(u.id), username: u.username, first_name: u.first_name, lang: u.language_code || "", via: "Mini App" };
  }
  return null;
}

/* ---------- saqlash (Netlify Blobs) ---------- */
const store = () => getStore({ name: "mila-shop", consistency: "strong" });
export const pad = (n) => String(n).padStart(5, "0");

export async function nextOrderNo() {
  const s = store();
  const cur = (await s.get("meta/counter", { type: "json" })) || { n: 0 };
  const n = (cur.n || 0) + 1;
  await s.setJSON("meta/counter", { n });
  return pad(n);
}
export const getOrder = (no) => store().get(`order/${no}`, { type: "json" });
export const saveOrder = (o) => store().setJSON(`order/${o.no}`, o);
export async function addUserOrder(uid, no) {
  const s = store();
  const list = (await s.get(`user/${uid}/orders`, { type: "json" })) || [];
  list.push(no);
  await s.setJSON(`user/${uid}/orders`, list.slice(-50));
}
export async function userOrders(uid) {
  const list = (await store().get(`user/${uid}/orders`, { type: "json" })) || [];
  const out = [];
  for (const no of list.slice(-10).reverse()) {
    const o = await getOrder(no);
    if (o) out.push(o);
  }
  return out;
}
export async function getLang(uid, fallback) {
  const v = await store().get(`user/${uid}/lang`);
  if (v === "uz" || v === "ru") return v;
  return fallback === "ru" ? "ru" : "uz";
}
export const setLang = (uid, l) => store().set(`user/${uid}/lang`, l);

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

export function payInfo(e, l = "uz") {
  if (!e.card) return l === "ru" ? "💳 Оплата при получении — наличными или картой курьеру." : "💳 Toʻlov mahsulotni qabul qilganda — kuryerga naqd yoki karta orqali.";
  return l === "ru"
    ? `💳 Способы оплаты:\n• При получении — наличными или картой\n• Перевод на карту: ${e.card}${e.cardName ? "\n  Получатель: " + e.cardName : ""}\n\nПосле перевода отправьте скриншот чека в «💬 Помощь».`
    : `💳 Toʻlov usullari:\n• Qabul qilganda — naqd yoki karta\n• Kartaga oʻtkazma: ${e.card}${e.cardName ? "\n  Qabul qiluvchi: " + e.cardName : ""}\n\nOʻtkazmadan soʻng chek skrinshotini «💬 Yordam» orqali yuboring.`;
}

export function customerText(o, e, l = "uz") {
  const ru = l === "ru";
  const lines = [ru ? `✅ Заказ №${o.no} принят — MILA JEWELRY` : `✅ Buyurtma №${o.no} qabul qilindi — MILA JEWELRY`, ""];
  (o.items || []).forEach((it, i) => lines.push(`${i + 1}. ${it.name}${it.variant ? " (" + it.variant + ")" : ""} — ${it.q} ${ru ? "шт." : "dona"}`));
  lines.push("");
  if (o.dl) lines.push(`🚚 ${o.dl}`);
  if (o.addr) lines.push(`📍 ${o.addr}`);
  lines.push(`💳 ${(PAY[o.pay] || PAY.cod)[ru ? "ru" : "uz"]}`);
  if (o.pay === "card" && e.card) {
    lines.push("", ru ? `Карта для перевода: ${e.card}${e.cardName ? " (" + e.cardName + ")" : ""}` : `Oʻtkazma uchun karta: ${e.card}${e.cardName ? " (" + e.cardName + ")" : ""}`);
    lines.push(ru ? "После оплаты отправьте скриншот чека в «💬 Помощь»." : "Toʻlovdan soʻng chek skrinshotini «💬 Yordam» orqali yuboring.");
  }
  lines.push("", ru ? "Статус заказа: «🚚 Статус доставки»." : "Buyurtma holati: «🚚 Yetkazish holati» tugmasi.");
  return lines.join("\n");
}

/* ---------- guruh xabari ---------- */
export function groupText(o) {
  return `${o.text}\n\n📌 Holat: ${stLabel(o.status)}${o.history?.length > 1 ? "\n🕓 " + o.history.map((h) => `${stLabel(h.s).split(" ")[0]} ${h.at}`).join(" → ") : ""}`;
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

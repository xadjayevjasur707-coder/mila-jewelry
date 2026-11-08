// Buyurtmani Telegram bot orqali MILA JEWELRY chatiga yuboradi.
// Netlify'da 2 ta o'zgaruvchi kerak (Project configuration → Environment variables):
//   TG_TOKEN   — @BotFather bergan bot tokeni
//   TG_CHAT_ID — buyurtmalar tushadigan chat yoki guruh ID raqami
// TG_CHAT_ID hali qo'yilmagan bo'lsa, shu manzilni brauzerda ochsangiz
// (/.netlify/functions/order) botga yozgan chatlar ro'yxati va ularning ID'si chiqadi.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const eqHex = (a, b) => {
  try { return a.length === b.length && timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); } catch { return false; }
};

// Mijozning Telegram akkauntini tekshirish: Login Widget yoki Mini App imzosi
function verifyAuth(auth, token) {
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
    return { id: rest.id, username: rest.username, first_name: rest.first_name, via: "Login" };
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
    return { id: u.id, username: u.username, first_name: u.first_name, via: "Mini App" };
  }
  return null;
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

export default async (req) => {
  // nusxa olishda qo'shilib qolgan bo'sh joy, qo'shtirnoq va "bot" so'zini tozalaymiz
  const clean = (v) => (v || "").replace(/["'`\s]/g, "").replace(/^bot(?=\d)/i, "");
  const token = clean(process.env.TG_TOKEN);
  const chatId = clean(process.env.TG_CHAT_ID);

  if (req.method === "GET") {
    if (!token) return json({ holat: "TG_TOKEN qo'yilmagan" }, 500);
    if (chatId) return json({ holat: "Sozlangan ✓" });
    const me = await (await fetch(`https://api.telegram.org/bot${token}/getMe`)).json();
    if (!me.ok) return json({ holat: "Token noto'g'ri", xato: me.description, tokenUzunligi: token.length, kerakliKorinish: "1234567890:AAH... (boshida raqamlar, keyin ikki nuqta, jami 45-46 belgi)", toGriShakl: /^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token) }, 500);
    const bot = "@" + me.result.username;
    let d = await (await fetch(`https://api.telegram.org/bot${token}/getUpdates`)).json();
    if (!d.ok && /webhook/i.test(d.description || "")) {
      await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);
      d = await (await fetch(`https://api.telegram.org/bot${token}/getUpdates`)).json();
    }
    if (!d.ok) return json({ bot, holat: "Telegram xatosi", xato: d.description }, 500);
    const chats = {};
    for (const u of d.result || []) {
      const c = (u.message || u.my_chat_member || u.channel_post || {}).chat;
      if (c) chats[c.id] = c.title || [c.first_name, c.last_name].filter(Boolean).join(" ") || c.username;
    }
    return json({
      bot,
      holat: Object.keys(chats).length
        ? "Quyidagi ID'lardan birini TG_CHAT_ID qilib qo'ying."
        : `Chat topilmadi. Telegramda ${bot} botini ochib /start yozing, keyin sahifani yangilang.`,
      chatlar: Object.entries(chats).map(([id, nomi]) => ({ id, nomi })),
    });
  }

  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!token || !chatId) return json({ error: "not_configured" }, 503);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (body?.hp) return json({ ok: true }); // bot-spam tuzog'i
  if (!text || text.length > 3500 || !text.startsWith("🛍 Yangi buyurtma")) {
    return json({ error: "bad_order" }, 400);
  }

  const who = verifyAuth(body?.auth, token);
  const fullText = who
    ? `${text}\n\n✅ Telegram tasdiqlangan (${who.via}): ${who.username ? "@" + who.username : who.first_name || ""} · ID ${who.id}`
    : text;

  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: fullText }),
  });
  if (!r.ok) return json({ error: "telegram" }, 502);

  // Toshkent uchun: Telegram'da xaritadagi aniq nuqta
  const g = body?.geo;
  if (g && Number.isFinite(g.lat) && Number.isFinite(g.lng) && Math.abs(g.lat) <= 90 && Math.abs(g.lng) <= 180) {
    const m = await r.json().catch(() => null);
    await fetch(`https://api.telegram.org/bot${token}/sendLocation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        latitude: g.lat,
        longitude: g.lng,
        ...(m?.result?.message_id ? { reply_parameters: { message_id: m.result.message_id } } : {}),
      }),
    }).catch(() => {});
  }
  // Mijozga tasdiq xabari (faqat imzosi tekshirilgan Telegram akkauntiga)
  const ctext = typeof body?.ctext === "string" ? body.ctext.trim() : "";
  if (who && ctext.startsWith("✅ Buyurtmangiz qabul qilindi") && ctext.length < 2000) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: who.id, text: ctext }),
    }).catch(() => {});
  }
  return json({ ok: true });
};

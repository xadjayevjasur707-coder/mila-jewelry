// Saytdan kelgan buyurtmani qabul qiladi: raqam beradi, saqlaydi, guruhga holat tugmalari bilan yuboradi,
// Telegram orqali tasdiqlangan mijozga esa tasdiq xabarini jo'natadi.
// Sozlash izohi: netlify/lib/shop.mjs faylining boshida.

import {
  env, json, tg, verifyAuth, nextOrderNo, saveOrder, addUserOrder, getLang, setLang,
  groupText, groupKeyboard, customerText, menuKeyboard, nowTash, PAY,
} from "../lib/shop.mjs";

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function cleanOrder(o) {
  const items = Array.isArray(o?.items) ? o.items.slice(0, 30) : [];
  return {
    items: items.map((it) => ({
      name: str(it?.name, 100),
      variant: str(it?.variant, 100),
      q: Math.min(99, Math.max(1, parseInt(it?.q, 10) || 1)),
      price: str(it?.price, 40),
    })).filter((it) => it.name),
    dl: str(o?.dl, 60),
    addr: str(o?.addr, 300),
    pay: o?.pay === "card" ? "card" : "cod",
  };
}

export default async (req) => {
  const e = env();

  if (req.method === "GET") {
    if (!e.token) return json({ holat: "TG_TOKEN qo'yilmagan" }, 500);
    if (e.chatId) return json({ holat: "Sozlangan ✓" });
    const me = await tg(e.token, "getMe");
    if (!me.ok) return json({ holat: "Token noto'g'ri", xato: me.description }, 500);
    const bot = "@" + me.result.username;
    const d = await tg(e.token, "getUpdates");
    if (!d.ok) return json({ bot, holat: "Telegram xatosi", xato: d.description }, 500);
    const chats = {};
    for (const u of d.result || []) {
      const c = (u.message || u.my_chat_member || u.channel_post || {}).chat;
      if (c) chats[c.id] = c.title || [c.first_name, c.last_name].filter(Boolean).join(" ") || c.username;
    }
    return json({
      bot,
      holat: Object.keys(chats).length ? "Quyidagi ID'lardan birini TG_CHAT_ID qilib qo'ying." : `Chat topilmadi. ${bot} botiga /start yozing.`,
      chatlar: Object.entries(chats).map(([id, nomi]) => ({ id, nomi })),
    });
  }

  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!e.token || !e.chatId) return json({ error: "not_configured" }, 503);

  let body;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (body?.hp) return json({ ok: true }); // bot-spam tuzog'i
  const text = str(body?.text, 3500);
  if (!text.startsWith("🛍 Yangi buyurtma")) return json({ error: "bad_order" }, 400);

  // buyurtma raqami (saqlash ishlamasa ham buyurtma yo'qolmasin)
  let no, stored = true;
  try { no = await nextOrderNo(); } catch { stored = false; no = "T" + Date.now().toString().slice(-6); }

  const who = verifyAuth(body?.auth, e.token);
  const ord = cleanOrder(body?.order);
  const at = nowTash();
  let gtext = text.replace(/^🛍 Yangi buyurtma[^\n]*/, `🛍 Buyurtma №${no} — MILA JEWELRY`);
  if (who) gtext += `\n\n✅ Telegram tasdiqlangan (${who.via}): ${who.username ? "@" + who.username : who.first_name || ""} · ID ${who.id}`;

  const o = {
    no, text: gtext, status: "new", history: [{ s: "new", at }], createdAt: Date.now(),
    user: who ? { id: who.id, username: who.username || "", first_name: who.first_name || "" } : null,
    ...ord,
  };

  const sent = await tg(e.token, "sendMessage", { chat_id: e.chatId, text: groupText(o), reply_markup: groupKeyboard(o) });
  if (!sent.ok) return json({ error: "telegram", xato: sent.description }, 502);
  o.groupMsgId = sent.result.message_id;

  // Toshkent uchun: xaritadagi aniq nuqta
  const g = body?.geo;
  if (g && Number.isFinite(g.lat) && Number.isFinite(g.lng) && Math.abs(g.lat) <= 90 && Math.abs(g.lng) <= 180) {
    await tg(e.token, "sendLocation", { chat_id: e.chatId, latitude: g.lat, longitude: g.lng, reply_parameters: { message_id: o.groupMsgId } });
  }

  if (stored) {
    try {
      await saveOrder(o);
      if (who) await addUserOrder(who.id, no);
    } catch { stored = false; }
  }

  // mijozga tasdiq (faqat imzosi tekshirilgan Telegram akkauntiga)
  if (who) {
    const l = await getLang(who.id, (who.lang || "").startsWith("ru") ? "ru" : "uz").catch(() => "uz");
    await setLang(who.id, l).catch(() => {}); // keyingi holat xabarlari shu tilda borsin
    await tg(e.token, "sendMessage", { chat_id: who.id, text: customerText(o, e, l), reply_markup: menuKeyboard(l) });
  }

  return json({
    ok: true,
    no,
    pay: o.pay === "card" && e.card ? { card: e.card, name: e.cardName } : null,
    payLabel: PAY[o.pay].uz,
  });
};

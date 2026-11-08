// POST /api/order — saytdan kelgan buyurtma: raqam beradi, D1'ga saqlaydi,
// guruhga holat tugmalari bilan yuboradi, Telegram orqali tasdiqlangan mijozga tasdiq jo'natadi.
// GET  /api/order — sozlash holatini tekshirish (TG_CHAT_ID bo'lmasa, botga yozgan chatlar ro'yxati).

import {
  cfg, json, tg, verifyAuth, createOrder, saveOrder, getLang, setLang,
  groupText, groupKeyboard, customerText, menuKeyboard, nowTash, PAY,
} from "../../lib/shop.js";

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

export async function onRequestGet({ env }) {
  const c = cfg(env);
  if (!c.token) return json({ holat: "TG_TOKEN qo'yilmagan" }, 500);
  const me = await tg(c.token, "getMe");
  if (!me.ok) return json({ holat: "Token noto'g'ri", xato: me.description }, 500);
  const bot = "@" + me.result.username;
  const dbOk = !!env.DB;
  if (c.chatId) return json({ holat: "Sozlangan ✓", bot, guruh: c.chatId, baza: dbOk ? "D1 ulangan ✓" : "D1 ulanmagan ✗ (binding nomi DB)", karta: c.card ? "bor ✓" : "yo'q" });
  const d = await tg(c.token, "getUpdates");
  if (!d.ok) return json({ bot, holat: "Telegram xatosi", xato: d.description }, 500);
  const chats = {};
  for (const u of d.result || []) {
    const ch = (u.message || u.my_chat_member || u.channel_post || {}).chat;
    if (ch) chats[ch.id] = ch.title || [ch.first_name, ch.last_name].filter(Boolean).join(" ") || ch.username;
  }
  return json({ bot, holat: "TG_CHAT_ID hali qo'yilmagan", chatlar: Object.entries(chats).map(([id, nomi]) => ({ id, nomi })) });
}

export async function onRequestPost({ request, env }) {
  const c = cfg(env);
  if (!c.token || !c.chatId) return json({ error: "not_configured" }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (body?.hp) return json({ ok: true }); // bot-spam tuzog'i
  const text = str(body?.text, 3500);
  if (!text.startsWith("🛍 Yangi buyurtma")) return json({ error: "bad_order" }, 400);

  const who = await verifyAuth(body?.auth, c.token);
  const ord = cleanOrder(body?.order);
  const o = {
    text, status: "new", history: [{ s: "new", at: nowTash() }],
    user: who ? { id: who.id, username: who.username || "", first_name: who.first_name || "" } : null,
    ...ord,
  };

  // raqam (baza ishlamasa ham buyurtma yo'qolmasin)
  let stored = true;
  try { o.no = await createOrder(env, o); } catch (e) { console.error(e); stored = false; o.no = "T" + String(Date.now()).slice(-6); }

  o.text = text.replace(/^🛍 Yangi buyurtma[^\n]*/, `🛍 Buyurtma №${o.no} — MILA JEWELRY`);
  if (who) o.text += `\n\n✅ Telegram tasdiqlangan (${who.via}): ${who.username ? "@" + who.username : who.first_name || ""} · ID ${who.id}`;

  const sent = await tg(c.token, "sendMessage", {
    chat_id: c.chatId, text: groupText(o), reply_markup: stored ? groupKeyboard(o) : undefined,
  });
  if (!sent.ok) return json({ error: "telegram", xato: sent.description }, 502);
  o.groupMsgId = sent.result.message_id;

  const g = body?.geo;
  if (g && Number.isFinite(g.lat) && Number.isFinite(g.lng) && Math.abs(g.lat) <= 90 && Math.abs(g.lng) <= 180) {
    await tg(c.token, "sendLocation", { chat_id: c.chatId, latitude: g.lat, longitude: g.lng, reply_parameters: { message_id: o.groupMsgId } });
  }

  if (stored) { try { await saveOrder(env, o); } catch (e) { console.error(e); } }

  if (who) {
    let l = (who.lang || "").startsWith("ru") ? "ru" : "uz";
    try { l = await getLang(env, who.id, l); await setLang(env, who.id, l); } catch {}
    await tg(c.token, "sendMessage", { chat_id: who.id, text: customerText(o, c, l), reply_markup: menuKeyboard(l) });
  }

  return json({ ok: true, no: o.no, pay: o.pay === "card" && c.card ? { card: c.card, name: c.cardName } : null, payLabel: PAY[o.pay].uz });
}

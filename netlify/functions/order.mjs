// Buyurtmani Telegram bot orqali MILA JEWELRY chatiga yuboradi.
// Netlify'da 2 ta o'zgaruvchi kerak (Project configuration → Environment variables):
//   TG_TOKEN   — @BotFather bergan bot tokeni
//   TG_CHAT_ID — buyurtmalar tushadigan chat yoki guruh ID raqami
// TG_CHAT_ID hali qo'yilmagan bo'lsa, shu manzilni brauzerda ochsangiz
// (/.netlify/functions/order) botga yozgan chatlar ro'yxati va ularning ID'si chiqadi.

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
    if (!me.ok) return json({ holat: "Token noto'g'ri", xato: me.description, tokenUzunligi: token.length, kerakliKorinish: "1234567890:AAH... (raqamlar, ikki nuqta, 35 ta belgi)", toGriShakl: /^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token) }, 500);
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

  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!r.ok) return json({ error: "telegram" }, 502);
  return json({ ok: true });
};

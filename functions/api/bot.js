// /api/bot — Telegram bot webhook: mijoz menyusi va guruhdagi buyurtma holati tugmalari.
// Bir martalik sozlash: brauzerda /api/bot?setup=1 sahifasini oching.

import {
  cfg, json, tg, webhookSecret, getOrder, saveOrder, userOrders, getLang, setLang,
  STATUSES, stLabel, notifyText, payInfo, groupText, groupKeyboard, menuKeyboard, menuAction, nowTash,
  receiptKeyboard, canConfirmPay,
} from "../../lib/shop.js";

const T = {
  uz: {
    hi: (n) => `Assalomu alaykum${n ? ", " + n : ""}! 💍\nMILA JEWELRY doʻkoniga xush kelibsiz.\n\n🛍 Katalogni ochish uchun pastdagi «Doʻkon» tugmasini bosing.\nBuyurtmalaringiz va ularning holati — «🛒 Buyurtmalarim» tugmasida.`,
    none: "Sizda hali buyurtma yoʻq. 🛍 «Doʻkon» tugmasini bosib, birinchisini tanlang!",
    list: "🛒 Soʻnggi buyurtmalaringiz:",
    pcs: "dona",
    last: (o) => `🚚 Oxirgi buyurtma №${o.no}\nHolati: ${stLabel(o.status, "uz")}`,
    help: (s) => `💬 Savolingiz boʻlsa, operatorimizga yozing: @${s}\n\n🧾 Toʻlov chekini esa shu chatga rasm qilib yuboring.`,
    pick: "Tilni tanlang:",
    set: "✅ Til oʻzgartirildi.",
    unknown: "Pastdagi menyudan foydalaning yoki «🛍 Doʻkon» tugmasini bosing.",
    rcvOk: (no) => `🧾 Chek qabul qilindi — buyurtma №${no}.\nToʻlov tekshirilgach, sizga xabar beramiz.`,
    rcvNone: "Chekni biriktiradigan buyurtma topilmadi. Avval 🛍 «Doʻkon» orqali buyurtma bering.",
    paidOk: (no) => `✅ Buyurtma №${no} uchun toʻlovingiz qabul qilindi. Rahmat! 💍`,
    paidBad: (no) => `❌ Buyurtma №${no} boʻyicha toʻlov hali tushmagan koʻrinadi. Iltimos, chekni tekshirib qayta yuboring yoki «💬 Yordam» orqali yozing.`,
  },
  ru: {
    hi: (n) => `Здравствуйте${n ? ", " + n : ""}! 💍\nДобро пожаловать в MILA JEWELRY.\n\n🛍 Чтобы открыть каталог, нажмите кнопку «Doʻkon» внизу.\nВаши заказы и их статус — в «🛒 Мои заказы».`,
    none: "У вас пока нет заказов. Нажмите 🛍 «Doʻkon» и выберите первый!",
    list: "🛒 Ваши последние заказы:",
    pcs: "шт.",
    last: (o) => `🚚 Последний заказ №${o.no}\nСтатус: ${stLabel(o.status, "ru")}`,
    help: (s) => `💬 Если есть вопросы, напишите оператору: @${s}\n\n🧾 Чек об оплате отправьте фото прямо в этот чат.`,
    pick: "Выберите язык:",
    set: "✅ Язык изменён.",
    unknown: "Пользуйтесь меню внизу или нажмите «🛍 Doʻkon».",
    rcvOk: (no) => `🧾 Чек получен — заказ №${no}.\nМы сообщим, как только проверим оплату.`,
    rcvNone: "Не найден заказ для этого чека. Сначала оформите заказ через 🛍 «Doʻkon».",
    paidOk: (no) => `✅ Оплата по заказу №${no} получена. Спасибо! 💍`,
    paidBad: (no) => `❌ Оплата по заказу №${no} пока не поступила. Проверьте чек и отправьте снова или напишите в «💬 Помощь».`,
  },
};

export async function onRequestGet({ request, env }) {
  const c = cfg(env);
  if (!c.token) return json({ holat: "TG_TOKEN qo'yilmagan" }, 500);
  const url = new URL(request.url);
  if (url.searchParams.get("setup") !== "1") return json({ holat: "Bot ishlayapti. Sozlash uchun ?setup=1" });
  const r = await tg(c.token, "setWebhook", {
    url: `${url.origin}/api/bot`, secret_token: await webhookSecret(c.token),
    allowed_updates: ["message", "callback_query"], drop_pending_updates: true,
  });
  await tg(c.token, "setMyCommands", { commands: [{ command: "start", description: "Bosh menyu" }] });
  await tg(c.token, "setMyCommands", { commands: [{ command: "start", description: "Главное меню" }], language_code: "ru" });
  const info = await tg(c.token, "getWebhookInfo");
  return json({ holat: r.ok ? "✅ Bot ulandi" : "❌ Xato", xato: r.ok ? undefined : r.description, webhook: info.result?.url, baza: env.DB ? "D1 ulangan ✓" : "D1 ulanmagan ✗" });
}

export async function onRequestPost({ request, env }) {
  const c = cfg(env);
  if (!c.token) return json({ ok: false }, 500);
  if (request.headers.get("x-telegram-bot-api-secret-token") !== (await webhookSecret(c.token))) return json({ error: "forbidden" }, 403);
  let u;
  try { u = await request.json(); } catch { return json({ ok: true }); }
  try {
    if (u.callback_query) await onCallback(u.callback_query, c, env);
    else if (u.message?.chat?.type === "private") await onMessage(u.message, c, env);
  } catch (err) {
    console.error(err);
  }
  return json({ ok: true }); // Telegram qayta yubormasligi uchun doim 200
}

async function onMessage(m, c, env) {
  const uid = m.from.id;
  const l = await getLang(env, uid, (m.from.language_code || "").startsWith("ru") ? "ru" : "uz");
  const t = T[l];
  const text = (m.text || "").trim();
  const send = (txt, extra = {}) => tg(c.token, "sendMessage", { chat_id: uid, text: txt, reply_markup: menuKeyboard(l), ...extra });

  if (text.startsWith("/start")) return send(t.hi(m.from.first_name));

  // 🧾 chek: rasm yoki fayl (PDF) — oxirgi to'lanmagan buyurtmaga biriktiriladi
  if (m.photo || (m.document && /^(image\/|application\/pdf)/.test(m.document.mime_type || ""))) {
    const list = await userOrders(env, uid);
    const o = list.find((x) => x.paid !== true && x.status !== "cancelled");
    if (!o) return send(t.rcvNone);
    const who = m.from.username ? "@" + m.from.username : m.from.first_name || "";
    const cp = await tg(c.token, "copyMessage", {
      chat_id: c.chatId, from_chat_id: uid, message_id: m.message_id,
      caption: `🧾 Toʻlov cheki — buyurtma №${o.no}\n👤 ${who} · ID ${uid}\n💳 ${o.pay === "card" ? "Kartaga oʻtkazma" : "Qabul qilganda"}\n\nPul tushganini tekshirib, tugmani bosing.`,
      reply_markup: receiptKeyboard(o.no),
      reply_parameters: o.groupMsgId ? { message_id: o.groupMsgId, allow_sending_without_reply: true } : undefined,
    });
    if (!cp.ok) return send(t.rcvNone);
    o.receipt = { at: nowTash(), msgId: cp.result?.message_id };
    await saveOrder(env, o);
    if (o.groupMsgId) await tg(c.token, "editMessageText", { chat_id: c.chatId, message_id: o.groupMsgId, text: groupText(o), reply_markup: groupKeyboard(o) });
    return send(t.rcvOk(o.no));
  }

  switch (menuAction(text)) {
    case "orders": {
      const list = await userOrders(env, uid);
      if (!list.length) return send(t.none);
      const lines = list.map((o) => {
        const n = (o.items || []).reduce((s, it) => s + (it.q || 1), 0);
        return `№${o.no} · ${n} ${t.pcs} · ${stLabel(o.status, l)}\n   ${(o.items || []).map((it) => it.name).join(", ").slice(0, 120)}`;
      });
      return send(`${t.list}\n\n${lines.join("\n\n")}`);
    }
    case "status": {
      const [o] = await userOrders(env, uid);
      if (!o) return send(t.none);
      const flow = ["new", "confirmed", "shipped", "delivered"];
      const idx = flow.indexOf(o.status);
      const bar = o.status === "cancelled" ? stLabel("cancelled", l) : flow.map((s, i) => (i <= idx ? "●" : "○") + " " + stLabel(s, l)).join("\n");
      return send(`${t.last(o)}\n\n${bar}`);
    }
    case "pay":
      return send(payInfo(c, l));
    case "help":
      return send(t.help(c.support), { reply_markup: { inline_keyboard: [[{ text: l === "ru" ? "✍️ Написать оператору" : "✍️ Operatorga yozish", url: `https://t.me/${c.support}` }]] } });
    case "lang":
      return tg(c.token, "sendMessage", {
        chat_id: uid, text: t.pick,
        reply_markup: { inline_keyboard: [[{ text: "🇺🇿 Oʻzbekcha", callback_data: "lang|uz" }, { text: "🇷🇺 Русский", callback_data: "lang|ru" }]] },
      });
    default:
      return send(t.unknown);
  }
}

async function onCallback(q, c, env) {
  const [kind, a, b] = String(q.data || "").split("|");
  const answer = (text) => tg(c.token, "answerCallbackQuery", { callback_query_id: q.id, text });

  if (kind === "lang" && (a === "uz" || a === "ru")) {
    await setLang(env, q.from.id, a);
    await answer(T[a].set);
    return tg(c.token, "sendMessage", { chat_id: q.from.id, text: T[a].set, reply_markup: menuKeyboard(a) });
  }

  if (kind === "pay") {
    if (String(q.message?.chat?.id) !== String(c.chatId)) return answer("⛔");
    if (!canConfirmPay(c, q.from)) return answer(`⛔ Faqat toʻlovga masʼul xodim tasdiqlaydi. Sizning ID: ${q.from.id}`);
    const o = await getOrder(env, a);
    if (!o) return answer("Buyurtma topilmadi");
    const by = q.from.username ? "@" + q.from.username : q.from.first_name;
    const ok = b === "ok";
    if (ok) { o.paid = true; o.paidBy = by; o.paidAt = nowTash(); } else { o.paid = false; o.receipt = null; }
    await saveOrder(env, o);
    await tg(c.token, "editMessageCaption", {
      chat_id: q.message.chat.id, message_id: q.message.message_id,
      caption: `${(q.message.caption || "").split("\n\n")[0]}\n\n${ok ? "✅ Toʻlov tushdi" : "❌ Toʻlov tushmagan"} — ${by}, ${nowTash()}`,
      reply_markup: { inline_keyboard: [] },
    });
    if (o.groupMsgId) await tg(c.token, "editMessageText", { chat_id: c.chatId, message_id: o.groupMsgId, text: groupText(o), reply_markup: groupKeyboard(o) });
    let note = "";
    if (o.user?.id) {
      const l = await getLang(env, o.user.id, "uz");
      const r = await tg(c.token, "sendMessage", { chat_id: o.user.id, text: ok ? T[l].paidOk(o.no) : T[l].paidBad(o.no), reply_markup: menuKeyboard(l) });
      note = r.ok ? " · mijozga xabar yuborildi" : "";
    }
    return answer((ok ? "✅ Toʻlov tasdiqlandi" : "❌ Belgilandi") + note);
  }

  if (kind === "st") {
    if (String(q.message?.chat?.id) !== String(c.chatId)) return answer("⛔"); // faqat buyurtmalar guruhida
    if (!STATUSES.includes(b)) return answer("?");
    const o = await getOrder(env, a);
    if (!o) return answer("Buyurtma topilmadi");
    if (o.status === b) return answer("Holat allaqachon shunday");
    const by = q.from.username ? "@" + q.from.username : q.from.first_name;
    o.status = b;
    (o.history ||= []).push({ s: b, at: nowTash(), by });
    await saveOrder(env, o);
    await tg(c.token, "editMessageText", {
      chat_id: q.message.chat.id, message_id: q.message.message_id, text: groupText(o), reply_markup: groupKeyboard(o),
    });
    let note;
    if (o.user?.id) {
      const l = await getLang(env, o.user.id, "uz");
      const r = await tg(c.token, "sendMessage", { chat_id: o.user.id, text: notifyText(b, o.no, l), reply_markup: menuKeyboard(l) });
      note = r.ok ? " · mijozga xabar yuborildi" : " · mijozga yuborib boʻlmadi";
    } else note = " · mijoz Telegram orqali kirmagan, oʻzingiz bogʻlaning";
    return answer(`${stLabel(b)}${note}`);
  }
  return answer("");
}

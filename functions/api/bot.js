// /api/bot — Telegram bot webhook: mijoz menyusi va guruhdagi buyurtma holati tugmalari.
// Bir martalik sozlash: brauzerda /api/bot?setup=1 sahifasini oching.

import {
  cfg, json, tg, webhookSecret, getOrder, saveOrder, userOrders, getLang, setLang,
  STATUSES, stLabel, notifyText, payInfo, groupText, groupKeyboard, menuKeyboard, menuAction, nowTash,
  receiptKeyboard, canConfirmPay,
  CATS, fmtPrice, addProduct, getProduct, updateProduct, deleteProduct, listProducts, isAdmin, addAdmin, memberStatus, ADMIN_MENU, adminKeyboard,
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
  // Do'kon tugmasi doim shu saytni ochsin
  const mb = await tg(c.token, "setChatMenuButton", { menu_button: { type: "web_app", text: "🛍 Doʻkon", web_app: { url: url.origin + "/" } } });
  const info = await tg(c.token, "getWebhookInfo");
  return json({ holat: r.ok ? "✅ Bot ulandi" : "❌ Xato", xato: r.ok ? undefined : r.description, webhook: info.result?.url, dokon_tugmasi: mb.ok ? url.origin + " ✓" : mb.description, baza: env.DB ? "D1 ulangan ✓" : "D1 ulanmagan ✗" });
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
    else if (u.message && String(u.message.chat?.id) === String(c.chatId)) await onGroupMessage(u.message, c, env);
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
  const admin = await isAdmin(c, uid, env).catch(() => false);
  const send = (txt, extra = {}) => tg(c.token, "sendMessage", { chat_id: uid, text: txt, reply_markup: admin ? adminKeyboard(l) : menuKeyboard(l), ...extra });

  if (/^\/admin\b/.test(text)) {
    if (admin) return send("✅ Siz doʻkon xodimisiz. «➕ Mahsulot qoʻshish» tugmasini bosing.");
    const st = await memberStatus(c, uid).catch(() => "?");
    return send(`⛔ Siz hali doʻkon xodimi emassiz (guruhdagi holatingiz: ${st}).\n\nXodim boʻlish uchun buyurtmalar keladigan Telegram guruhiga kiring va oʻsha yerda /admin deb yozing. Keyin shu yerda /start bosing.`);
  }
  if (text.startsWith("/start")) return send(t.hi(m.from.first_name) + (admin ? "\n\n🛠 Siz doʻkon xodimisiz: mahsulot qoʻshish uchun «➕ Mahsulot qoʻshish» tugmasini bosing." : ""));
  if (admin) {
    const done = await onAdmin(m, c, env, send);
    if (done !== undefined) return done;
  }

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

  if (/^p[cvsptnkdy]$/.test(kind) && kind !== "pay") {
    if (!(await isAdmin(c, q.from.id, env))) return answer("⛔ Faqat doʻkon xodimlari uchun");
    return onProductCallback(q, kind, a, b, c, env, answer);
  }

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

/* ================= mahsulotlar: mijoz (do'kon xodimi) bot orqali qo'shadi ================= */

const ADD_HELP = `➕ Yangi mahsulot qoʻshish

1️⃣ Mahsulot rasmini shu chatga yuboring
2️⃣ Rasmning izohiga (podpis) yozing:
   • 1-qator — nomi
   • 2-qator — narxi (faqat raqam)
   • keyingi qatorlar — tavsif (ixtiyoriy)

Masalan:
Tomchi shaklidagi sirgʻa
120000
Yengil, har kunga mos

3️⃣ Boʻlimni tanlang — mahsulot darrov saytda chiqadi ✅

📦 Qoʻshilganlarni oʻzgartirish yoki oʻchirish — «📦 Mahsulotlar» tugmasida.`;

function parseCaption(cap) {
  const lines = String(cap || "").split("\n").map((x) => x.trim()).filter(Boolean);
  let price = null;
  const rest = [];
  for (const ln of lines) {
    if (price === null && /\d/.test(ln) && /^[\d\s.,]+(so['ʻ’`‘]?m|sum|сум|uzs)?\.?$/i.test(ln)) price = parseInt(ln.replace(/\D/g, ""), 10);
    else rest.push(ln);
  }
  return { name: (rest[0] || "").slice(0, 100), descr: rest.slice(1).join("\n").slice(0, 500), price };
}

const catKeyboard = (id) => ({
  inline_keyboard: [
    [{ text: "💎 " + CATS.sirga, callback_data: `pc|${id}|sirga` }, { text: "📿 " + CATS.marjon, callback_data: `pc|${id}|marjon` }],
    [{ text: "⭕ " + CATS.bilak, callback_data: `pc|${id}|bilak` }, { text: "💍 " + CATS.uzuk, callback_data: `pc|${id}|uzuk` }],
    [{ text: "❌ Bekor qilish", callback_data: `pc|${id}|x` }],
  ],
});
const cardText = (p) =>
  `${p.live ? "✅ Saytda" : "⏳ Hali saytda emas"}\n\n💍 ${p.name}\n💰 ${fmtPrice(p.price)}\n📂 ${CATS[p.cat] || "—"}${p.descr ? "\n📝 " + p.descr : ""}\n\n🆔 ${p.id}`;
const cardKeyboard = (id) => ({
  inline_keyboard: [
    [{ text: "💰 Narx", callback_data: `pp|${id}` }, { text: "✏️ Nomi", callback_data: `pn|${id}` }],
    [{ text: "📝 Tavsif", callback_data: `pt|${id}` }, { text: "📂 Boʻlim", callback_data: `pk|${id}` }],
    [{ text: "🗑 Oʻchirish", callback_data: `pd|${id}` }],
  ],
});
const ASK = {
  price: (p) => `💰 «${p.name}» uchun yangi narxni yozing (faqat raqam, masalan 120000)`,
  name: (p) => `✏️ «${p.name}» uchun yangi nomni yozing`,
  descr: (p) => `📝 «${p.name}» uchun tavsif yozing (oʻchirish uchun «-» yuboring)`,
};

async function sendCard(c, chatId, p) {
  return tg(c.token, "sendPhoto", { chat_id: chatId, photo: p.file_id, caption: cardText(p), reply_markup: cardKeyboard(p.id) });
}

// undefined qaytarsa — oddiy mijoz menyusi davom etadi
async function onAdmin(m, c, env, send) {
  const text = (m.text || "").trim();

  if (text === ADMIN_MENU.add) return send(ADD_HELP);

  if (text === ADMIN_MENU.list) {
    const list = await listProducts(env, 60);
    if (!list.length) return send("Saytda hali mahsulot yoʻq.\n\n" + ADD_HELP);
    return send(`📦 Saytda ${list.length} ta mahsulot. Oʻzgartirish uchun tanlang:`, {
      reply_markup: { inline_keyboard: list.map((p) => [{ text: `${p.name} — ${fmtPrice(p.price)}`.slice(0, 60), callback_data: `pv|${p.id}` }]) },
    });
  }

  // narx / nom / tavsifni o'zgartirish so'roviga javob
  const rq = m.reply_to_message;
  if (rq?.from?.is_bot && text) {
    const idm = /🆔 (\d+)\s*$/.exec(rq.text || "");
    const kind = (rq.text || "").startsWith("💰") ? "price" : (rq.text || "").startsWith("✏️") ? "name" : (rq.text || "").startsWith("📝") ? "descr" : null;
    if (idm && kind) {
      const p = await getProduct(env, idm[1]);
      if (!p) return send("Bu mahsulot topilmadi (oʻchirilgan boʻlishi mumkin).");
      if (kind === "price") {
        const n = parseInt(text.replace(/\D/g, ""), 10);
        if (!n) return tg(c.token, "sendMessage", { chat_id: m.chat.id, text: ASK.price(p) + "\n\n⚠️ Faqat raqam yozing\n\n🆔 " + p.id, reply_markup: { force_reply: true } });
        p.price = n;
      } else if (kind === "name") p.name = text.slice(0, 100);
      else p.descr = text === "-" ? "" : text.slice(0, 500);
      await updateProduct(env, p.id, { price: p.price, name: p.name, descr: p.descr });
      await send("✅ Saqlandi. Saytda darrov yangilandi.");
      return sendCard(c, m.chat.id, p);
    }
  }

  // yangi mahsulot: rasm (yoki rasm-fayl) + izoh
  const doc = m.document && /^image\//.test(m.document.mime_type || "") ? m.document : null;
  if (m.photo || doc) {
    if (m.media_group_id && !m.caption) return null; // albomdagi qo'shimcha rasmlar
    const ph = doc || m.photo[m.photo.length - 1];
    const cap = parseCaption(m.caption);
    if (!cap.name || !cap.price) {
      return send("⚠️ Rasm izohiga nomi va narxini yozing.\n\n" + ADD_HELP, { reply_parameters: { message_id: m.message_id } });
    }
    const id = await addProduct(env, { name: cap.name, price: cap.price, descr: cap.descr, file_id: ph.file_id, fuid: ph.file_unique_id });
    return tg(c.token, "sendMessage", {
      chat_id: m.chat.id,
      text: `💍 ${cap.name}\n💰 ${fmtPrice(cap.price)}${cap.descr ? "\n📝 " + cap.descr : ""}\n\n📂 Qaysi boʻlimga qoʻshamiz?`,
      reply_markup: catKeyboard(id),
      reply_parameters: { message_id: m.message_id, allow_sending_without_reply: true },
    });
  }
  return undefined;
}

async function onProductCallback(q, kind, a, b, c, env, answer) {
  const chatId = q.message?.chat?.id;
  const edit = (text, kb) => q.message?.photo
    ? tg(c.token, "editMessageCaption", { chat_id: chatId, message_id: q.message.message_id, caption: text, reply_markup: kb })
    : tg(c.token, "editMessageText", { chat_id: chatId, message_id: q.message.message_id, text, reply_markup: kb });
  const p = await getProduct(env, a);
  if (!p) { await edit("Bu mahsulot oʻchirilgan.", { inline_keyboard: [] }); return answer("Topilmadi"); }

  switch (kind) {
    case "pc": { // bo'lim tanlandi
      if (b === "x") {
        if (!p.live) { await deleteProduct(env, p.id); await edit("❌ Bekor qilindi.", { inline_keyboard: [] }); return answer("Bekor qilindi"); }
        await edit(cardText(p), cardKeyboard(p.id)); return answer("");
      }
      if (!CATS[b]) return answer("?");
      const first = !p.live;
      p.cat = b; p.live = 1;
      await updateProduct(env, p.id, { cat: b, live: 1 });
      if (first && !q.message?.photo) { await edit(`✅ Saytga qoʻshildi!\n\n💍 ${p.name}\n💰 ${fmtPrice(p.price)}\n📂 ${CATS[b]}`, { inline_keyboard: [] }); await sendCard(c, chatId, p); }
      else await edit(cardText(p), cardKeyboard(p.id));
      return answer(first ? "✅ Saytga qoʻshildi" : "✅ Boʻlim oʻzgardi");
    }
    case "pv": await sendCard(c, chatId, p); return answer("");
    case "ps": await edit(cardText(p), cardKeyboard(p.id)); return answer("");
    case "pk": await edit(cardText(p) + "\n\n📂 Yangi boʻlimni tanlang:", catKeyboard(p.id)); return answer("");
    case "pp": case "pn": case "pt": {
      const k = kind === "pp" ? "price" : kind === "pn" ? "name" : "descr";
      await tg(c.token, "sendMessage", { chat_id: chatId, text: `${ASK[k](p)}\n\n🆔 ${p.id}`, reply_markup: { force_reply: true, input_field_placeholder: k === "price" ? "120000" : "" } });
      return answer("Javob yozing 👇");
    }
    case "pd":
      await edit(cardText(p) + "\n\n🗑 Rostdan oʻchirilsinmi?", { inline_keyboard: [[{ text: "Ha, oʻchirish", callback_data: `py|${p.id}` }, { text: "Yoʻq", callback_data: `ps|${p.id}` }]] });
      return answer("");
    case "py":
      await deleteProduct(env, p.id);
      await edit(`🗑 «${p.name}» saytdan oʻchirildi.`, { inline_keyboard: [] });
      return answer("Oʻchirildi");
  }
  return answer("");
}

// Buyurtmalar guruhida /admin — yozgan odam mahsulot qo'sha oladigan bo'ladi
async function onGroupMessage(m, c, env) {
  const text = (m.text || "").trim();
  if (!/^\/admin(@\w+)?\b/i.test(text) || !m.from || m.from.is_bot) return;
  const name = m.from.username ? "@" + m.from.username : m.from.first_name || String(m.from.id);
  await addAdmin(env, m.from.id, name);
  await tg(c.token, "sendMessage", {
    chat_id: m.chat.id,
    text: `✅ ${name} endi saytga mahsulot qoʻsha oladi.\n\nBotning shaxsiy chatiga oʻtib /start bosing — «➕ Mahsulot qoʻshish» tugmasi chiqadi.`,
    reply_parameters: { message_id: m.message_id, allow_sending_without_reply: true },
  });
}

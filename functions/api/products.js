// GET /api/products — saytdagi katalog: mijoz bot orqali qo'shgan mahsulotlar.
import { json, listProducts, fmtPrice } from "../../lib/shop.js";

const NEW_DAYS = 14;

export async function onRequestGet({ env }) {
  let rows = [];
  try { rows = await listProducts(env); } catch (e) { console.error(e); return json({ items: [], xato: "baza" }); }
  const now = Date.now();
  const items = rows.map((r) => ({
    id: "p" + r.id,
    cat: r.cat,
    name: r.name,
    price: fmtPrice(r.price),
    desc: r.descr || "",
    img: `/api/img/${r.id}?v=${encodeURIComponent(r.fuid || "")}`,
    badge: now - r.created < NEW_DAYS * 86400000 ? "Yangi" : "",
  }));
  const res = json({ items });
  res.headers.set("Cache-Control", "no-cache");
  return res;
}

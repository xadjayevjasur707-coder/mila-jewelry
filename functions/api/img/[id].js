// GET /api/img/:id — mahsulot rasmi. Rasm Telegram'da saqlanadi, bu yerda keshlanib beriladi.
import { cfg, tg, getProduct } from "../../../lib/shop.js";

export async function onRequestGet({ request, env, params, waitUntil }) {
  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;

  const c = cfg(env);
  const p = await getProduct(env, params.id).catch(() => null);
  if (!p || !c.token) return new Response("topilmadi", { status: 404 });
  const f = await tg(c.token, "getFile", { file_id: p.file_id });
  if (!f.ok) return new Response("rasm topilmadi", { status: 404 });
  const r = await fetch(`https://api.telegram.org/file/bot${c.token}/${f.result.file_path}`);
  if (!r.ok) return new Response("rasm topilmadi", { status: 502 });

  const ext = (f.result.file_path.split(".").pop() || "").toLowerCase();
  const type = { png: "image/png", webp: "image/webp", gif: "image/gif" }[ext] || "image/jpeg";
  const res = new Response(r.body, {
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" },
  });
  waitUntil(cache.put(request, res.clone()));
  return res;
}

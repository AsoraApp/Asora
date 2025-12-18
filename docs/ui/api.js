function withTimeout(promise, ms) {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error("timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

async function safeJsonFromResponse(res) {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export const api = {
  async tryGet(path, ctx) {
    const url = (ctx.apiBase || "") + path;
    const res = await withTimeout(
      fetch(url, {
        method: "GET",
        credentials: "include",
        headers: {
          "Accept": "application/json",
        },
      }),
      20000
    );

    return wrap(res);
  },

  async tryPost(path, body, ctx) {
    const url = (ctx.apiBase || "") + path;
    const res = await withTimeout(
      fetch(url, {
        method: "POST",
        credentials: "include",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json; charset=utf-8",
        },
        body: body === null ? null : JSON.stringify(body),
      }),
      20000
    );

    return wrap(res);
  },
};

function wrap(res) {
  return {
    ok: res.ok,
    status: res.status,
    headers: res.headers,
    async safeJson() {
      return await safeJsonFromResponse(res);
    },
    raw: res,
  };
}

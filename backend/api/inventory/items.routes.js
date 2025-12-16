const { listItems, getItem, getItemBySku } = require("../../controllers/inventory/items.read.js");

function enhanceRes(req, res) {
  if (typeof res.status === "function" && typeof res.json === "function") return;

  res.status = function status(code) {
    res.statusCode = code;
    return res;
  };

  res.json = function json(payload) {
    if (!res.getHeader("Content-Type")) {
      res.setHeader("Content-Type", "application/json");
    }
    res.end(JSON.stringify(payload));
    return res;
  };

  res.set = function set(name, value) {
    res.setHeader(name, value);
    return res;
  };
}

function parseUrl(req) {
  const u = new URL(req.url, "http://localhost");
  const query = {};
  for (const [k, v] of u.searchParams.entries()) query[k] = v;
  return { pathname: u.pathname, query };
}

module.exports = function itemsRoutes(req, res) {
  const { pathname, query } = parseUrl(req);

  enhanceRes(req, res);
  req.query = query;
  req.params = req.params || {};

  // GET /api/items
  if (req.method === "GET" && pathname === "/api/items") {
    req.params = {};
    listItems(req, res);
    return true;
  }

  // GET /api/items/by-sku/:sku
  {
    const m = pathname.match(/^\/api\/items\/by-sku\/([^/]+)$/);
    if (req.method === "GET" && m) {
      req.params = { sku: decodeURIComponent(m[1]) };
      getItemBySku(req, res);
      return true;
    }
  }

  // GET /api/items/:itemId
  {
    const m = pathname.match(/^\/api\/items\/([^/]+)$/);
    if (req.method === "GET" && m) {
      req.params = { itemId: decodeURIComponent(m[1]) };
      getItem(req, res);
      return true;
    }
  }

  return false;
};

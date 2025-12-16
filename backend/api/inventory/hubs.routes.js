const { listHubs, getHub } = require("../../controllers/inventory/hubs.read.js");
const { listBinsByHub } = require("../../controllers/inventory/bins.read.js");

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

module.exports = function hubsRoutes(req, res) {
  const { pathname, query } = parseUrl(req);

  enhanceRes(req, res);
  req.query = query;
  req.params = req.params || {};

  // GET /api/hubs
  if (req.method === "GET" && pathname === "/api/hubs") {
    req.params = {};
    listHubs(req, res);
    return true;
  }

  // GET /api/hubs/:hubId
  {
    const m = pathname.match(/^\/api\/hubs\/([^/]+)$/);
    if (req.method === "GET" && m) {
      req.params = { hubId: decodeURIComponent(m[1]) };
      getHub(req, res);
      return true;
    }
  }

  // GET /api/hubs/:hubId/bins
  {
    const m = pathname.match(/^\/api\/hubs\/([^/]+)\/bins$/);
    if (req.method === "GET" && m) {
      req.params = { hubId: decodeURIComponent(m[1]) };
      listBinsByHub(req, res);
      return true;
    }
  }

  return false;
};

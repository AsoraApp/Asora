// backend/src/api/http.js
function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function ok(res, obj) {
  return sendJson(res, 200, obj);
}

function created(res, obj) {
  return sendJson(res, 201, obj);
}

module.exports = { sendJson, ok, created };

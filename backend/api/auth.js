function handleAuthMe(req, res, ctx) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      requestId: ctx.requestId
    })
  );
}

module.exports = {
  handleAuthMe
};

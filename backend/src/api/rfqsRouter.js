const rfqCore = require("./rfqs");
const rfqComparisonAndSelectionRouter = require("./rfqsComparisonAndSelection");

module.exports = function rfqsCompositeRouter(ctx, req, res) {
  if (rfqCore(ctx, req, res)) return true;
  if (rfqComparisonAndSelectionRouter(ctx, req, res)) return true;
  return false;
};

const hubs = require("./hubs.routes");
const bins = require("./bins.routes");
const items = require("./items.routes");
const stock = require("./stock.routes");

module.exports = function inventoryRouter(req, res) {
  return (
    hubs(req, res) ||
    bins(req, res) ||
    items(req, res) ||
    stock(req, res) ||
    false
  );
};

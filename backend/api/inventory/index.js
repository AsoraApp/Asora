const hubs = require("./hubs.routes.js");
const bins = require("./bins.routes.js");
const items = require("./items.routes.js");
const stock = require("./stock.routes.js");

module.exports = function inventoryRouter(req, res) {
  return hubs(req, res) || bins(req, res) || items(req, res) || stock(req, res) || false;
};

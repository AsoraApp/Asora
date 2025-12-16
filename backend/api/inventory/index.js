import express from "express";

import hubsRoutes from "./hubs.routes.js";
import binsRoutes from "./bins.routes.js";
import itemsRoutes from "./items.routes.js";
import stockRoutes from "./stock.routes.js";

const router = express.Router();

router.use(hubsRoutes);
router.use(binsRoutes);
router.use(itemsRoutes);
router.use(stockRoutes);

export default router;


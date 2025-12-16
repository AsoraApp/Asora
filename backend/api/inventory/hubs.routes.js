import express from "express";
import { listHubs, getHub } from "../../controllers/inventory/hubs.read.js";
import { listBinsByHub } from "../../controllers/inventory/bins.read.js";

const router = express.Router();

router.get("/hubs", listHubs);
router.get("/hubs/:hubId", getHub);
router.get("/hubs/:hubId/bins", listBinsByHub);

export default router;


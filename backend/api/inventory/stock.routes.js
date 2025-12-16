import express from "express";
import { listStock } from "../../controllers/inventory/stock.read.js";

const router = express.Router();

router.get("/stock", listStock);

export default router;


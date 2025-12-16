import express from "express";
import { getBin } from "../../controllers/inventory/bins.read.js";

const router = express.Router();

router.get("/bins/:binId", getBin);

export default router;


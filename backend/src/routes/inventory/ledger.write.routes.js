import express from "express";
import { postLedgerEvent } from "../../controllers/inventory/ledger.write.js";

const router = express.Router();

// POST /api/inventory/ledger/events
router.post("/ledger/events", postLedgerEvent);

export default router;

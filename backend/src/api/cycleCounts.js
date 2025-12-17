// backend/src/api/cycleCounts.js
//
// B4 Cycle Counts API Router
// Mounted under /api/cycle-counts (see server.js)
// Auth + tenant context are enforced at server mount level

const express = require("express");
const router = express.Router();

// Controllers
const { submitCycleCount } = require("../controllers/cycleCounts/cycleCounts.submit");
const { postCycleCount } = require("../controllers/cycleCounts/cycleCounts.post");
const {
  createCycleCountDraft,
  listCycleCounts,
  getCycleCountById,
} = require("../controllers/cycleCounts/cycleCounts.read");
const {
  addCycleCountLine,
  updateCycleCountLine,
  deleteCycleCountLine,
} = require("../controllers/cycleCounts/cycleCounts.lines");
const {
  approveCycleCount,
  rejectCycleCount,
} = require("../controllers/cycleCounts/cycleCounts.approveReject");

// ----------------------------
// Cycle count headers
// ----------------------------

// Create DRAFT
router.post("/", createCycleCountDraft);

// List headers
router.get("/", listCycleCounts);

// Get header + lines
router.get("/:cycleCountId", getCycleCountById);

// ----------------------------
// Lines (DRAFT only)
// ----------------------------

router.post("/:cycleCountId/lines", addCycleCountLine);
router.patch("/:cycleCountId/lines/:cycleCountLineId", updateCycleCountLine);
router.delete("/:cycleCountId/lines/:cycleCountLineId", deleteCycleCountLine);

// ----------------------------
// Lifecycle transitions
// ----------------------------

// DRAFT -> SUBMITTED (freeze snapshot)
router.post("/:cycleCountId/submit", submitCycleCount);

// SUBMITTED -> APPROVED / REJECTED
router.post("/:cycleCountId/approve", approveCycleCount);
router.post("/:cycleCountId/reject", rejectCycleCount);

// APPROVED -> POSTED (ledger adjustments)
router.post("/:cycleCountId/post", postCycleCount);

module.exports = router;


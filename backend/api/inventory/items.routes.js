import express from "express";
import {
  listItems,
  getItem,
  getItemBySku
} from "../../controllers/inventory/items.read.js";

const router = express.Router();

router.get("/items", listItems);
router.get("/items/:itemId", getItem);
router.get("/items/by-sku/:sku", getItemBySku);

export default router;


import express from "express";
import { DashboardController } from "../controllers/dashboardController.js";
import { requireAdmin } from "../middleware/authorize.js";

const router = express.Router();

// Reading the catalogue only needs a login (defaultDeny already enforced it);
// changing it is an admin action.
router.get("/", DashboardController.getDashboards);
router.post("/", requireAdmin, DashboardController.createDashboard);
router.put("/:id", requireAdmin, DashboardController.updateDashboard);
router.delete("/:id", requireAdmin, DashboardController.deleteDashboard);

export default router;

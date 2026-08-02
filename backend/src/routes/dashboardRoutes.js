import express from "express";
import { DashboardController } from "../controllers/dashboardController.js";

const router = express.Router();

router.get("/", DashboardController.getDashboards);
router.post("/", DashboardController.createDashboard);
router.put("/:id", DashboardController.updateDashboard);
router.delete("/:id", DashboardController.deleteDashboard);

export default router;

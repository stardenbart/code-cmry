import { DashboardModel } from "../models/dashboardModel.js";

export const DashboardController = {
  getDashboards: async (req, res) => {
    try {
      const { department } = req.query;
      const dashboards = await DashboardModel.getAll(department);
      res.status(200).json(dashboards);
    } catch (error) {
      console.error("❌ Error fetching dashboards:", error);
      res.status(500).json({ message: "Error fetching dashboards", error: error.message });
    }
  },

  createDashboard: async (req, res) => {
    try {
      const { title, description, url, report_id, department, pic_emails, plant_id, department_id, plantIds } = req.body;

      if (!title || !url || !department) {
        return res.status(400).json({ message: "Title, Public Embed URL, and department are required" });
      }

      const id = await DashboardModel.create({
        title, description, url, report_id, department, pic_emails, plant_id, department_id, plantIds,
      });

      res.status(201).json({ id, message: "✅ Dashboard created successfully" });
    } catch (error) {
      console.error("❌ Error creating dashboard:", error);
      res.status(500).json({ message: "Error creating dashboard", error: error.message });
    }
  },

  updateDashboard: async (req, res) => {
    try {
      const { id } = req.params;
      const updated = await DashboardModel.update(id, req.body);

      if (!updated) {
        return res.status(404).json({ message: "Dashboard not found" });
      }

      res.status(200).json({ message: "✅ Dashboard updated successfully" });
    } catch (error) {
      console.error("❌ Error updating dashboard:", error);
      res.status(500).json({ message: "Error updating dashboard", error: error.message });
    }
  },

  deleteDashboard: async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await DashboardModel.delete(id);

      if (!deleted) {
        return res.status(404).json({ message: "Dashboard not found" });
      }

      res.status(200).json({ message: "🗑️ Dashboard deleted successfully" });
    } catch (error) {
      console.error("❌ Error deleting dashboard:", error);
      res.status(500).json({ message: "Error deleting dashboard", error: error.message });
    }
  },
};

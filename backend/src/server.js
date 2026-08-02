import "dotenv/config"; // Must be first — loads .env before all other modules evaluate

import express from "express";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";
import db from "./config/db.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import portalLinkRoutes from "./routes/portalLinkRoutes.js";
import aiRoutes from "./routes/aiRoutes.js";
import { SERVER_CONFIG } from "./config/config.js";
import { getEmbedConfig, getEmbedConfigByReportId } from "./config/powerbi.js";
import { verifyJWT } from "./middleware/auth.js";
import { defaultDeny, requireAdmin, requireSelfOrAdmin } from "./middleware/authorize.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 📧 Email notifications
import {
  sendAccessRequestEmail,
  sendRegistrationEmail,
  verifyApprovalToken,
  approvalSuccessPage,
  rejectionSuccessPage,
  approvalUserPage,
  rejectionUserPage,
  alreadyProcessedPage,
  expiredLinkPage,
} from "./config/email.js";
import { DashboardModel } from "./models/dashboardModel.js";

const app = express();
const PORT = SERVER_CONFIG.port;

// Limit is generous because /api/ai/ask carries a Power BI data snapshot
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "10mb" }));
app.use(cors());

// Default-deny: everything under /api needs a token unless explicitly public.
// Must sit before every router so no route can be registered behind its back.
app.use(defaultDeny);

// Serve uploaded portal images statically
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.use("/api/dashboards", dashboardRoutes);
app.use("/api/portal-links", portalLinkRoutes);
app.use("/api/ai", aiRoutes);

// REGISTER
app.post("/api/register", async (req, res) => {
  const { nama, departemen, nik, email, username, password } = req.body;
  // Self-registration cannot grant itself All Access. Upgrades go through an
  // admin, who can see what they are approving — the approve-by-email button
  // does not show the requested access level.
  const tipe_akses = "Department Access Only";

  try {
    const checkQuery = `SELECT id FROM users WHERE username = ?`;
    db.query(checkQuery, [username], async (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database error",
          error: err
        });
      }

      if (results.length > 0) {
        return res.status(400).json({
          message: "Username already exist"
        });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const insertQuery = `
        INSERT INTO users 
        (nama, departemen, tipe_akses, nik, email, username, password, approved)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      `;

      db.query(
        insertQuery,
        [nama, departemen, tipe_akses, nik, email, username, hashedPassword],
        async (err, result) => {
          if (err) {
            return res.status(500).json({
              message: "Database error",
              error: err
            });
          }

          // 📧 Notify superuser — pass insertId so the email token links back to this user
          sendRegistrationEmail({ id: result.insertId, nama, departemen, email, nik }).catch(console.error);

          res.status(200).json({
            message: "Account created. Waiting for approval."
          });
        }
      );
    });
  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error
    });
  }
});

// LOGIN
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const query = "SELECT * FROM users WHERE username = ?";

  db.query(query, [username], async (err, results) => {
    if (err) return res.status(500).json({ message: "Database error" });
    if (results.length === 0) return res.status(404).json({ message: "User not found" });

    const user = results[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).json({ message: "Wrong password" });
    if (!user.approved) return res.status(403).json({ message: "Account pending approval" });

    const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET || "jwt_secret_key", { expiresIn: "8h" });
    res.status(200).json({ token, user });
  });
});

// CHECK TOKEN
app.get("/api/check-token", (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "Token missing" });

  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET || "jwt_secret_key", (err, decoded) => {
    if (err) return res.status(401).json({ message: "Invalid or expired token" });
    res.json({ message: "Token valid", user: { id: decoded.id, username: decoded.username } });
  });
});

// GET ALL USERS
app.get("/api/users", requireAdmin, (req, res) => {
  const q = "SELECT id, nama, departemen, tipe_akses, nik, email, username, approved FROM users";
  db.query(q, (err, results) => {
    if (err) return res.status(500).json({ message: "Database error", error: err });
    res.json(results);
  });
});

// CHANGE PASSWORD
// Self-service requires the current password: without it, anyone who finds an
// unattended logged-in browser could lock the owner out permanently. An admin
// resetting someone else's password is exempt — that is the point of a reset.
app.put("/api/users/:id/password", requireSelfOrAdmin("id"), async (req, res) => {
  const { id } = req.params;
  const { currentPassword, newPassword } = req.body;

  if (!newPassword || newPassword.trim().length < 8) {
    return res.status(400).json({ message: "Password baru minimal 8 karakter" });
  }

  const isSelf = Number(id) === Number(req.dbUser.id);

  try {
    if (isSelf) {
      if (!currentPassword) {
        return res.status(400).json({ message: "Password saat ini wajib diisi" });
      }

      const [rows] = await db.promise().query("SELECT password FROM users WHERE id = ?", [id]);
      if (!rows.length) return res.status(404).json({ message: "User tidak ditemukan" });

      const valid = await bcrypt.compare(currentPassword, rows[0].password);
      if (!valid) return res.status(400).json({ message: "Password saat ini salah" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const [result] = await db
      .promise()
      .query("UPDATE users SET password = ? WHERE id = ?", [hashedPassword, id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "User tidak ditemukan" });
    }
    res.json({ message: "Password berhasil diperbarui" });
  } catch (error) {
    console.error("Error updating password:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// ADD USER
app.post("/api/add-user", requireAdmin, async (req, res) => {
  const { nama, departemen, tipe_akses, nik, email, username, password } = req.body;

  // bcrypt.hash(undefined) throws, and an unhandled rejection inside an async
  // Express handler kills the process — Express does not catch it. A request
  // with no body used to take the whole backend down.
  if (!username?.trim() || !password?.trim() || !nama?.trim()) {
    return res.status(400).json({ message: "Nama, username, dan password wajib diisi" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const q = `
    INSERT INTO users (nama, departemen, tipe_akses, nik, email, username, password, approved)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `;
  db.query(q, [nama, departemen, tipe_akses, nik, email, username, hashedPassword], (err) => {
    if (err) return res.status(500).json({ message: "Database error", error: err });
    res.status(200).json({ message: "User successfully added" });
  });
});

// UPDATE USER
app.put("/api/update-user/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { nama, departemen, tipe_akses, nik, email, username, password } = req.body;

  try {
    let q = "";
    let params = [];

    if (password && password.trim() !== "") {
      const hashedPassword = await bcrypt.hash(password, 10);
      q = `
        UPDATE users 
        SET nama=?, departemen=?, tipe_akses=?, nik=?, email=?, username=?, password=? 
        WHERE id=?`;
      params = [nama, departemen, tipe_akses, nik, email, username, hashedPassword, id];
    } else {
      q = `
        UPDATE users 
        SET nama=?, departemen=?, tipe_akses=?, nik=?, email=?, username=? 
        WHERE id=?`;
      params = [nama, departemen, tipe_akses, nik, email, username, id];
    }

    db.query(q, params, (err, result) => {
      if (err) return res.status(500).json({ message: "Database error", error: err });
      if (result.affectedRows === 0) return res.status(404).json({ message: "User is not found" });
      res.status(200).json({ message: "User successfully updated" });
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
});

// APPROVE / DECLINE USER
app.put("/api/approve-user/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  
  // Get user info first for notification
  db.query("SELECT nama FROM users WHERE id = ?", [id], (err, users) => {
    if (err || users.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const userName = users[0].nama;

    db.query("UPDATE users SET approved = 1 WHERE id = ?", [id], (err) => {
      if (err) return res.status(500).json({ message: "Database error", error: err });
      res.json({ message: "User successfully approved" });
    });
  });
});

app.put("/api/decline-user/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  db.query("DELETE FROM users WHERE id = ?", [id], (err) => {
    if (err) return res.status(500).json({ message: "Database error", error: err });
    res.json({ message: "User declined and deleted" });
  });
});

// REQUEST ACCESS
app.post("/api/request-access", (req, res) => {
  // Identity comes from the token, never from the payload: a valid token with a
  // forged user_id would otherwise let anyone act on someone else's behalf.
  const user_id = req.user.id;
  const { dashboard_title, dashboard_department, department_requested } = req.body;
  if (!user_id || !dashboard_title || !dashboard_department || !department_requested)
    return res.status(400).json({ message: "Datas are not completed" });

  const check = `
    SELECT * FROM access_requests WHERE user_id = ? AND dashboard_title = ?
  `;
  db.query(check, [user_id, dashboard_title], (err, results) => {
    if (err) return res.status(500).json({ message: "Database error (check)" });
    if (results.length > 0)
      return res.status(400).json({ message: "You already request for this" });

    // Get user info for notification
    db.query("SELECT nama, departemen FROM users WHERE id = ?", [user_id], (err2, users) => {
      if (err2 || users.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }

      const { nama, departemen } = users[0];

      const insert = `
        INSERT INTO access_requests (user_id, dashboard_title, dashboard_department, department_requested, status)
        VALUES (?, ?, ?, ?, 'PENDING')
      `;
      db.query(insert, [user_id, dashboard_title, dashboard_department, department_requested], async (err3, insertResult) => {
        if (err3) return res.status(500).json({ message: "Database error (insert)", error: err3 });

        // 📧 Email PICs of the requested dashboard
        const requestId = insertResult.insertId;
        DashboardModel.getPicEmails(dashboard_title)
          .then(picEmails => sendAccessRequestEmail({
            picEmails,
            requesterName: nama,
            requesterDept: departemen,
            dashboardTitle: dashboard_title,
            requestId,
          }))
          .catch(console.error);

        res.status(200).json({ message: "Access request successfully sent" });
      });
    });
  });
});

app.get("/api/dashboard-access-status/:userId", requireSelfOrAdmin("userId"), (req, res) => {
  const { userId } = req.params;

  const q = `
    SELECT 
      d.title,
      CASE
        WHEN uda.user_id IS NOT NULL THEN 'APPROVED'
        ELSE ar.status
      END AS status
    FROM dashboards d
    LEFT JOIN user_dashboard_access uda
      ON uda.dashboard_id = d.id
      AND uda.user_id = ?
    LEFT JOIN access_requests ar
      ON ar.dashboard_title = d.title
      AND ar.user_id = ?
      AND ar.id = (
        SELECT MAX(id)
        FROM access_requests
        WHERE user_id = ?
          AND dashboard_title = d.title
      )
  `;

  db.query(q, [userId, userId, userId], (err, rows) => {
    if (err) return res.status(500).json(err);

    const map = {};
    rows.forEach(r => {
      if (r.status) map[r.title] = r.status;
    });

    res.json(map);
  });
});

// GRANT DASHBOARD ACCESS
app.get("/api/users/:userId/dashboard-access", requireSelfOrAdmin("userId"), (req, res) => {
  const { userId } = req.params;

  const sql = `
    SELECT
      d.id AS dashboard_id,
      d.title,
      d.department,
      CASE
        WHEN uda.user_id IS NOT NULL THEN 1
        ELSE 0
      END AS has_access
    FROM dashboards d
    LEFT JOIN user_dashboard_access uda
      ON uda.dashboard_id = d.id
    AND uda.user_id = ?
    WHERE d.active = 1
    ORDER BY d.department, d.title;
  `;

  db.query(sql, [userId, userId], (err, results) => {
    if (err) {
      console.error("❌ dashboard-access SQL error:", err);
      return res.status(500).json({ error: err.message });
    }
    res.json(results);
  });
});

// HARD REVOKE DASHBOARD ACCESS
app.post("/api/users/:userId/dashboard-access", requireAdmin, (req, res) => {
  const { userId } = req.params;
  const { dashboardId, checked } = req.body;

  if (checked) {
    db.query(
      `
      INSERT IGNORE INTO user_dashboard_access (user_id, dashboard_id)
      VALUES (?, ?)
      `,
      [userId, dashboardId],
      (err) => {
        if (err) return res.status(500).json(err);
        res.json({ message: "Access granted" });
      }
    );
  } else {
    db.query(
      `
      DELETE FROM user_dashboard_access
      WHERE user_id = ? AND dashboard_id = ?;
      `,
      [userId, dashboardId],
      (err) => {
        if (err) return res.status(500).json(err);

        db.query(
          `
          UPDATE access_requests
          SET status = 'CLOSED'
          WHERE user_id = ?
            AND dashboard_title = (
              SELECT title FROM dashboards WHERE id = ?
            )
          `,
          [userId, dashboardId],
          () => res.json({ message: "Access revoked" })
        );
      }
    );
  }
});

// ACCESS REQUEST LOG
app.get("/api/access-requests-log/:userId", requireSelfOrAdmin("userId"), (req, res) => {
  const { userId } = req.params;

  const query = `
    SELECT 
      ar.id,
      ar.dashboard_title,
      ar.dashboard_department,
      ar.department_requested,
      ar.status,
      ar.created_at
    FROM access_requests ar
    WHERE ar.user_id = ?
    ORDER BY ar.created_at DESC
  `;

  db.query(query, [userId], (err, rows) => {
    if (err) {
      console.error("❌ DB error:", err);
      return res.status(500).json({ message: "Failed to get access requests log" });
    }
    res.json(rows);
  });
});

// ACCESS STATUS LOG
app.get("/api/access/:userId", requireSelfOrAdmin("userId"), (req, res) => {
  const { userId } = req.params;

  const query = `
    SELECT dashboard_title, status 
    FROM access_requests 
    WHERE user_id = ?
  `;

  db.query(query, [userId], (err, rows) => {
    if (err) {
      console.error("❌ DB error while catching the log:", err);
      return res.status(500).json({ message: "Failed to get access status", error: err });
    }

    const result = {};
    rows.forEach(row => {
      result[row.dashboard_title] = row.status;
    });

    res.json(result);
  });
});

// GET ACCESS REQUESTS
app.get("/api/requests", requireAdmin, (req, res) => {
  const qUsers = "SELECT * FROM users WHERE approved = 0";
  const qAccess = `
    SELECT ar.id, u.nama, u.departemen, ar.dashboard_title, ar.dashboard_department,
          ar.department_requested, ar.status, ar.created_at
    FROM access_requests ar
    JOIN users u ON ar.user_id = u.id
    WHERE ar.status = 'PENDING'
    ORDER BY ar.id DESC
  `;

  db.query(qUsers, (err, userRequests) => {
    if (err) return res.status(500).json({ message: "Database error", error: err });
    db.query(qAccess, (err2, accessRequests) => {
      if (err2) return res.status(500).json({ message: "Database error", error: err2 });
      res.json({ userRequests, accessRequests });
    });
  });
});

// CANCEL REQUEST
app.post("/api/cancel-request", (req, res) => {
  const user_id = req.user.id;
  const { dashboard_title } = req.body;

  if (!user_id || !dashboard_title) {
    return res.status(400).json({ message: "Datas are not completed" });
  }

  const deleteQuery = `
    DELETE FROM access_requests
    WHERE user_id = ? AND dashboard_title = ? AND status = 'PENDING'
  `;

  db.query(deleteQuery, [user_id, dashboard_title], (err, result) => {
    if (err) {
      console.error("DB error saat cancel request:", err);
      return res.status(500).json({ message: "Failed to cancel request access", error: err });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "There is not pending request to be canceled yet" });
    }

    res.json({ message: "Access request successfully canceled" });
  });
});

// APPROVE REQUEST
app.put("/api/approve-request/:id", requireAdmin, (req, res) => {
  const { id } = req.params;

  const q = `
    SELECT ar.user_id, d.id AS dashboard_id, d.title AS dashboard_title, u.nama
    FROM access_requests ar
    JOIN dashboards d ON d.title = ar.dashboard_title
    JOIN users u ON u.id = ar.user_id
    WHERE ar.id = ?
  `;

  db.query(q, [id], (err, rows) => {
    if (err || rows.length === 0)
      return res.status(404).json({ message: "Request not found" });

    const { user_id, dashboard_id, dashboard_title, nama } = rows[0];

    db.query(
      "UPDATE access_requests SET status = 'APPROVED' WHERE id = ?",
      [id]
    );

    db.query(
      `
      INSERT IGNORE INTO user_dashboard_access (user_id, dashboard_id)
      VALUES (?, ?)
      `,
      [user_id, dashboard_id],
      () => res.json({ message: "Access granted" })
    );
  });
});

// DECLINE REQUEST
app.put("/api/decline-request/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  db.query("UPDATE access_requests SET status = 'DECLINED' WHERE id = ?", [id], (err) => {
    if (err) {
      console.error("DB error declining request:", err);
      return res.status(500).json({ message: "Gagal decline request", error: err });
    }
    return res.json({ message: "Access request declined" });
  });
});

// DELETE USER
app.delete("/api/delete-user/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  db.query("DELETE FROM users WHERE id = ?", [id], (err) => {
    if (err) return res.status(500).json({ message: "Database error", error: err });
    res.json({ message: "User deleted successfully" });
  });
});

// USERS NOTIFICATION
app.get("/api/notifications/count/:userId", requireSelfOrAdmin("userId"), (req, res) => {
  const { userId } = req.params;

  db.query(
    `
    SELECT COUNT(*) AS total
    FROM access_requests
    WHERE user_id = ?
      AND status != last_notified_status
    `,
    [userId],
    (err, result) => {
      if (err) return res.status(500).json({ error: err });
      res.json({ total: result[0].total });
    }
  );
});

// UPDATE COUNT NOTIFICATION
app.put("/api/notifications/mark-read/:userId", requireSelfOrAdmin("userId"), (req, res) => {
  const { userId } = req.params;

  db.query(
    `
    UPDATE access_requests
    SET last_notified_status = status
    WHERE user_id = ?
    `,
    [userId],
    (err) => {
      if (err) return res.status(500).json({ error: err });
      res.json({ message: "Notifications synced" });
    }
  );
});

function pbiError(error) {
  const apiErr = error.response?.data;
  if (apiErr) {
    const code = apiErr.error?.code || apiErr.error || "unknown";
    const msg  = apiErr.error?.message || apiErr.error_description || JSON.stringify(apiErr);
    return `[${code}] ${msg}`;
  }
  return error.message;
}

// GET EMBED CONFIG BY DIRECT REPORT ID – used by database-managed department dashboards
app.get("/api/powerbi/embed-config-by-report/:reportId", verifyJWT, async (req, res) => {
  try {
    const config = await getEmbedConfigByReportId(req.params.reportId);
    res.json(config);
  } catch (error) {
    const detail = pbiError(error);
    console.error("Power BI embed-by-report error:", detail);
    res.status(500).json({ message: detail });
  }
});

// GET EMBED CONFIG BY NAMED KEY – used by the 4 fixed Data Center dashboards
app.get("/api/powerbi/embed-config/:dashboardKey", verifyJWT, async (req, res) => {
  try {
    const config = await getEmbedConfig(req.params.dashboardKey);
    res.json(config);
  } catch (error) {
    const detail = pbiError(error);
    console.error("Power BI embed-by-key error:", detail);
    res.status(500).json({ message: detail });
  }
});

// ── Shared helper: resolve access-request token → row ────────────────────────
function resolveAccessToken(token, res, cb) {
  if (!token) return res.status(400).send(expiredLinkPage());
  let payload;
  try { payload = verifyApprovalToken(token); } catch {
    return res.status(400).send(expiredLinkPage());
  }
  db.query(
    `SELECT ar.id, ar.user_id, ar.dashboard_title, ar.status, u.nama
     FROM access_requests ar
     JOIN users u ON u.id = ar.user_id
     WHERE ar.id = ?`,
    [payload.requestId],
    (err, rows) => {
      if (err || rows.length === 0)
        return res.status(404).send(expiredLinkPage());
      cb(rows[0]);
    }
  );
}

// EMAIL APPROVAL LINK — PIC clicks Approve button in their inbox
app.get("/api/approve-via-email", (req, res) => {
  resolveAccessToken(req.query.token, res, ({ user_id, dashboard_title, status, nama, id: reqId }) => {
    if (status !== "PENDING") return res.send(alreadyProcessedPage(status));

    db.query("SELECT id FROM dashboards WHERE title = ? LIMIT 1", [dashboard_title], (err2, dashRows) => {
      if (err2 || dashRows.length === 0) return res.status(404).send(expiredLinkPage());

      const dashboard_id = dashRows[0].id;
      db.query("UPDATE access_requests SET status = 'APPROVED' WHERE id = ?", [reqId], (err3) => {
        if (err3) return res.status(500).send(expiredLinkPage());
        db.query(
          "INSERT IGNORE INTO user_dashboard_access (user_id, dashboard_id) VALUES (?, ?)",
          [user_id, dashboard_id],
          (err4) => {
            if (err4) return res.status(500).send(expiredLinkPage());
            res.send(approvalSuccessPage(dashboard_title, nama));
          }
        );
      });
    });
  });
});

// EMAIL REJECTION LINK — PIC clicks Reject button in their inbox
app.get("/api/reject-via-email", (req, res) => {
  resolveAccessToken(req.query.token, res, ({ dashboard_title, status, nama, id: reqId }) => {
    if (status !== "PENDING") return res.send(alreadyProcessedPage(status));

    db.query("UPDATE access_requests SET status = 'DECLINED' WHERE id = ?", [reqId], (err) => {
      if (err) return res.status(500).send(expiredLinkPage());
      res.send(rejectionSuccessPage(dashboard_title, nama));
    });
  });
});

// ── Shared helper: resolve user-registration token → row ─────────────────────
function resolveUserToken(token, res, cb) {
  if (!token) return res.status(400).send(expiredLinkPage());
  let payload;
  try { payload = verifyApprovalToken(token); } catch {
    return res.status(400).send(expiredLinkPage());
  }
  db.query(
    "SELECT id, nama, departemen, approved FROM users WHERE id = ?",
    [payload.userId],
    (err, rows) => {
      if (err || rows.length === 0) return res.status(404).send(expiredLinkPage());
      cb(rows[0]);
    }
  );
}

// EMAIL USER APPROVAL LINK — Superuser approves registration from email
app.get("/api/approve-user-via-email", (req, res) => {
  resolveUserToken(req.query.token, res, ({ id, nama, departemen, approved }) => {
    if (approved) return res.send(alreadyProcessedPage("APPROVED"));

    db.query("UPDATE users SET approved = 1 WHERE id = ?", [id], (err) => {
      if (err) return res.status(500).send(expiredLinkPage());
      res.send(approvalUserPage(nama, departemen));
    });
  });
});

// EMAIL USER REJECTION LINK — Superuser rejects registration from email
app.get("/api/reject-user-via-email", (req, res) => {
  resolveUserToken(req.query.token, res, ({ id, nama, approved }) => {
    if (approved) return res.send(alreadyProcessedPage("APPROVED"));

    db.query("DELETE FROM users WHERE id = ?", [id], (err) => {
      if (err) return res.status(500).send(expiredLinkPage());
      res.send(rejectionUserPage(nama));
    });
  });
});

app.get("/", (req, res) => res.send("Cimory Operation API Running ✅"));

// ── Refresh JWT Token ────────────────────────────────────────────────────────
app.post("/api/refresh-token", verifyJWT, async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      "SELECT id, username, tipe_akses, approved FROM users WHERE id = ?",
      [req.user.id]
    );
    if (!rows.length || !rows[0].approved) {
      return res.status(401).json({ message: "User not found or not approved" });
    }
    const newToken = jwt.sign(
      { id: rows[0].id, username: rows[0].username },
      process.env.JWT_SECRET || "jwt_secret_key",
      { expiresIn: "8h" }
    );
    res.json({ token: newToken });
  } catch (err) {
    res.status(500).json({ message: "Failed to refresh token" });
  }
});

// START SERVER
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

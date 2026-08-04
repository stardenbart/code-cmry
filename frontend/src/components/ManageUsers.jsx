  import React, { useEffect, useState } from "react";
  import API from "../api/api"
  import { Trash2, RefreshCw, Edit, Search, ChevronDown, ShieldCheck } from "lucide-react";
import PerfSummary from "./PerfSummary";
import { useToast } from "./ToastProvider";
import { useConfirm } from "./ConfirmProvider";

  export default function ManageUsers({ onClose }) {
    const confirm = useConfirm();
    const toast = useToast();
    const [dashboardAccess, setDashboardAccess] = useState([]);
    const [dashboardChecked, setDashboardChecked] = useState({});
    const [loadingAccess, setLoadingAccess] = useState(false);
    const [users, setUsers] = useState([]);
    const [filteredUsers, setFilteredUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");
    const [editingUser, setEditingUser] = useState(null);
    const [form, setForm] = useState({
      nama: "",
      departemen: "",
      tipe_akses: "",
      nik: "",
      email: "",
      username: "",
      password: "",
      role: "user",
    });

    useEffect(() => {
      document.body.style.overflow = "hidden";

      return () => {
        document.body.style.overflow = "auto";
      };
    }, []);

    const fetchUsers = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await API.get("/api/users");
        setUsers(res.data);
        setFilteredUsers(res.data);
      } catch (err) {
        console.error("Error fetching users:", err);
        setError(err.response?.data?.message || "Failed to get user from the server");
      } finally {
        setLoading(false);
      }
    };

    const deleteUser = async (id, nama) => {
      const setuju = await confirm({
        judul: "Hapus user",
        pesan: `Akun "${nama}" akan dihapus permanen beserta riwayat aksesnya.`,
        labelKonfirmasi: "Hapus",
        destruktif: true,
      });
      if (!setuju) return;
      try {
        await API.delete(`/api/delete-user/${id}`);
        toast.success(`Akun "${nama}" dihapus`);
        fetchUsers();
      } catch (err) {
        console.error("Error deleting user:", err);
        toast.error(err.response?.data?.message || "Gagal menghapus user");
      }
    };

    const handleSearch = (e) => {
      const value = e.target.value.toLowerCase();
      setSearch(value);
      setFilteredUsers(
        users.filter(
          (u) =>
            u.nama.toLowerCase().includes(value) ||
            u.departemen.toLowerCase().includes(value) ||
            u.username.toLowerCase().includes(value)
        )
      );
    };

    const openEditModal = async (user) => {
      setEditingUser(user);
      setForm({
        nama: user.nama,
        departemen: user.departemen,
        tipe_akses: user.tipe_akses,
        nik: user.nik,
        email: user.email,
        username: user.username,
        password: user.password || "",
        // Baris lama bisa punya role NULL. Tanpa nilai jatuhan, select-nya
        // tampil kosong lalu mengirim "" dan server menolaknya sebagai tidak
        // valid, padahal admin tidak mengubah apa pun di kolom itu.
        role: user.role === "admin" ? "admin" : "user",
      });

      setLoadingAccess(true);
      try {
        const res = await API.get(
          `/api/users/${user.id}/dashboard-access`
        );

        setDashboardAccess(res.data);

        const checkedMap = {};
        res.data.forEach((d) => {
          checkedMap[d.dashboard_id] = d.has_access === 1;
        });
        setDashboardChecked(checkedMap);
      } catch (err) {
        console.error("Failed load dashboard access", err);
      } finally {
        setLoadingAccess(false);
      }
    };

    const toggleDashboardAccess = async (dashboardId, checked) => {
      setDashboardChecked((prev) => ({
        ...prev,
        [dashboardId]: checked,
      }));

      try {
        await API.post(
          `/api/users/${editingUser.id}/dashboard-access`,
          { dashboardId, checked }
        );
      } catch {
        toast.error("Gagal memperbarui akses dashboard");
      }
    };

    const handleUpdate = async () => {
      try {
        await API.put(`/api/update-user/${editingUser.id}`, form);
        toast.success("Data berhasil diperbarui");
        setEditingUser(null);
        fetchUsers();
      } catch (err) {
        console.error("Error updating user:", err);
        toast.error(err.response?.data?.message || "Gagal memperbarui user");
      }
    };

    useEffect(() => {
      fetchUsers();
    }, []);

    const departments = [...new Set(users.map((u) => u.departemen))];
    const accessOptions = ["All Access", "Department Access Only"];

    return (
      <div className="fixed inset-0 bg-black/40 flex justify-center items-center z-50">
        <div className="bg-white w-3/4 max-h-[80vh] overflow-auto shadow-lg p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-cimoryBlue">Manage Users</h2>
            <div className="flex items-center gap-3">
              <button
                onClick={fetchUsers}
                className="text-cimoryBlue hover:text-cimoryRed flex items-center gap-1"
              >
                <RefreshCw size={18} /> Refresh
              </button>
              <button
                onClick={onClose}
                className="bg-cimoryRed text-white px-4 py-2 rounded-lg hover:bg-red-600 transition"
              >
                Exit
              </button>
            </div>
          </div>

          <div className="relative mb-4">
            <Search className="absolute left-3 top-2.5 text-gray-500" size={18} />
            <input
              type="text"
              placeholder="Cari nama, departemen, atau username..."
              value={search}
              onChange={handleSearch}
              className="pl-9 pr-3 py-2 border rounded-lg w-full focus:ring focus:ring-cimoryBlue/40"
            />
          </div>

          {loading ? (
            <p className="text-gray-500 italic">Loading data...</p>
          ) : error ? (
            <p className="text-red-500">{error}</p>
          ) : filteredUsers.length === 0 ? (
            <p className="text-gray-500 italic">No user found</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-cimoryBlue text-white">
                  <th className="border p-2">Name</th>
                  <th className="border p-2">Department</th>
                  <th className="border p-2">Access Type</th>
                  <th className="border p-2">NIK</th>
                  <th className="border p-2">Email</th>
                  <th className="border p-2">Username</th>
                  <th className="border p-2">Role</th>
                  <th className="border p-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-100">
                    <td className="border p-2">{u.nama}</td>
                    <td className="border p-2">{u.departemen}</td>
                    <td className="border p-2">{u.tipe_akses}</td>
                    <td className="border p-2">{u.nik}</td>
                    <td className="border p-2">{u.email}</td>
                    <td className="border p-2">{u.username}</td>
                    <td className="border p-2 text-center">
                      {u.role === "admin" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-cimoryBlue/10 px-2 py-0.5 text-xs font-semibold text-cimoryBlue">
                          <ShieldCheck size={13} />
                          Admin
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500">User</span>
                      )}
                    </td>
                    <td className="border p-2 flex justify-center gap-2">
                      <button
                        onClick={() => openEditModal(u)}
                        className="text-blue-500 hover:text-blue-700"
                      >
                        <Edit size={18} />
                      </button>
                      <button
                        onClick={() => deleteUser(u.id, u.nama)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <PerfSummary />
        </div>

        {editingUser && (
          <div className="fixed inset-0 bg-black/40 flex justify-center items-center z-50">
            <div className="bg-white shadow-lg w-[420px] max-h-[80vh] flex flex-col">

              {/* HEADER */}
              <div className="p-5 border-b">
                <h3 className="text-lg font-semibold text-cimoryBlue">
                  Edit User
                </h3>
              </div>

              {/* BODY (SCROLLABLE) */}
              <div className="p-5 overflow-y-auto flex-1 space-y-3">

                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Name
                  </label>
                  <input
                    type="text"
                    value={form.nama}
                    onChange={(e) =>
                      setForm({ ...form, nama: e.target.value })
                    }
                    className="border rounded-lg px-3 py-2 w-full focus:ring focus:ring-cimoryBlue/40"
                  />
                </div>

                {/* NIK */}
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    NIK
                  </label>
                  <input
                    type="text"
                    value={form.nik}
                    onChange={(e) =>
                      setForm({ ...form, nik: e.target.value })
                    }
                    className="border rounded-lg px-3 py-2 w-full focus:ring focus:ring-cimoryBlue/40"
                  />
                </div>

                {/* Department */}
                <div className="relative">
                  <label className="block text-sm font-medium text-gray-700">
                    Department
                  </label>
                  <select
                    value={form.departemen}
                    onChange={(e) =>
                      setForm({ ...form, departemen: e.target.value })
                    }
                    className="appearance-none border rounded-lg px-3 py-2 w-full focus:ring focus:ring-cimoryBlue/40"
                  >
                    <option value="">Choose Department</option>
                    {departments.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={18}
                    className="absolute right-3 top-9 text-gray-500 pointer-events-none"
                  />
                </div>

                {/* Access Type */}
                <div className="relative">
                  <label className="block text-sm font-medium text-gray-700">
                    Access Type
                  </label>
                  <select
                    value={form.tipe_akses}
                    onChange={(e) =>
                      setForm({ ...form, tipe_akses: e.target.value })
                    }
                    className="appearance-none border rounded-lg px-3 py-2 w-full focus:ring focus:ring-cimoryBlue/40"
                  >
                    <option value="">Choose Access Type</option>
                    {accessOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={18}
                    className="absolute right-3 top-9 text-gray-500 pointer-events-none"
                  />
                </div>

                {/* Role */}
                <div className="relative">
                  <label className="block text-sm font-medium text-gray-700">
                    Role
                  </label>
                  <select
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value })}
                    className="appearance-none border rounded-lg px-3 py-2 w-full focus:ring focus:ring-cimoryBlue/40"
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                  <ChevronDown
                    size={18}
                    className="absolute right-3 top-9 text-gray-500 pointer-events-none"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Admin bisa mengelola user, dashboard, dan kunci universal CODE AI.
                    Access Type di atas mengatur dashboard yang terlihat, bukan hak kelola ini.
                  </p>
                </div>

                {/* Email */}
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Email
                  </label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) =>
                      setForm({ ...form, email: e.target.value })
                    }
                    className="border rounded-lg px-3 py-2 w-full focus:ring focus:ring-cimoryBlue/40"
                  />
                </div>

                {/* Username */}
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Username
                  </label>
                  <input
                    type="text"
                    value={form.username}
                    onChange={(e) =>
                      setForm({ ...form, username: e.target.value })
                    }
                    className="border rounded-lg px-3 py-2 w-full focus:ring focus:ring-cimoryBlue/40"
                  />
                </div>

                {/* Password */}
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Password
                  </label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) =>
                      setForm({ ...form, password: e.target.value })
                    }
                    placeholder="Enter if you need to change password"
                    className="border rounded-lg px-3 py-2 w-full focus:ring focus:ring-cimoryBlue/40"
                  />
                </div>

                {/* Dashboard Access */}
                {form.tipe_akses === "Department Access Only" && (
                  <div>
                    <label className="text-sm font-medium text-gray-700">
                      Dashboard Access
                    </label>

                    {loadingAccess ? (
                      <p className="italic text-sm">Loading...</p>
                    ) : dashboardAccess.length === 0 ? (
                      <p className="text-xs text-gray-500 italic">
                        No dashboard access data
                      </p>
                    ) : (
                      <div className="border rounded-lg p-3 max-h-40 overflow-y-auto space-y-2 mt-1">
                        {dashboardAccess.map((d) => (
                          <label
                            key={d.dashboard_id}
                            className="flex items-center gap-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={!!dashboardChecked[d.dashboard_id]}
                              onChange={(e) =>
                                toggleDashboardAccess(
                                  d.dashboard_id,
                                  e.target.checked
                                )
                              }
                            />
                            {d.title}
                            <span className="text-xs text-gray-400">
                              ({d.department})
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* FOOTER */}
              <div className="p-4 border-t flex justify-end gap-3 bg-white">
                <button
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 rounded-lg border hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdate}
                  className="px-4 py-2 bg-cimoryBlue text-white rounded-lg hover:bg-blue-700 transition"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    );
  }
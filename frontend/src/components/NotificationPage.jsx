import React, { useEffect, useState } from "react";
import API from "../api/api"
import { Check, X, Loader2 } from "lucide-react";

export default function NotificationPage({ user }) {
  const [requests, setRequests] = useState({ userRequests: [], accessRequests: [] });
  const [userRequests, setUserRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchRequests = async () => {
    try {
      setLoading(true);

      if (user?.nama === "Digital Transformer") {
        const res = await API.get("/api/requests");
        setRequests({
          userRequests: res.data.userRequests || [],
          accessRequests: res.data.accessRequests || [],
        });
      } else {
        const res = await API.get(`/api/access-requests-log/${user.id}`);
        setUserRequests(res.data || []);
      }
    } catch (err) {
      console.error("Error fetching requests:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDecision = async (type, id, action) => {
    try {
      if (type === "user") {
        const endpoint = action === "approve" ? `/api/approve-user/${id}` : `/api/decline-user/${id}`;
        await API.put(endpoint);
      } else if (type === "access") {
        const endpoint = action === "approve" ? `/api/approve-request/${id}` : `/api/decline-request/${id}`;
        await API.put(endpoint);
      }
      await fetchRequests();
    } catch (err) {
      console.error(`Error updating ${type} request:`, err);
      alert("Error occured while handling decision.");
    }
  };

  useEffect(() => {
    fetchRequests();
    if (user?.id) {
      API.put(`/api/notifications/mark-read/${user.id}`)
        .catch(err => console.error("Failed mark notifications read", err));
    }
  }, []);

  
  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen text-cimoryBlue">
        <Loader2 className="animate-spin mr-2" size={24} />
        Loading requests...
      </div>
    );
  }

  return (
    <div className="p-8 bg-gray-50 min-h-screen space-y-10 rounded-2xl">
      <h1 className="text-3xl font-bold text-cimoryBlue mb-6">Here's New!</h1>

      {user?.nama === "Digital Transformer" ? (
        <>
          <section>
            <h2 className="text-xl font-semibold text-cimoryRed mb-4">User Registration Requests</h2>
            {requests.userRequests.length > 0 ? (
              requests.userRequests.map((r) => (
                <div
                  key={r.id}
                  className="p-4 bg-white rounded-xl shadow-sm flex justify-between items-center mb-3 border border-gray-100 hover:shadow-md transition-all"
                >
                  <div>
                    <p className="font-semibold text-gray-800">{r.nama}</p>
                    <p className="text-sm text-gray-500">{r.departemen}</p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleDecision("user", r.id, "approve")}
                      className="bg-green-500 text-white p-2 rounded-lg hover:bg-green-600 transition-colors"
                    >
                      <Check size={18} />
                    </button>
                    <button
                      onClick={() => handleDecision("user", r.id, "decline")}
                      className="bg-red-500 text-white p-2 rounded-lg hover:bg-red-600 transition-colors"
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-gray-500 italic">No pending registration requests.</p>
            )}
          </section>

          <section>
            <h2 className="text-xl font-semibold text-cimoryRed mb-4">Access Requests</h2>
            {requests.accessRequests.length > 0 ? (
              requests.accessRequests.map((r) => (
                <div
                  key={r.id}
                  className="p-4 bg-white rounded-xl shadow-sm flex justify-between items-center mb-3 border border-gray-100 hover:shadow-md transition-all"
                >
                  <div>
                    <p className="font-semibold text-gray-800">{r.nama}</p>
                    <p className="text-sm text-gray-500">
                      {r.departemen} → {r.dashboard_title}
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleDecision("access", r.id, "approve")}
                      className="bg-green-500 text-white p-2 rounded-lg hover:bg-green-600 transition-colors"
                    >
                      <Check size={18} />
                    </button>
                    <button
                      onClick={() => handleDecision("access", r.id, "decline")}
                      className="bg-red-500 text-white p-2 rounded-lg hover:bg-red-600 transition-colors"
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-gray-500 italic">No pending access requests.</p>
            )}
          </section>
        </>
      ) : (
        <>
          <section>
            <h2 className="text-xl font-semibold text-cimoryRed mb-4">Your Access Request History</h2>
            {userRequests.length > 0 ? (
              <table className="w-full bg-white rounded-xl shadow-md overflow-hidden">
                <thead className="bg-gray-100">
                  <tr className="text-left text-gray-700">
                    <th className="p-3">Dashboard</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Requested Dept</th>
                    <th className="p-3">Created At</th>
                  </tr>
                </thead>
                <tbody>
                  {userRequests.map((req) => (
                    <tr
                      key={req.id}
                      className={`border-t hover:bg-gray-50 ${
                        req.is_unread ? "bg-yellow-50 font-semibold" : "border-gray-100"
                      }`}
                    >
                      <td className="p-3">{req.dashboard_title}</td>
                      <td
                        className={`p-3 capitalize ${
                          req.status === "APPROVED"
                            ? "text-green-600"
                            : req.status === "DECLINED"
                            ? "text-red-500"
                            : "text-gray-500"
                        }`}
                      >
                        {req.status}
                      </td>
                      <td className="p-3">{req.department_requested || req.dashboard_department}</td>
                      <td className="p-3 text-gray-500">{req.created_at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-gray-500 italic">You have no request history.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

import React, { useEffect, useState, useRef } from "react";
import API from "../api/api"
import { Check, X, Loader2, Inbox } from "lucide-react";
import { useToast } from "./ToastProvider";

/**
 * Kerangka saat memuat, bukan layar kosong lalu isi yang melompat masuk.
 * Tingginya menyerupai baris sungguhan supaya tata letak tidak bergeser.
 */
function SkeletonBaris() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Memuat notifikasi">
      {[0, 1, 2].map((i) => (
        <div key={i} className="animate-pulse flex items-center gap-3 p-4 bg-white rounded-xl border border-cimoryGray">
          <div className="h-9 w-9 rounded-full bg-gray-200" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 bg-gray-200 rounded w-1/3" />
            <div className="h-3 bg-gray-100 rounded w-1/2" />
          </div>
          <div className="h-8 w-20 bg-gray-100 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

/** Inbox dipilih karena artinya memang kotak masuk yang kosong. */
function StatusKosong({ judul, keterangan }) {
  return (
    <div className="text-center py-12">
      <Inbox size={40} className="mx-auto text-gray-300" />
      <p className="mt-3 text-sm font-medium text-gray-700">{judul}</p>
      <p className="mt-1 text-xs text-gray-500">{keterangan}</p>
    </div>
  );
}

export default function NotificationPage({ user }) {
  const toast = useToast();
  const [requests, setRequests] = useState({ userRequests: [], accessRequests: [] });
  const [userRequests, setUserRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  // Baris yang sedang diproses, supaya klik ganda tidak mengirim dua keputusan.
  //
  // DUA penyimpanan untuk satu hal, dan itu perlu: state dipakai untuk
  // menggambar tombol, ref dipakai untuk penjaganya. Versi pertama hanya
  // memakai state dan tidak bekerja sama sekali. Lima klik sinkron semuanya
  // membaca nilai state yang sama dari closure, karena React memperbarui state
  // secara asinkron, sehingga kelimanya lolos dan mengirim lima permintaan.
  // Terbukti saat diuji: 5 klik menghasilkan 5 permintaan.
  const [memproses, setMemproses] = useState({});
  const memprosesRef = useRef({});

  const fetchRequests = async () => {
    try {
      setLoading(true);

      if (user?.role === "admin") {
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

  const handleDecision = async (type, id, action, nama) => {
    const kunci = `${type}-${id}`;
    // Ref, bukan state: ini harus benar pada klik kedua di tick yang sama.
    if (memprosesRef.current[kunci]) return;
    memprosesRef.current[kunci] = true;
    setMemproses((s) => ({ ...s, [kunci]: true }));

    try {
      if (type === "user") {
        const endpoint = action === "approve" ? `/api/approve-user/${id}` : `/api/decline-user/${id}`;
        await API.put(endpoint);
      } else if (type === "access") {
        const endpoint = action === "approve" ? `/api/approve-request/${id}` : `/api/decline-request/${id}`;
        await API.put(endpoint);
      }
      const kata = action === "approve" ? "disetujui" : "ditolak";
      toast.success(nama ? `Permintaan ${nama} ${kata}` : `Permintaan ${kata}`);
      await fetchRequests();
    } catch (err) {
      console.error(`Error updating ${type} request:`, err);
      toast.error(err?.response?.data?.message || "Gagal menyimpan keputusan");
    } finally {
      delete memprosesRef.current[kunci];
      setMemproses((s) => {
        const salinan = { ...s };
        delete salinan[kunci];
        return salinan;
      });
    }
  };

  /** Tombol keputusan dengan status memproses, supaya tidak terklik dua kali. */
  const TombolKeputusan = ({ type, id, action, nama }) => {
    const kunci = `${type}-${id}`;
    const sibuk = Boolean(memproses[kunci]);
    const setuju = action === "approve";
    return (
      <button
        onClick={() => handleDecision(type, id, action, nama)}
        disabled={sibuk}
        aria-label={setuju ? `Setujui permintaan ${nama || ""}` : `Tolak permintaan ${nama || ""}`}
        className={`text-white p-2 rounded-lg transition-colors ${
          sibuk
            ? "bg-gray-400 cursor-not-allowed"
            : setuju ? "bg-green-500 hover:bg-green-600" : "bg-red-500 hover:bg-red-600"
        }`}
      >
        {sibuk ? <Loader2 className="animate-spin" size={18} /> : setuju ? <Check size={18} /> : <X size={18} />}
      </button>
    );
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
      // Tanpa judul: NotificationsLayout sudah memasang judul halaman di atas.
      <div className="p-8 bg-gray-50 min-h-screen rounded-2xl">
        <SkeletonBaris />
      </div>
    );
  }

  const totalAdmin = requests.userRequests.length + requests.accessRequests.length;

  return (
    <div className="p-8 bg-gray-50 min-h-screen space-y-10 rounded-2xl">
      {user?.role === "admin" ? (
        totalAdmin === 0 ? (
          <StatusKosong
            judul="Belum ada permintaan"
            keterangan="Permintaan akun baru dan permintaan akses dashboard akan muncul di sini."
          />
        ) : (
        <>
          {requests.userRequests.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold text-cimoryRed mb-4">
              Permintaan akun baru ({requests.userRequests.length})
            </h2>
            {requests.userRequests.map((r) => (
                <div
                  key={r.id}
                  className="p-4 bg-white rounded-xl shadow-sm flex justify-between items-center mb-3 border border-gray-100 hover:shadow-md transition-all"
                >
                  <div>
                    <p className="font-semibold text-gray-800">{r.nama}</p>
                    <p className="text-sm text-gray-500">{r.departemen}</p>
                  </div>
                  <div className="flex gap-3">
                    <TombolKeputusan type="user" id={r.id} action="approve" nama={r.nama} />
                    <TombolKeputusan type="user" id={r.id} action="decline" nama={r.nama} />
                  </div>
                </div>
              ))}
          </section>
          )}

          {requests.accessRequests.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold text-cimoryRed mb-4">
              Permintaan akses dashboard ({requests.accessRequests.length})
            </h2>
            {requests.accessRequests.map((r) => (
                <div
                  key={r.id}
                  className="p-4 bg-white rounded-xl shadow-sm flex justify-between items-center mb-3 border border-gray-100 hover:shadow-md transition-all"
                >
                  <div>
                    <p className="font-semibold text-gray-800">{r.nama}</p>
                    <p className="text-sm text-gray-500">
                      {r.departemen} ke {r.dashboard_title}
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <TombolKeputusan type="access" id={r.id} action="approve" nama={r.nama} />
                    <TombolKeputusan type="access" id={r.id} action="decline" nama={r.nama} />
                  </div>
                </div>
              ))}
          </section>
          )}
        </>
        )
      ) : (
        <>
          <section>
            <h2 className="text-xl font-semibold text-cimoryRed mb-4">Riwayat permintaan akses kamu</h2>
            {userRequests.length > 0 ? (
              <table className="w-full bg-white rounded-xl shadow-md overflow-hidden">
                <thead className="bg-gray-100">
                  <tr className="text-left text-gray-700">
                    <th className="p-3">Dashboard</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Departemen diminta</th>
                    <th className="p-3">Diajukan</th>
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
              <StatusKosong
                judul="Belum ada permintaan akses"
                keterangan="Ajukan akses dari kartu dashboard yang belum terbuka, statusnya akan tampil di sini."
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}

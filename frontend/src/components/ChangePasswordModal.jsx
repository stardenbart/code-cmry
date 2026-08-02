import { useState, useEffect } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import API from "../api/api";

export default function ChangePasswordModal({ onClose }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = "auto";
    };
  }, []);

  const handleSave = async () => {
    const loggedInUser = JSON.parse(localStorage.getItem("user"));

    if (!loggedInUser) {
      alert("No logged-in user found");
      return;
    }

    if (newPassword.length < 6) {
      alert("Password must be at least 6 characters long");
      return;
    }

    if (newPassword !== confirmPassword) {
      alert("Password confirmation does not match");
      return;
    }

    try {
      await API.put(`/api/users/${loggedInUser.id}/password`, {
        newPassword,
      });

      alert("Password updated successfully!");

      const updatedUser = { ...loggedInUser, password: newPassword };
      localStorage.setItem("user", JSON.stringify(updatedUser));

      setNewPassword("");
      setConfirmPassword("");
      onClose();
    } catch (err) {
      console.error("Error updating password:", err);
      alert("Failed to update password");
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
      <div className="bg-white p-6 shadow-lg w-96">
        <h2 className="text-lg font-semibold mb-4 text-cimoryBlue">
          Change Password
        </h2>

        <div className="space-y-3">
          <div className="relative">
            <input
              type={showNew ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New Password"
              className="w-full border p-2 rounded focus:outline-none focus:ring focus:ring-yellow-300 pr-10"
            />
            <button
              type="button"
              onClick={() => setShowNew(!showNew)}
              className="absolute right-3 top-2.5 text-gray-500 hover:text-gray-700"
            >
              {showNew ? <EyeOffIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
            </button>
          </div>
          
          <div className="relative">
            <input
              type={showConfirm ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm Password"
              className="w-full border p-2 rounded focus:outline-none focus:ring focus:ring-yellow-300 pr-10"
            />
            <button
              type="button"
              onClick={() => setShowConfirm(!showConfirm)}
              className="absolute right-3 top-2.5 text-gray-500 hover:text-gray-700"
            >
              {showConfirm ? <EyeOffIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
            </button>
          </div>

          <p className="text-xs text-gray-500">
            Password must be at least 6 characters long.
          </p>

          <div className="flex justify-end space-x-2 mt-4">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-cimoryBlue text-white rounded-lg hover:bg-blue-700 transition"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

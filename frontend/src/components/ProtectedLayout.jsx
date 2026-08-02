import { Outlet, Navigate } from "react-router-dom";

export default function ProtectedLayout({ user, loadingUser }) {
  if (loadingUser) {
    return (
      <div className="h-screen flex items-center justify-center">
        Loading...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

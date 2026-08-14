export function DashboardReference({ id, title, reason, confidence }) {
  const confidencePercent = Math.round((confidence || 1) * 100);
  return (
    <div className="inline-block bg-blue-50 border border-blue-200 rounded px-3 py-2 text-sm">
      <div className="font-medium text-blue-900">{title}</div>
      {reason && <div className="text-blue-700 text-xs">{reason}</div>}
      <div className="text-blue-600 text-xs mt-1">Kepercayaan: {confidencePercent}%</div>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-card border border-line bg-card ${className}`}
    />
  );
}
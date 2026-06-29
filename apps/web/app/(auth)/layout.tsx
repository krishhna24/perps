export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-text">
            Perps<span className="text-accent">.</span>
          </h1>
          <p className="text-sm text-dim">Perpetual futures trading</p>
        </div>
        {children}
      </div>
    </div>
  );
}

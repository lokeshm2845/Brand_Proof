import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md space-y-3 py-16 text-center">
      <h1 className="text-xl font-bold">Page not found</h1>
      <p className="text-sm text-slate-600">That link doesn&apos;t exist in BrandProof.</p>
      <Link href="/" className="btn-primary">Go to the workspace</Link>
    </div>
  );
}

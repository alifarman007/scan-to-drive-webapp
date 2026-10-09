import { AdminShell } from "@/components/admin/admin-shell";

// Sign-in protection for the admin pages is added with the admin login (step 5).
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}

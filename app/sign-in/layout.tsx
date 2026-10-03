import { AccountProvider } from "@/components/account-provider";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AccountProvider>{children}</AccountProvider>;
}

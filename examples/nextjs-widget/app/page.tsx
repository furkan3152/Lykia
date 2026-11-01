// app/page.tsx in a Next.js App Router project. A server component that
// renders the client widget with the project's public id and browser key.
import { LykiaWallet } from "../components/LykiaWallet";

const env = (typeof process !== "undefined" ? process.env : {}) as Record<string, string | undefined>;

export default function Page() {
  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <h1>Acme Pay</h1>
      <p>Pay, swap and ask the assistant, without leaving the app.</p>
      <LykiaWallet project={env.NEXT_PUBLIC_LYKIA_PROJECT ?? "prj_yourproject1"} apiKey={env.NEXT_PUBLIC_LYKIA_KEY ?? ""} />
    </main>
  );
}

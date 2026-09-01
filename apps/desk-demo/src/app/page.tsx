import { Desk } from "../components/desk";

const DESKTOP_URL = process.env.NEXT_PUBLIC_DESKTOP_URL ?? "http://127.0.0.1:13310";

export default function Page() {
  return <Desk desktopUrl={DESKTOP_URL} />;
}

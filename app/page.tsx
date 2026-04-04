import HomeClient from "./home-client";

export default function HomePage() {
  const showDevButton = String(process.env.DEV_MODE ?? "").toLowerCase() === "true";
  return <HomeClient showDevButton={showDevButton} />;
}

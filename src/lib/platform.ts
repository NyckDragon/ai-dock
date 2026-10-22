export type Platform = "windows" | "macos" | "linux";

export function currentPlatform(userAgent = navigator.userAgent): Platform {
  if (userAgent.includes("Mac")) return "macos";
  if (userAgent.includes("Linux")) return "linux";
  return "windows";
}

import { Activity, BellRing, GitCompareArrows, History, LayoutDashboard, Layers, Megaphone, Plug, RadioTower, Settings, Siren, Wallet, Workflow } from "lucide-react";

export const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/live", label: "Live Monitoring", icon: RadioTower },
  { href: "/platforms", label: "Platforms", icon: Layers },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/alerts", label: "Alerts", icon: BellRing, badge: "alerts" as const },
  { href: "/incidents", label: "Incidents", icon: Siren, badge: "incidents" as const },
  { href: "/budget", label: "Budget Control", icon: Wallet },
  { href: "/compare", label: "Compare", icon: GitCompareArrows },
  { href: "/historical", label: "Historical", icon: History },
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/automation", label: "Automation", icon: Workflow },
  { href: "/settings", label: "Settings", icon: Settings },
];

export const BRAND_ICON = Activity;
